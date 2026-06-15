// lib/services/esign/esign.service.ts
// System 9 — DocuSign JWT auth + envelope lifecycle
import { prisma } from "@/lib/prisma";
import { ESignStatus } from "@prisma/client";
import { advanceDealStatus } from "@/lib/services/deal/deal.service";
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
    console.error("[esign.service] createEnvelope error:", error);
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

export async function handleEnvelopeCompleted(docusignEnvelopeId: string): Promise<void> {
  const envelope = await prisma.eSignEnvelope.findFirst({ where: { docusignEnvelopeId } });
  if (!envelope) return;
  await prisma.eSignEnvelope.update({ where: { id: envelope.id }, data: { status: ESignStatus.COMPLETED, completedAt: new Date() } });
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
        console.error("[esign] contract signed email failed:", err);
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
    console.error("[esign] docusign_signed emit failed:", err);
  }
}

export async function voidEnvelope(dealId: string, reason: string): Promise<void> {
  await prisma.eSignEnvelope.update({ where: { dealId }, data: { status: ESignStatus.VOIDED, voidedAt: new Date(), voidReason: reason } });
}

export async function resendEnvelope(dealId: string): Promise<void> {
  await sendEnvelope(dealId);
}
