// Email helpers for the Vehicle Offer system.
// Uses the same Resend client + FROM constant pattern as resend.service.ts.
// All sends are best-effort: callers should wrap in try/catch and log errors;
// failures must never block the user-facing API response.

import { logger } from "@/lib/logger";
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
    logger.warn(`[vehicle-offers email] Resend not configured — skipped: ${subject} -> ${to}`);
    return;
  }
  try {
    await resend.emails.send({ from: FROM, to, subject, html });
  } catch (err) {
    logger.error(`[vehicle-offers email] Send failed: ${subject} -> ${to}`, err);
  }
}

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL ?? "https://autolenis.com").trim();
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
/**
 * The admin destination for a new vehicle request.
 *
 * /admin/vehicle-requests/[id] resolves BOTH id spaces: a VehicleRequest id
 * redirects to the canonical command view at /admin/requests/[id]; a
 * Notification id renders the legacy read-only view. Prefer the VehicleRequest
 * id so the operator lands on the surface that can actually ACTION the request
 * (send to dealers, create an offer, change status) rather than the legacy view,
 * which can only display it. Passing the Notification id made the link "work"
 * while silently landing on the weaker surface — a failure no broken-link check
 * would ever catch.
 *
 * Returns a PATH; the caller prefixes APP_URL.
 */
export function adminVehicleRequestPath(ids: {
  vehicleRequestId?: string;
  notificationId?: string;
}): string {
  const detailId = ids.vehicleRequestId ?? ids.notificationId;
  return detailId ? `/admin/vehicle-requests/${detailId}` : "/admin/vehicle-requests";
}

export async function sendVehicleRequestAdminNotification(params: {
  fullName: string;
  email: string;
  phone: string;
  zip: string;
  city?: string;
  state?: string;
  vehicleType: string;
  preferredMake?: string;
  preferredModel?: string;
  minYear?: number;
  maxYear?: number;
  budget: string;
  newOrUsed: string;
  financingNeeded: string;
  contactMethod?: string;
  timeline?: string;
  interiorColor?: string;
  mustHaveFeatures?: string;
  openToAlternatives?: boolean;
  desiredMonthly?: string;
  downPaymentAvail?: string;
  hasTradeIn?: boolean;
  tradeYear?: string;
  tradeMake?: string;
  tradeModel?: string;
  notes?: string;
  notificationId?: string;
  /** Canonical VehicleRequest id. Preferred over notificationId for the CTA. */
  vehicleRequestId?: string;
}) {
  const rows: [string, string][] = [
    ["Name", params.fullName],
    ["Email", params.email],
    ["Phone", params.phone],
    ["Location", `${params.city ? `${params.city}, ` : ""}${params.state ?? ""} ${params.zip}`.trim()],
  ];
  if (params.contactMethod) rows.push(["Preferred Contact", params.contactMethod]);
  if (params.timeline) rows.push(["Buying Timeline", params.timeline]);
  rows.push(
    ["Vehicle Type", params.vehicleType],
    ["Preferred Make", params.preferredMake ?? "Any"],
    ["Preferred Model", params.preferredModel ?? "Any"],
    ["Year Range", `${params.minYear ?? "Any"} – ${params.maxYear ?? "Any"}`],
    ["New or Used", params.newOrUsed],
  );
  if (params.interiorColor) rows.push(["Interior Color", params.interiorColor]);
  if (typeof params.openToAlternatives === "boolean") {
    rows.push(["Open to Alternatives", params.openToAlternatives ? "Yes" : "No — specific only"]);
  }
  if (params.mustHaveFeatures) rows.push(["Must-Have Features", params.mustHaveFeatures]);
  rows.push(
    ["Budget", params.budget],
    ["Financing", params.financingNeeded],
  );
  if (params.desiredMonthly) rows.push(["Monthly Goal", params.desiredMonthly]);
  if (params.downPaymentAvail) rows.push(["Down Payment Available", params.downPaymentAvail]);
  if (typeof params.hasTradeIn === "boolean") {
    rows.push([
      "Trade-In",
      params.hasTradeIn
        ? `Yes — ${[params.tradeYear, params.tradeMake, params.tradeModel].filter(Boolean).join(" ") || "details below"}`
        : "No",
    ]);
  }
  if (params.notes) rows.push(["Notes", params.notes]);

  const detailUrl = `${APP_URL}${adminVehicleRequestPath(params)}`;

  const inner = `
    <p style="color:#0B5FD1;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.12em;margin:0 0 4px">New Vehicle Request</p>
    <h1 style="color:#111827;font-size:22px;font-weight:700;margin:0 0 16px">${escape(params.fullName)} wants a vehicle</h1>
    <table style="width:100%;border-collapse:collapse">
      ${rows.map(([k, v]) => `<tr><td style="padding:8px 0;color:#6B7280;font-size:13px;width:160px;vertical-align:top">${k}</td><td style="padding:8px 0;color:#111827;font-size:13px;font-weight:500">${escape(String(v))}</td></tr>`).join("")}
    </table>
    <div style="margin-top:24px">
      ${button(detailUrl, "View Full Request →")}
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

// ─── Vehicle request — step 2 completion (buyer-supplied detail) ──────────
export async function sendVehicleRequestCompletedConfirmation(
  to: string,
  firstName: string,
  summaryRows: [string, string][],
) {
  const rows = summaryRows.length
    ? `<table style="width:100%;border-collapse:collapse;margin:8px 0 0">
        ${summaryRows
          .map(
            ([k, v]) =>
              `<tr><td style="padding:8px 0;color:#6B7280;font-size:13px;width:170px;vertical-align:top">${escape(k)}</td><td style="padding:8px 0;color:#111827;font-size:13px;font-weight:500">${escape(v)}</td></tr>`,
          )
          .join("")}
       </table>`
    : "";
  const inner = `
    <p style="color:#0B5FD1;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.12em;margin:0 0 4px">Request Complete</p>
    <h1 style="color:#111827;font-size:22px;font-weight:700;margin:0 0 8px">Your vehicle request is complete, ${escape(firstName)}</h1>
    <p style="color:#4B5563;font-size:14px;line-height:1.6;margin:0 0 16px">Thanks for the detail — dealers will compete for you soon. Here's a summary of what you told us:</p>
    ${rows}
    <p style="color:#4B5563;font-size:14px;line-height:1.6;margin:16px 0 0">Activate your private dealer auction to put verified dealers to work competing for your exact vehicle.</p>
    <div style="margin-top:24px">${button(`${APP_URL}/auth/signup?plan=standard&source=ty`, "Activate my auction →")}</div>`;
  await sendRaw(
    to,
    "Your vehicle request is complete — dealers will compete for you soon",
    wrap(inner),
  );
}

export async function sendVehicleRequestCompletedAdminNotification(params: {
  fullName: string;
  email: string;
  summaryLine: string;
  summaryRows: [string, string][];
  vehicleRequestId?: string;
}) {
  const detailUrl = `${APP_URL}/admin/vehicle-requests`;
  const inner = `
    <p style="color:#0B5FD1;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.12em;margin:0 0 4px">Vehicle Request Completed</p>
    <h1 style="color:#111827;font-size:20px;font-weight:700;margin:0 0 6px">${escape(params.summaryLine)}</h1>
    <p style="color:#6B7280;font-size:13px;margin:0 0 16px">${escape(params.fullName)} &middot; ${escape(params.email)}</p>
    <table style="width:100%;border-collapse:collapse">
      ${params.summaryRows
        .map(
          ([k, v]) =>
            `<tr><td style="padding:8px 0;color:#6B7280;font-size:13px;width:170px;vertical-align:top">${escape(k)}</td><td style="padding:8px 0;color:#111827;font-size:13px;font-weight:500">${escape(v)}</td></tr>`,
        )
        .join("")}
    </table>
    <div style="margin-top:24px">${button(detailUrl, "View Vehicle Requests →")}</div>`;
  await sendRaw(ADMIN_EMAIL, `Vehicle Request Completed — ${params.fullName}`, wrap(inner));
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
  documentUrls?: string[];
  documentNames?: string[];
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

    ${params.documentUrls && params.documentUrls.length > 0 ? `
      <div style="background:#EFF6FF;border-radius:12px;padding:16px;margin-top:16px;border:1px solid #BFDBFE">
        <p style="color:#1E40AF;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;margin:0 0 10px">
          📎 Supporting Documents (${params.documentUrls.length})
        </p>
        ${params.documentUrls.map((url, i) => `
          <div style="margin-bottom:8px">
            <a href="${escape(url)}" target="_blank" rel="noopener noreferrer"
               style="color:#0B5FD1;font-size:13px;font-weight:600;text-decoration:none;background:#DBEAFE;border-radius:6px;padding:6px 12px;display:inline-block">
              View ${escape(params.documentNames?.[i] ?? `Document ${i + 1}`)} →
            </a>
          </div>
        `).join("")}
      </div>
    ` : ""}

    <p style="color:#475569;font-size:12px;margin-top:16px">
      AGREEMENTS:<br/>
      &nbsp;&nbsp;✓ Finder fee acknowledged<br/>
      &nbsp;&nbsp;✓ Offer accuracy confirmed
    </p>

    <div style="margin-top:24px">${button(detailUrl, "View All Submissions →")}</div>`;
  await sendRaw(ADMIN_EMAIL, `New Dealer Offer — ${params.dealershipName}`, wrap(inner));
}

// ─── Outside dealer auction offer (auction flow, not VehicleOffer flow) ───
// Sent to admin when an outside/unregistered dealer submits an offer for a
// buyer auction via their tokenized email link, or when an admin enters one
// manually on their behalf.
export async function sendOutsideDealerAuctionOfferAdminNotification(params: {
  auctionId: string;
  offerId: string;
  dealershipName: string;
  contactName?: string | null;
  contactEmail: string;
  contactPhone?: string | null;
  otdPriceCents: number;
  source: "email_link" | "admin_manual";
}) {
  const detailUrl = `${APP_URL}/admin/auctions/${params.auctionId}`;
  const sourceLabel =
    params.source === "admin_manual" ? "entered manually by admin" : "submitted via email link";
  const inner = `
    <p style="color:#0B5FD1;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.12em;margin:0 0 4px">Outside Dealer Offer</p>
    <h1 style="color:#111827;font-size:22px;font-weight:700;margin:0 0 4px">${escape(params.dealershipName)}</h1>
    <p style="color:#6B7280;font-size:13px;margin:0 0 16px">${sourceLabel} for auction <strong>${escape(params.auctionId.slice(0, 8))}</strong></p>

    <div style="background:#F8F9FB;border-radius:12px;padding:16px;margin-bottom:16px">
      ${params.contactName ? `<p style="color:#374151;font-size:13px;margin:0 0 4px"><strong>Contact:</strong> ${escape(params.contactName)}</p>` : ""}
      <p style="color:#374151;font-size:13px;margin:0 0 4px">${escape(params.contactEmail)}${params.contactPhone ? ` &middot; ${escape(params.contactPhone)}` : ""}</p>
      <p style="color:#111827;font-size:14px;margin:8px 0 0"><strong>OTD Price:</strong> $${(params.otdPriceCents / 100).toLocaleString()}</p>
    </div>

    <div style="margin-top:24px">${button(detailUrl, "View Auction →")}</div>`;
  await sendRaw(ADMIN_EMAIL, `Outside Dealer Offer — ${params.dealershipName}`, wrap(inner));
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
    <p style="color:#94A3B8;font-size:12px;margin-top:16px"><em>Reminder: by submitting an offer, your dealership has agreed to pay AutoLenis a referral fee upon successful completion of a sale. Fee terms will be confirmed in writing before deal finalization.</em></p>`;
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
    <p style="color:#94A3B8;font-size:12px;margin-top:16px">This link is personalized for you. Offers are presented by our verified dealer network.</p>
    <hr style="border:0;border-top:1px solid #E5E7EB;margin:24px 0 16px"/>
    <p style="color:#475569;font-size:12px;line-height:1.6;margin:0 0 8px">
      If you already have an AutoLenis account, you can also find this offer
      in your notifications dashboard at
      <a href="${APP_URL}/buyer/notifications" style="color:#0B5FD1;text-decoration:none">${APP_URL}/buyer/notifications</a>.
    </p>
    <p style="color:#475569;font-size:12px;line-height:1.6;margin:0">
      New to AutoLenis? <a href="${APP_URL}/auth/signup" style="color:#0B5FD1;text-decoration:none;font-weight:600">Create a free account</a>
      to track all your offers in one place.
    </p>`;
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

// ─── Vehicle offer dealer invitation (admin sends to specific dealers) ────
function tableRowEmail(label: string, value: string): string {
  return `<tr>
    <td style="color:#6B7280;font-size:13px;padding:5px 0;width:40%;vertical-align:top">${label}</td>
    <td style="color:#111827;font-size:13px;font-weight:500;padding:5px 0">${value}</td>
  </tr>`;
}

export async function sendVehicleOfferInvitationEmail(params: {
  to: string;
  contactName: string;
  dealershipName: string;
  submissionUrl: string;
  expiresAt: string;
  vehicleYear: number;
  vehicleMake: string;
  vehicleModel: string;
  vehicleTrim?: string;
  vehicleCondition: string;
  vehicleReferenceUrl?: string;
  buyerCity: string;
  buyerState: string;
  buyerZip: string;
  buyerTimeline: string;
  buyerBudget: string;
  buyerMonthlyGoal?: string;
  buyerDownPayment?: string;
  buyerFinancing: string;
  buyerHasTradeIn: boolean;
  buyerTradeYear?: string;
  buyerTradeMake?: string;
  buyerTradeModel?: string;
  buyerOpenToAlt: boolean;
  adminNotes?: string;
}) {
  const vehicleLabel = `${params.vehicleYear} ${params.vehicleMake} ${params.vehicleModel}${params.vehicleTrim ? ` ${params.vehicleTrim}` : ""}`;
  const subject = `New Buyer Opportunity — ${vehicleLabel} | AutoLenis`;

  const inner = `
    <h2 style="color:#111827;font-size:20px;font-weight:700;margin:0 0 4px">New Buyer Opportunity</h2>
    <p style="color:#6B7280;font-size:13px;margin:0 0 20px">
      Hello ${escape(params.contactName)}, AutoLenis has a motivated buyer looking for a vehicle that may match your inventory.
    </p>

    <div style="background:#FEF3C7;border:1px solid #FDE68A;border-radius:8px;padding:12px 16px;margin-bottom:20px">
      <p style="color:#92400E;font-size:13px;font-weight:600;margin:0">⏰ Offer deadline: ${escape(params.expiresAt)}</p>
    </div>

    <h3 style="color:#374151;font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;margin:0 0 10px">Vehicle Requested</h3>
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:20px">
      ${tableRowEmail("Vehicle", escape(vehicleLabel))}
      ${tableRowEmail("Condition", escape(params.vehicleCondition))}
      ${params.vehicleReferenceUrl ? tableRowEmail("Reference Unit", `<a href="${escape(params.vehicleReferenceUrl)}" style="color:#0B5FD1;text-decoration:none">View Reference Vehicle →</a>`) : ""}
    </table>

    <h3 style="color:#374151;font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;margin:0 0 10px">Buyer Overview</h3>
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:20px">
      ${tableRowEmail("Location", `${escape(params.buyerCity)}, ${escape(params.buyerState)} ${escape(params.buyerZip)}`)}
      ${tableRowEmail("Timeline", escape(params.buyerTimeline))}
      ${tableRowEmail("Budget", escape(params.buyerBudget))}
      ${params.buyerMonthlyGoal ? tableRowEmail("Monthly Goal", `${escape(params.buyerMonthlyGoal)}/mo`) : ""}
      ${params.buyerDownPayment ? tableRowEmail("Down Payment", escape(params.buyerDownPayment)) : ""}
      ${tableRowEmail("Financing", escape(params.buyerFinancing))}
      ${tableRowEmail(
        "Trade-In",
        params.buyerHasTradeIn
          ? `Yes — ${escape([params.buyerTradeYear, params.buyerTradeMake, params.buyerTradeModel].filter(Boolean).join(" "))}`
          : "No",
      )}
      ${tableRowEmail("Open to Alternatives", params.buyerOpenToAlt ? "Yes" : "No — specific vehicle only")}
    </table>

    ${params.adminNotes ? `
    <div style="background:#EFF6FF;border:1px solid #BFDBFE;border-radius:8px;padding:12px 16px;margin-bottom:20px">
      <p style="color:#1E40AF;font-size:13px;font-weight:600;margin:0 0 4px">Notes from AutoLenis:</p>
      <p style="color:#1E40AF;font-size:13px;margin:0;line-height:1.5">${escape(params.adminNotes)}</p>
    </div>` : ""}

    <div style="text-align:center;margin:28px 0">
      ${button(params.submissionUrl, "Submit Your Offer →")}
    </div>

    <p style="color:#9CA3AF;font-size:11px;text-align:center;margin:16px 0 0;line-height:1.5">
      AutoLenis is an automotive buying concierge platform — not a dealer, broker, lender, or party to the sale.<br/>
      A referral fee applies upon successful completion of a sale.
    </p>`;

  await sendRaw(params.to, subject, wrap(inner));
}

// ─── Buyer interest confirmation ──────────────────────────────────────────
export async function sendBuyerInterestConfirmationEmail(params: {
  to: string;
  buyerName: string;
  vehicleLabel: string;
  dealershipName: string;
  offerPriceCents: number;
}) {
  const subject = "We received your interest — AutoLenis";
  const price = `$${Math.round(params.offerPriceCents / 100).toLocaleString()}`;
  const inner = `
    <h2 style="color:#111827;font-size:20px;font-weight:700;margin:0 0 4px">Great choice, ${escape(params.buyerName)}!</h2>
    <p style="color:#6B7280;font-size:14px;margin:0 0 20px">We received your interest in the vehicle offer below.</p>

    <div style="background:#F0FDF4;border:1px solid #BBF7D0;border-radius:8px;padding:16px;margin-bottom:20px">
      <p style="color:#14532D;font-size:14px;font-weight:600;margin:0 0 4px">${escape(params.vehicleLabel)}</p>
      <p style="color:#166534;font-size:13px;margin:0">From ${escape(params.dealershipName)} · ${price} OTD</p>
    </div>

    <h3 style="color:#374151;font-size:13px;font-weight:600;margin:0 0 10px">What happens next:</h3>
    <ol style="color:#4B5563;font-size:13px;line-height:1.8;margin:0 0 24px;padding-left:20px">
      <li>An AutoLenis team member will contact you within <strong>2 business hours</strong></li>
      <li>We'll confirm the vehicle is available and arrange a test drive if needed</li>
      <li>We'll coordinate financing, trade-in, and paperwork</li>
      <li>We'll facilitate a smooth, stress-free purchase</li>
    </ol>

    <p style="color:#6B7280;font-size:13px;margin:0 0 24px">Questions? Reply to this email and we'll get back to you right away.</p>

    <div style="text-align:center;margin:24px 0">
      ${button(`${APP_URL}/auth/signup`, "Create an Account to Track Your Deal →")}
    </div>

    <p style="color:#9CA3AF;font-size:11px;margin:20px 0 0">
      You expressed interest via AutoLenis. No obligation — our team will reach out shortly.
    </p>`;
  await sendRaw(params.to, subject, wrap(inner));
}

// ─── Buyer asked a question about an offer ────────────────────────────────
export async function sendBuyerQuestionEmail(params: {
  buyerName: string;
  buyerEmail: string;
  dealershipName: string;
  vehicleLabel: string;
  question: string;
}) {
  const subject = `Buyer question about vehicle offer — ${params.buyerName}`;
  const inner = `
    <h2 style="color:#111827;font-size:20px;font-weight:700;margin:0 0 4px">Buyer Question Received</h2>
    <p style="color:#6B7280;font-size:13px;margin:0 0 16px">
      <strong>${escape(params.buyerName)}</strong> (${escape(params.buyerEmail)}) asked a question about an offer from <strong>${escape(params.dealershipName)}</strong>.
    </p>
    <div style="background:#F8F9FB;border-radius:12px;padding:16px;margin-bottom:16px">
      <p style="color:#111827;font-size:14px;margin:0 0 4px"><strong>Vehicle:</strong> ${escape(params.vehicleLabel)}</p>
      <p style="color:#111827;font-size:14px;margin:0 0 4px"><strong>Dealer:</strong> ${escape(params.dealershipName)}</p>
    </div>
    <div style="background:#EFF6FF;border:1px solid #BFDBFE;border-radius:8px;padding:14px">
      <p style="color:#1E40AF;font-size:12px;font-weight:600;margin:0 0 6px">Question:</p>
      <p style="color:#1E40AF;font-size:13px;margin:0;line-height:1.5;white-space:pre-line">${escape(params.question)}</p>
    </div>
    <p style="color:#4B5563;font-size:13px;margin-top:16px">Follow up with the buyer to answer or relay the question to the dealer.</p>`;
  await sendRaw(ADMIN_EMAIL, subject, wrap(inner));
}
