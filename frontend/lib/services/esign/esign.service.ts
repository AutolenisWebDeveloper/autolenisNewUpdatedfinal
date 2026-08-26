// lib/services/esign/esign.service.ts
// System 9 — DocuSign JWT auth + envelope lifecycle
import { prisma } from "@/lib/prisma";
import { ESignStatus } from "@prisma/client";
import { advanceDealStatus } from "@/lib/services/deal/deal.service";
import { logger } from "@/lib/logger";
import { isDocuSignConfigured, getDocuSignConfig, getDocuSignAccessToken } from "./docusign-auth.service";

const DEAL_ID_DISPLAY_LENGTH = 8; // characters used in user-facing deal ID references

export interface CreateEnvelopeResult {
  envelopeId: string | null;
  signingUrl: string | null;
  isMock: boolean;
  error?: string;
}

export async function createEnvelope(
  dealId: string,
  signerEmail?: string,
  signerName?: string
): Promise<CreateEnvelopeResult> {
  if (!isDocuSignConfigured()) {
    await prisma.eSignEnvelope.upsert({
      where: { dealId },
      create: { dealId, status: ESignStatus.PENDING },
      update: { status: ESignStatus.PENDING },
    });
    return { envelopeId: null, signingUrl: null, isMock: true };
  }

  const config = getDocuSignConfig();
  try {
    const accessToken = await getDocuSignAccessToken();

    const templateId = config.dealerTemplateId;
    const useTemplate = templateId && !templateId.includes("placeholder") && !templateId.includes("autolenis-preview");

    const envelopePayload = useTemplate
      ? {
          templateId,
          templateRoles: [{ email: signerEmail ?? "signer@placeholder.com", name: signerName ?? "AutoLenis Buyer", roleName: "Buyer", clientUserId: dealId }],
          status: "sent",
        }
      : {
          emailSubject: "AutoLenis — Please sign your documents",
          documents: [{ documentId: "1", name: "AutoLenis Purchase Agreement", fileExtension: "txt", documentBase64: Buffer.from("AutoLenis Purchase Agreement - Deal ID: " + dealId).toString("base64") }],
          recipients: {
            signers: [{ email: signerEmail ?? "signer@autolenis-test.com", name: signerName ?? "AutoLenis Buyer", recipientId: "1", clientUserId: dealId, tabs: { signHereTabs: [{ documentId: "1", pageNumber: "1", xPosition: "100", yPosition: "100" }] } }],
          },
          status: "sent",
        };

    const envelopesUrl = `${config.baseUrl}/v2.1/accounts/${config.accountId}/envelopes`;
    const createRes = await fetch(envelopesUrl, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(envelopePayload),
    });

    const createData = await createRes.json() as { envelopeId?: string; errorCode?: string; message?: string };
    if (!createRes.ok || !createData.envelopeId) {
      throw new Error(`Envelope creation failed (${createRes.status}): ${createData.errorCode ?? ""} — ${createData.message ?? JSON.stringify(createData)}`);
    }

    const docusignEnvelopeId = createData.envelopeId;
    const recipientViewUrl = `${config.baseUrl}/v2.1/accounts/${config.accountId}/envelopes/${docusignEnvelopeId}/views/recipient`;
    const viewRes = await fetch(recipientViewUrl, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ authenticationMethod: "email", email: signerEmail ?? "signer@autolenis-test.com", userName: signerName ?? "AutoLenis Buyer", clientUserId: dealId, returnUrl: config.returnUrl || "https://autolenis.com/buyer/esign/complete" }),
    });
    const viewData = await viewRes.json() as { url?: string; errorCode?: string; message?: string };
    const signingUrl = viewData.url ?? null;

    await prisma.eSignEnvelope.upsert({
      where: { dealId },
      create: { dealId, docusignEnvelopeId, status: ESignStatus.SENT, sentAt: new Date() },
      update: { docusignEnvelopeId, status: ESignStatus.SENT, sentAt: new Date() },
    });

    return { envelopeId: docusignEnvelopeId, signingUrl, isMock: false };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    logger.error("[esign.service] createEnvelope error:", error);
    await prisma.eSignEnvelope.upsert({ where: { dealId }, create: { dealId, status: ESignStatus.PENDING }, update: {} });
    return { envelopeId: null, signingUrl: null, isMock: false, error };
  }
}

export async function sendEnvelope(dealId: string): Promise<void> {
  const envelope = await prisma.eSignEnvelope.findUnique({ where: { dealId } });
  if (!envelope) throw new Error("Envelope not found");
  await prisma.eSignEnvelope.update({ where: { dealId }, data: { status: ESignStatus.SENT, sentAt: new Date() } });
  const deal = await prisma.deal.findUnique({ where: { id: dealId } });
  if (deal) {
    await prisma.notification.create({ data: { buyerId: deal.buyerId, title: "Documents ready to sign", body: "Your signing package is ready. Open it from your dashboard.", type: "SIGNING_READY" } }).catch(() => {});
  }
}

// Retrieve the executed (combined) signed PDF from DocuSign and store it in the
// private "contracts" bucket, returning the storage key. Returns null in the
// mock/unconfigured path (no real envelope to fetch). Throws on a real fetch /
// upload failure so the caller can log it and leave documentKey null (the buyer
// download route then 404s gracefully until a later run populates it).
export async function retrieveAndStoreSignedContract(
  docusignEnvelopeId: string,
  dealId: string,
): Promise<string | null> {
  if (!isDocuSignConfigured()) return null;

  const config = getDocuSignConfig();
  const accessToken = await getDocuSignAccessToken();
  const url = `${config.baseUrl}/v2.1/accounts/${config.accountId}/envelopes/${docusignEnvelopeId}/documents/combined`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/pdf" } });
  if (!res.ok) throw new Error(`DocuSign combined-document fetch failed (${res.status})`);

  const bytes = Buffer.from(await res.arrayBuffer());
  const { createServiceSupabaseClient } = await import("@/lib/supabase");
  const supabase = createServiceSupabaseClient();
  const key = `signed/${dealId}/${docusignEnvelopeId}.pdf`;
  const { error } = await supabase.storage
    .from("contracts")
    .upload(key, bytes, { contentType: "application/pdf", upsert: true });
  if (error) throw new Error(`Signed contract upload failed: ${error.message}`);

  return key;
}

export async function handleEnvelopeCompleted(docusignEnvelopeId: string): Promise<void> {
  const envelope = await prisma.eSignEnvelope.findFirst({ where: { docusignEnvelopeId } });
  if (!envelope) return;
  await prisma.eSignEnvelope.update({ where: { id: envelope.id }, data: { status: ESignStatus.COMPLETED, completedAt: new Date() } });

  // Retrieve & store the executed PDF so the buyer can download their signed
  // contract. Best-effort: a retrieval blip must NOT roll back the signing
  // completion (already committed above). documentKey stays null on failure and
  // the download route reports "not yet available" until a later run stores it.
  try {
    const documentKey = await retrieveAndStoreSignedContract(docusignEnvelopeId, envelope.dealId);
    if (documentKey) {
      await prisma.eSignEnvelope.update({ where: { id: envelope.id }, data: { documentKey } });
    }
  } catch (err) {
    logger.error("[esign] signed contract retrieval/storage failed:", err);
  }
  // Authoritative external event (DocuSign reports the envelope signed): force the
  // SIGNED transition so it is always recorded, with DealStatusHistory.
  await advanceDealStatus(envelope.dealId, "SIGNED", { actorRole: "SYSTEM", force: true });
  const deal = await prisma.deal.findUnique({
    where: { id: envelope.dealId },
    include: { buyer: { include: { user: { select: { email: true } } } } },
  });
  if (deal) {
    await prisma.notification.create({
      data: {
        buyerId: deal.buyerId,
        title: "Documents signed successfully",
        body: `Your signing documents for deal ${deal.id.slice(-DEAL_ID_DISPLAY_LENGTH).toUpperCase()} have been completed. Your deal is now progressing to the next stage.`,
        type: "DEAL_STAGE_CHANGED",
      },
    }).catch(() => {});

    const buyerEmail = deal.buyer?.user?.email;
    if (buyerEmail) {
      try {
        const { sendContractSignedEmail } = await import("../email/resend.service");
        await sendContractSignedEmail({
          to: buyerEmail,
          firstName: deal.buyer.firstName ?? "there",
          dealId: deal.id,
          envelopeId: docusignEnvelopeId,
        });
      } catch (err) {
        logger.error("[esign] contract signed email failed:", err);
      }
    }
  }
  await prisma.adminAuditLog.create({
    data: {
      adminId: "system",
      adminEmail: "system@autolenis.com",
      action: "ESIGN_ENVELOPE_COMPLETED",
      entityType: "Deal",
      entityId: envelope.dealId,
      metadata: { docusignEnvelopeId, envelopeId: envelope.id },
    },
  }).catch(() => {});

  // CRM event spine — emit docusign_signed for the buyer once the envelope is
  // completed. Service-layer seam (called by the DocuSign webhook), so the
  // webhook perimeter file is untouched. Additive tail call: a failure never
  // affects the signing transition, which has already committed.
  try {
    if (deal?.buyer) {
      const { emitDomainEvent } = await import("@/lib/events/emit");
      await emitDomainEvent("docusign_signed", {
        domainEntityId: docusignEnvelopeId,
        contact: {
          email: deal.buyer.user?.email ?? null,
          phone: deal.buyer.phone,
          firstName: deal.buyer.firstName,
          lastName: deal.buyer.lastName,
          source: "buyer_signup",
        },
        data: {
          envelope_id: docusignEnvelopeId,
          deal_id: envelope.dealId,
          buyer_id: deal.buyerId,
        },
      });
    }
  } catch (err) {
    logger.error("[esign] docusign_signed emit failed:", err);
  }
}

export async function voidEnvelope(dealId: string, reason: string): Promise<void> {
  await prisma.eSignEnvelope.update({ where: { dealId }, data: { status: ESignStatus.VOIDED, voidedAt: new Date(), voidReason: reason } });
}

export async function resendEnvelope(dealId: string): Promise<void> {
  await sendEnvelope(dealId);
}

// Fetch the AUTHORITATIVE envelope status straight from DocuSign (the provider is
// the source of truth for whether a document is signed, declined, or voided —
// never our own SENT record). Returns the lowercased DocuSign status
// ("sent" | "delivered" | "completed" | "declined" | "voided" | …), or null in
// the mock/unconfigured path (no real envelope to poll). Throws on a real fetch
// failure so the reconciler can count it and retry next run. Used ONLY by the
// envelope reconciliation cron to recover a dropped webhook — it never marks a
// document signed on its own; it drives the same idempotent handlers the webhook
// does.
export async function getEnvelopeStatus(docusignEnvelopeId: string): Promise<string | null> {
  if (!isDocuSignConfigured()) return null;
  const config = getDocuSignConfig();
  const accessToken = await getDocuSignAccessToken();
  const url = `${config.baseUrl}/v2.1/accounts/${config.accountId}/envelopes/${docusignEnvelopeId}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" } });
  if (!res.ok) throw new Error(`DocuSign envelope status fetch failed (${res.status})`);
  const data = (await res.json()) as { status?: string };
  const status = (data.status ?? "").toLowerCase();
  return status || null;
}

// Authoritative DocuSign "declined" — the signer declined to sign. This is a
// truthful terminal exception: the envelope becomes DECLINED and the deal is
// deliberately LEFT at SIGNING_PENDING (never advanced to SIGNED), so the buyer
// and admin see the real state and an operator can void/resend or re-review.
// No silent limbo, no false SIGNED. Idempotent: a replayed decline is a no-op,
// and a COMPLETED envelope is authoritative and never downgraded.
export async function handleEnvelopeDeclined(docusignEnvelopeId: string, reason?: string): Promise<void> {
  const envelope = await prisma.eSignEnvelope.findFirst({ where: { docusignEnvelopeId } });
  if (!envelope) return;
  if (envelope.status === ESignStatus.DECLINED) return; // idempotent replay
  if (envelope.status === ESignStatus.COMPLETED) return; // completed is authoritative
  await prisma.eSignEnvelope.update({
    where: { id: envelope.id },
    data: { status: ESignStatus.DECLINED, voidReason: reason ?? "Declined by signer at DocuSign" },
  });
  await surfaceEsignException(envelope.dealId, "declined", docusignEnvelopeId, envelope.id, reason);
}

// Authoritative DocuSign "voided" (envelope voided at the provider, e.g. expired
// or cancelled). Same truthful-exception treatment as decline: mark VOIDED, do
// NOT advance the deal, surface it. Idempotent; never downgrades a COMPLETED
// envelope. Distinct from the admin `voidEnvelope(dealId)` path — this is the
// provider-initiated void seen by the webhook/reconciler (keyed by envelope id).
export async function handleEnvelopeVoidedByProvider(docusignEnvelopeId: string, reason?: string): Promise<void> {
  const envelope = await prisma.eSignEnvelope.findFirst({ where: { docusignEnvelopeId } });
  if (!envelope) return;
  if (envelope.status === ESignStatus.VOIDED) return; // idempotent replay
  if (envelope.status === ESignStatus.COMPLETED) return; // completed is authoritative
  await prisma.eSignEnvelope.update({
    where: { id: envelope.id },
    data: { status: ESignStatus.VOIDED, voidedAt: new Date(), voidReason: reason ?? "Voided at DocuSign" },
  });
  await surfaceEsignException(envelope.dealId, "voided", docusignEnvelopeId, envelope.id, reason);
}

// Shared truthful-exception surface for a declined/voided envelope: notify the
// buyer (in-app) and write an audit-log entry an operator can act on. Best-effort
// tail (never throws) — the envelope status change above has already committed.
async function surfaceEsignException(
  dealId: string,
  kind: "declined" | "voided",
  docusignEnvelopeId: string,
  envelopeId: string,
  reason?: string,
): Promise<void> {
  const deal = await prisma.deal.findUnique({ where: { id: dealId }, select: { buyerId: true } });
  if (deal) {
    await prisma.notification.create({
      data: {
        buyerId: deal.buyerId,
        title: "Signing could not be completed",
        body: `Your signing request was ${kind === "declined" ? "declined" : "cancelled"} and was not completed. Our team will follow up with next steps.`,
        type: "DEAL_STAGE_CHANGED",
      },
    }).catch(() => {});
  }
  await prisma.adminAuditLog.create({
    data: {
      adminId: "system",
      adminEmail: "system@autolenis.com",
      action: kind === "declined" ? "ESIGN_ENVELOPE_DECLINED" : "ESIGN_ENVELOPE_VOIDED",
      entityType: "Deal",
      entityId: dealId,
      metadata: { docusignEnvelopeId, envelopeId, reason: reason ?? null },
    },
  }).catch(() => {});
}
