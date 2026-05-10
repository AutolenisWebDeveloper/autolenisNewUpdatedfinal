// Email helpers for the Vehicle Offer system.
// Uses the same Resend client + FROM constant pattern as resend.service.ts.
// All sends are best-effort: callers should wrap in try/catch and log errors;
// failures must never block the user-facing API response.

import { Resend } from "resend";

const FROM_NAME = process.env.FROM_NAME ?? "AutoLenis";
const FROM_EMAIL = "noreply@autolenis.com";
const FROM = `${FROM_NAME} <${FROM_EMAIL}>`;

let client: Resend | null = null;
function getResend(): Resend | null {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey || apiKey.includes("placeholder")) return null;
  if (!client) client = new Resend(apiKey);
  return client;
}

async function sendRaw(to: string, subject: string, html: string): Promise<void> {
  const resend = getResend();
  if (!resend) {
    console.warn(`[vehicle-offers email] Resend not configured — skipped: ${subject} -> ${to}`);
    return;
  }
  try {
    await resend.emails.send({ from: FROM, to, subject, html });
  } catch (err) {
    console.error(`[vehicle-offers email] Send failed: ${subject} -> ${to}`, err);
  }
}

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://autolenis.com";
const ADMIN_EMAIL = process.env.ADMIN_NOTIFICATION_EMAIL ?? "admin@autolenis.com";

const wrap = (inner: string) => `
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;background:#F8F9FB;padding:32px 16px">
  <div style="max-width:560px;margin:0 auto;background:#FFFFFF;border:1px solid #E5E7EB;border-radius:16px;padding:32px">
    ${inner}
    <hr style="border:0;border-top:1px solid #E5E7EB;margin:32px 0 16px"/>
    <p style="color:#94A3B8;font-size:11px;text-align:center;margin:0">AutoLenis &middot; ${APP_URL}</p>
  </div>
</div>`;

const button = (href: string, label: string) =>
  `<a href="${href}" style="display:inline-block;background:#0B5FD1;color:#FFFFFF;font-weight:600;font-size:14px;padding:12px 24px;border-radius:8px;text-decoration:none">${label}</a>`;

const escape = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// ─── Vehicle request (public form) ────────────────────────────────────────
export async function sendVehicleRequestAdminNotification(params: {
  fullName: string;
  email: string;
  phone: string;
  zip: string;
  vehicleType: string;
  preferredMake?: string;
  preferredModel?: string;
  minYear?: number;
  maxYear?: number;
  budget: string;
  newOrUsed: string;
  financingNeeded: string;
  notes?: string;
}) {
  const rows: [string, string][] = [
    ["Name", params.fullName],
    ["Email", params.email],
    ["Phone", params.phone],
    ["ZIP", params.zip],
    ["Vehicle Type", params.vehicleType],
    ["Preferred Make", params.preferredMake ?? "Any"],
    ["Preferred Model", params.preferredModel ?? "Any"],
    ["Year Range", `${params.minYear ?? "Any"} – ${params.maxYear ?? "Any"}`],
    ["Budget", params.budget],
    ["New or Used", params.newOrUsed],
    ["Financing", params.financingNeeded],
  ];
  if (params.notes) rows.push(["Notes", params.notes]);

  const inner = `
    <p style="color:#0B5FD1;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.12em;margin:0 0 4px">New Vehicle Request</p>
    <h1 style="color:#111827;font-size:22px;font-weight:700;margin:0 0 16px">${escape(params.fullName)} wants a vehicle</h1>
    <table style="width:100%;border-collapse:collapse">
      ${rows.map(([k, v]) => `<tr><td style="padding:8px 0;color:#6B7280;font-size:13px;width:140px">${k}</td><td style="padding:8px 0;color:#111827;font-size:13px;font-weight:500">${escape(String(v))}</td></tr>`).join("")}
    </table>
    <div style="margin-top:24px">
      ${button(`${APP_URL}/admin/vehicle-offers/new`, "Create Dealer Offer Link →")}
    </div>`;
  await sendRaw(ADMIN_EMAIL, `New Vehicle Request — ${params.fullName}`, wrap(inner));
}

export async function sendVehicleRequestConfirmation(to: string, fullName: string) {
  const inner = `
    <h1 style="color:#111827;font-size:22px;font-weight:700;margin:0 0 8px">Thanks, ${escape(fullName)} — we got your request</h1>
    <p style="color:#4B5563;font-size:14px;line-height:1.6;margin:0 0 16px">Our team will review your details and reach out within 24 hours with next steps.</p>
    <p style="color:#4B5563;font-size:14px;line-height:1.6;margin:0">In the meantime, browse vehicles on our marketplace.</p>
    <div style="margin-top:24px">${button(APP_URL, "Visit AutoLenis →")}</div>`;
  await sendRaw(to, "We received your vehicle request — AutoLenis", wrap(inner));
}

// ─── Dealer offer submission ──────────────────────────────────────────────
type VehicleSummary = {
  vehicleUrl: string;
  year: number;
  make: string;
  model: string;
  trim?: string;
  condition: string;
  offerPriceCents: number;
  availability: string;
  tradeInAccepted: boolean;
  financingAvailable: boolean;
  warrantyIncluded: boolean;
  warrantyDetails?: string;
};

function vehicleBlock(v: VehicleSummary, idx: number): string {
  const trim = v.trim ? ` ${escape(v.trim)}` : "";
  const warranty = v.warrantyIncluded
    ? `Yes${v.warrantyDetails ? ` — ${escape(v.warrantyDetails)}` : ""}`
    : "No";
  return `
    <div style="border:1px solid #E5E7EB;border-radius:12px;padding:16px;margin-top:12px">
      <p style="color:#0B5FD1;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;margin:0 0 6px">Vehicle Offer ${idx + 1}</p>
      <p style="color:#111827;font-size:16px;font-weight:700;margin:0 0 4px">${v.year} ${escape(v.make)} ${escape(v.model)}${trim}</p>
      <p style="color:#6B7280;font-size:12px;margin:0 0 8px">${escape(v.condition)}</p>
      <p style="color:#111827;font-size:14px;margin:0 0 4px"><strong>Price (OTD):</strong> $${(v.offerPriceCents / 100).toLocaleString()}</p>
      <p style="color:#111827;font-size:14px;margin:0 0 4px"><strong>Availability:</strong> ${escape(v.availability)}</p>
      <p style="color:#4B5563;font-size:13px;margin:0 0 4px">Trade-In: ${v.tradeInAccepted ? "Yes" : "No"} &middot; Financing: ${v.financingAvailable ? "Yes" : "No"} &middot; Warranty: ${warranty}</p>
      <p style="margin:8px 0 0"><a href="${escape(v.vehicleUrl)}" style="color:#0B5FD1;font-size:13px;font-weight:600;text-decoration:none">🔗 View Vehicle →</a></p>
    </div>`;
}

export async function sendDealerOfferAdminNotification(params: {
  offerId: string;
  vehicleOfferLabel: string;       // "2024 Toyota Camry"
  dealershipName: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  vehicles: VehicleSummary[];
  notes?: string;
}) {
  const detailUrl = `${APP_URL}/admin/vehicle-offers/${params.offerId}`;
  const inner = `
    <p style="color:#0B5FD1;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.12em;margin:0 0 4px">New Dealer Offer</p>
    <h1 style="color:#111827;font-size:22px;font-weight:700;margin:0 0 4px">${escape(params.dealershipName)}</h1>
    <p style="color:#6B7280;font-size:13px;margin:0 0 16px">submitted offers for: <strong>${escape(params.vehicleOfferLabel)}</strong></p>

    <div style="background:#F8F9FB;border-radius:12px;padding:16px;margin-bottom:16px">
      <p style="color:#374151;font-size:13px;margin:0 0 4px"><strong>Contact:</strong> ${escape(params.contactName)}</p>
      <p style="color:#374151;font-size:13px;margin:0 0 4px">${escape(params.contactEmail)} &middot; ${escape(params.contactPhone)}</p>
    </div>

    ${params.vehicles.map(vehicleBlock).join("")}

    ${params.notes ? `<p style="color:#4B5563;font-size:13px;background:#F8F9FB;border-radius:8px;padding:12px;margin-top:16px"><strong>Dealer notes:</strong> ${escape(params.notes)}</p>` : ""}

    <p style="color:#475569;font-size:12px;margin-top:16px">
      AGREEMENTS:<br/>
      &nbsp;&nbsp;✓ Finder fee acknowledged<br/>
      &nbsp;&nbsp;✓ Offer accuracy confirmed
    </p>

    <div style="margin-top:24px">${button(detailUrl, "View All Submissions →")}</div>`;
  await sendRaw(ADMIN_EMAIL, `New Dealer Offer — ${params.dealershipName}`, wrap(inner));
}

export async function sendDealerOfferConfirmation(params: {
  to: string;
  contactName: string;
  dealershipName: string;
  vehicleOfferLabel: string;
}) {
  const inner = `
    <h1 style="color:#111827;font-size:22px;font-weight:700;margin:0 0 8px">Thanks, ${escape(params.contactName)} — we got your offer</h1>
    <p style="color:#4B5563;font-size:14px;line-height:1.6;margin:0 0 16px">Your offer for the <strong>${escape(params.vehicleOfferLabel)}</strong> on behalf of <strong>${escape(params.dealershipName)}</strong> has been received.</p>
    <p style="color:#4B5563;font-size:14px;line-height:1.6;margin:0 0 12px">AutoLenis will review your offer and contact you within 24 hours.</p>
    <p style="color:#94A3B8;font-size:12px;margin-top:16px"><em>Reminder: by submitting an offer, your dealership has agreed to pay AutoLenis a finder's fee upon successful completion of a sale. Fee terms will be confirmed in writing before deal finalization.</em></p>`;
  await sendRaw(params.to, "Your offer was received — AutoLenis", wrap(inner));
}

// ─── Buyer review (admin sends curated offers to buyer) ───────────────────
export async function sendBuyerOfferReviewEmail(params: {
  to: string;
  buyerName: string;
  reviewToken: string;
  itemCount: number;
  adminMessage?: string;
}) {
  const reviewUrl = `${APP_URL}/buyer-offer-review/${params.reviewToken}`;
  const plural = params.itemCount === 1 ? "offer" : "offers";
  const inner = `
    <p style="color:#0B5FD1;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.12em;margin:0 0 4px">Vehicle Offers Ready</p>
    <h1 style="color:#111827;font-size:22px;font-weight:700;margin:0 0 8px">Hi ${escape(params.buyerName)},</h1>
    <p style="color:#4B5563;font-size:14px;line-height:1.6;margin:0 0 16px">We found <strong>${params.itemCount}</strong> vehicle ${plural} matching your request. Click below to review each offer and let us know which interest you.</p>
    ${params.adminMessage ? `<div style="background:#EFF6FF;border:1px solid #BFDBFE;border-radius:12px;padding:14px;margin-bottom:20px"><p style="color:#0B5FD1;font-size:12px;font-weight:600;margin:0 0 4px">Message from AutoLenis:</p><p style="color:#374151;font-size:13px;margin:0;line-height:1.5">${escape(params.adminMessage)}</p></div>` : ""}
    <div style="margin:24px 0">${button(reviewUrl, "Review Your Offers →")}</div>
    <p style="color:#94A3B8;font-size:12px;margin-top:16px">This link is personalized for you. Offers are presented by our verified dealer network.</p>`;
  const subject = `You have ${params.itemCount} vehicle ${plural} to review — AutoLenis`;
  await sendRaw(params.to, subject, wrap(inner));
}

// ─── Buyer accepted an offer (notify admin + dealer) ──────────────────────
export async function sendBuyerAcceptedAdminNotification(params: {
  buyerName: string;
  buyerEmail: string;
  vehicleLabel: string;
  vehicleUrl: string;
  offerPriceCents: number;
  availability: string;
  dealershipName: string;
  dealerContactName: string;
  dealerContactEmail: string;
  dealerContactPhone: string;
}) {
  const inner = `
    <p style="color:#059669;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.12em;margin:0 0 4px">🎉 Buyer Accepted Offer</p>
    <h1 style="color:#111827;font-size:22px;font-weight:700;margin:0 0 16px">${escape(params.buyerName)} accepted</h1>

    <div style="background:#F8F9FB;border-radius:12px;padding:16px;margin-bottom:16px">
      <p style="color:#111827;font-size:14px;margin:0 0 4px"><strong>Buyer:</strong> ${escape(params.buyerName)} (${escape(params.buyerEmail)})</p>
      <p style="color:#111827;font-size:14px;margin:0 0 4px"><strong>Vehicle:</strong> ${escape(params.vehicleLabel)}</p>
      <p style="color:#111827;font-size:14px;margin:0 0 4px"><strong>Price (OTD):</strong> $${(params.offerPriceCents / 100).toLocaleString()}</p>
      <p style="color:#111827;font-size:14px;margin:0 0 4px"><strong>Availability:</strong> ${escape(params.availability)}</p>
      <p style="margin:8px 0 0"><a href="${escape(params.vehicleUrl)}" style="color:#0B5FD1;font-size:13px;font-weight:600;text-decoration:none">🔗 View Vehicle →</a></p>
    </div>

    <div style="background:#F8F9FB;border-radius:12px;padding:16px">
      <p style="color:#0B5FD1;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;margin:0 0 8px">Dealer Contact</p>
      <p style="color:#111827;font-size:14px;margin:0 0 4px"><strong>${escape(params.dealershipName)}</strong></p>
      <p style="color:#374151;font-size:13px;margin:0 0 4px">${escape(params.dealerContactName)}</p>
      <p style="color:#374151;font-size:13px;margin:0 0 4px">${escape(params.dealerContactEmail)} &middot; ${escape(params.dealerContactPhone)}</p>
    </div>

    <p style="color:#4B5563;font-size:13px;margin-top:16px">Next step: contact the dealer to finalize the deal.</p>`;
  await sendRaw(ADMIN_EMAIL, `Buyer accepted: ${params.buyerName} → ${params.dealershipName}`, wrap(inner));
}

export async function sendDealerAcceptanceNotification(params: {
  to: string;
  contactName: string;
  buyerName: string;
  vehicleLabel: string;
}) {
  const inner = `
    <p style="color:#059669;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.12em;margin:0 0 4px">Offer Accepted</p>
    <h1 style="color:#111827;font-size:22px;font-weight:700;margin:0 0 8px">Good news, ${escape(params.contactName)}</h1>
    <p style="color:#4B5563;font-size:14px;line-height:1.6;margin:0 0 16px">${escape(params.buyerName)} has accepted your offer for the <strong>${escape(params.vehicleLabel)}</strong>. AutoLenis will be in touch shortly to coordinate the next steps.</p>`;
  await sendRaw(params.to, `Offer accepted — ${params.vehicleLabel}`, wrap(inner));
}
