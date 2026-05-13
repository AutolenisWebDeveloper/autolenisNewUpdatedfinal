// lib/services/esign/dealer-marketplace-agreement.service.ts
//
// Sends the AutoLenis marketplace agreement to a newly-onboarded dealer
// via DocuSign. Unlike `createDealerEnvelopeFromTemplate`, this flow has
// no `Deal` record — the envelope is tied to the `Dealer` row directly.
//
// Flow:
//   1. Authenticate via JWT Grant (same as deal envelopes).
//   2. Create envelope from `DOCUSIGN_DEALER_TEMPLATE_ID`, signer = dealer
//      contact (email-delivery, no clientUserId — dealer signs from the
//      email link, not an embedded page).
//   3. Persist envelope ID + sentAt on the Dealer row.
//
// The function is intentionally non-blocking from the caller's perspective:
// callers should `.catch()` it. Any failure here must never block dealer
// onboarding completion.
import { prisma } from "@/lib/prisma";
import {
  getDocuSignAccessToken,
  getDocuSignConfig,
  isDocuSignConfigured,
} from "./docusign-auth.service";
import { sendDealerAgreementPendingEmail } from "@/lib/services/email/resend.service";

export interface MarketplaceEnvelopeResult {
  envelopeId: string | null;
  error: string | null;
  skipped: boolean;
}

export async function sendDealerMarketplaceAgreement(params: {
  dealerId: string;
  email: string;
  name: string;
}): Promise<MarketplaceEnvelopeResult> {
  const { dealerId, email, name } = params;

  if (!isDocuSignConfigured()) {
    console.warn("[dealer-marketplace] DocuSign not configured — skipping envelope send");
    return { envelopeId: null, error: null, skipped: true };
  }

  // Idempotency — never send twice for the same dealer.
  const existing = await prisma.dealer.findUnique({
    where: { id: dealerId },
    select: { marketplaceAgreementEnvelopeId: true },
  });
  if (existing?.marketplaceAgreementEnvelopeId) {
    return { envelopeId: existing.marketplaceAgreementEnvelopeId, error: null, skipped: true };
  }

  const config = getDocuSignConfig();
  if (!config.dealerTemplateId) {
    console.error("[dealer-marketplace] DOCUSIGN_DEALER_TEMPLATE_ID is empty");
    return { envelopeId: null, error: "Template not configured", skipped: false };
  }

  let token: string;
  try {
    token = await getDocuSignAccessToken();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[dealer-marketplace] JWT auth failed:", msg);
    return { envelopeId: null, error: `Authentication failed: ${msg}`, skipped: false };
  }

  const envelopesUrl = `${config.baseUrl}/v2.1/accounts/${config.accountId}/envelopes`;

  // Email-delivery (no clientUserId) — DocuSign emails the dealer with a
  // signing link. We store a customField with the dealerId so the webhook
  // can map the completed envelope back to the dealer row.
  const envelopePayload = {
    templateId: config.dealerTemplateId,
    status: "sent",
    emailSubject: "AutoLenis — Please sign your dealer marketplace agreement",
    templateRoles: [
      {
        roleName: "Dealer",
        name: name || "Dealer",
        email,
      },
    ],
    customFields: {
      textCustomFields: [
        { name: "dealerId", value: dealerId, show: "false", required: "false" },
        { name: "envelopeKind", value: "DEALER_MARKETPLACE_AGREEMENT", show: "false", required: "false" },
      ],
    },
  };

  let envelopeId: string;
  try {
    const res = await fetch(envelopesUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(envelopePayload),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      console.error(`[dealer-marketplace] envelope creation failed (${res.status}):`, errText);
      return { envelopeId: null, error: `DocuSign error ${res.status}`, skipped: false };
    }
    const data = (await res.json()) as { envelopeId?: string };
    if (!data.envelopeId) {
      return { envelopeId: null, error: "DocuSign returned no envelope ID", skipped: false };
    }
    envelopeId = data.envelopeId;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[dealer-marketplace] envelope creation threw:", msg);
    return { envelopeId: null, error: `Network error: ${msg}`, skipped: false };
  }

  await prisma.dealer.update({
    where: { id: dealerId },
    data: {
      marketplaceAgreementEnvelopeId: envelopeId,
      marketplaceAgreementSentAt: new Date(),
    },
  });

  // Notify dealer that their agreement is awaiting signature — non-blocking.
  const dealerRow = await prisma.dealer.findUnique({
    where: { id: dealerId },
    select: { dealershipName: true },
  });
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "https://autolenis.com").trim();
  await sendDealerAgreementPendingEmail({
    to: email,
    contactName: name || dealerRow?.dealershipName || "Dealer",
    dealershipName: dealerRow?.dealershipName ?? "",
    signingUrl: `${appUrl}/dealer/onboarding`,
  }).catch(err => console.error("[dealer-marketplace] pending email failed:", err));

  return { envelopeId, error: null, skipped: false };
}

// Called by the DocuSign webhook when an envelope-completed event fires.
// Returns `true` if this envelope belonged to a dealer marketplace agreement
// (and was handled), `false` otherwise — webhook caller can then fall back
// to the deal-envelope handler.
export async function handleDealerMarketplaceEnvelopeCompleted(
  docusignEnvelopeId: string,
): Promise<boolean> {
  const dealer = await prisma.dealer.findFirst({
    where: { marketplaceAgreementEnvelopeId: docusignEnvelopeId },
    select: { id: true, userId: true, marketplaceAgreementSignedAt: true },
  });
  if (!dealer) return false;

  if (!dealer.marketplaceAgreementSignedAt) {
    await prisma.dealer.update({
      where: { id: dealer.id },
      data: { marketplaceAgreementSignedAt: new Date() },
    });
    await prisma.adminAuditLog.create({
      data: {
        adminId: "system",
        adminEmail: "system@autolenis.com",
        action: "DEALER_MARKETPLACE_AGREEMENT_SIGNED",
        entityType: "Dealer",
        entityId: dealer.id,
        metadata: { docusignEnvelopeId },
      },
    }).catch(() => {});
  }

  return true;
}
