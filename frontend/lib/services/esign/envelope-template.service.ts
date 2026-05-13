// lib/services/esign/envelope-template.service.ts
// Creates a DocuSign envelope from a template for a given deal.
// Uses JWT Grant authentication (already implemented in docusign-auth.service.ts).
// When DocuSign credentials are NOT configured, returns a graceful error — no silent mocks.

import { getDocuSignConfig, isDocuSignConfigured, getDocuSignAccessToken } from "./docusign-auth.service";
import { prisma } from "@/lib/prisma";

interface EnvelopeResult {
  envelopeId: string | null;
  signingUrl:  string | null;
  error:       string | null;
  mock:        boolean;
}

export async function createDealerEnvelopeFromTemplate(dealId: string): Promise<EnvelopeResult> {
  // Graceful degradation — never silently mock when this is checked
  if (!isDocuSignConfigured()) {
    console.error("[docusign] credentials not configured — cannot create envelope");
    await prisma.eSignEnvelope.upsert({
      where:  { dealId },
      create: { dealId, status: "PENDING" },
      update: {},
    });
    return {
      envelopeId: null,
      signingUrl:  null,
      error:       "DocuSign is not configured. Please contact support.",
      mock:        false,
    };
  }

  const config = getDocuSignConfig();

  // Fetch deal with buyer details for pre-filling the template
  const deal = await prisma.deal.findFirst({
    where:   { id: dealId },
    include: {
      buyer: {
        select: { firstName: true, lastName: true, userId: true },
      },
      offer: {
        include: {
          dealer: { select: { dealershipName: true } },
        },
      },
    },
  });

  if (!deal) {
    return { envelopeId: null, signingUrl: null, error: "Deal not found", mock: false };
  }

  const buyer     = deal.buyer;
  const otdAmount = (deal.offer.otdPriceCents / 100).toFixed(2);

  // Get JWT access token
  let token: string;
  try {
    token = await getDocuSignAccessToken();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[docusign] JWT auth failed:", msg);
    return { envelopeId: null, signingUrl: null, error: `Authentication failed: ${msg}`, mock: false };
  }

  const envelopesUrl = `${config.baseUrl}/v2.1/accounts/${config.accountId}/envelopes`;

  // STEP A: Create envelope from template
  const envelopePayload = {
    templateId: config.dealerTemplateId,
    status:     "sent",
    templateRoles: [
      {
        roleName:     "Buyer",
        name:         `${buyer.firstName ?? ""} ${buyer.lastName ?? ""}`.trim() || "Buyer",
        // noreply is intentional: for embedded signing (clientUserId set), DocuSign does not
        // send emails to this address — identity is established via clientUserId alone.
        email:        "noreply@autolenis.com",
        clientUserId: deal.buyerId,
        tabs: {
          textTabs: [
            { tabLabel: "otdAmount",  value: otdAmount },
            { tabLabel: "dealId",     value: deal.id.slice(-8).toUpperCase() },
            { tabLabel: "dealerName", value: deal.offer.dealer.dealershipName ?? "" },
          ],
        },
      },
    ],
  };

  let envelopeId: string;
  try {
    const createRes = await fetch(envelopesUrl, {
      method:  "POST",
      headers: {
        Authorization:  `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept:         "application/json",
      },
      body: JSON.stringify(envelopePayload),
    });

    if (!createRes.ok) {
      const errBody = await createRes.text().catch(() => "");
      console.error(`[docusign] envelope creation failed (${createRes.status}):`, errBody);
      return { envelopeId: null, signingUrl: null, error: `DocuSign error ${createRes.status}`, mock: false };
    }

    const createData = await createRes.json() as { envelopeId?: string };
    if (!createData.envelopeId) {
      return { envelopeId: null, signingUrl: null, error: "DocuSign returned no envelope ID", mock: false };
    }
    envelopeId = createData.envelopeId;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[docusign] envelope creation threw:", msg);
    return { envelopeId: null, signingUrl: null, error: `Network error: ${msg}`, mock: false };
  }

  // STEP B: Get embedded signing URL (Recipient View)
  const returnUrl = config.returnUrl || `${(process.env.NEXT_PUBLIC_APP_URL ?? "https://autolenis.com").trim()}/buyer/esign?signed=true`;
  const viewUrl   = `${envelopesUrl}/${envelopeId}/views/recipient`;

  let signingUrl: string;
  try {
    const viewRes = await fetch(viewUrl, {
      method:  "POST",
      headers: {
        Authorization:  `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept:         "application/json",
      },
      body: JSON.stringify({
        returnUrl,
        authenticationMethod: "none",
        // Must match the email used in the envelope templateRoles entry. For embedded
        // signing (clientUserId set), DocuSign uses clientUserId for identity — the email
        // is only used for matching, not for sending.
        email:        "noreply@autolenis.com",
        userName:     `${buyer.firstName ?? ""} ${buyer.lastName ?? ""}`.trim() || "Buyer",
        clientUserId: deal.buyerId,
      }),
    });

    if (!viewRes.ok) {
      const errBody = await viewRes.text().catch(() => "");
      console.error(`[docusign] signing URL failed (${viewRes.status}):`, errBody);
      // Envelope was created — store the ID even if we can't get the signing URL
      await prisma.eSignEnvelope.upsert({
        where:  { dealId },
        create: { dealId, docusignEnvelopeId: envelopeId, status: "SENT", sentAt: new Date() },
        update: { docusignEnvelopeId: envelopeId, status: "SENT", sentAt: new Date() },
      });
      return { envelopeId, signingUrl: null, error: "Could not generate signing URL. Contact support.", mock: false };
    }

    const viewData = await viewRes.json() as { url?: string };
    if (!viewData.url) {
      return { envelopeId, signingUrl: null, error: "DocuSign returned no signing URL", mock: false };
    }
    signingUrl = viewData.url;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[docusign] signing URL threw:", msg);
    return { envelopeId, signingUrl: null, error: `Network error: ${msg}`, mock: false };
  }

  // STEP C: Persist envelope to DB
  await prisma.eSignEnvelope.upsert({
    where:  { dealId },
    create: { dealId, docusignEnvelopeId: envelopeId, status: "SENT", sentAt: new Date() },
    update: { docusignEnvelopeId: envelopeId, status: "SENT", sentAt: new Date() },
  });

  return { envelopeId, signingUrl, error: null, mock: false };
}
