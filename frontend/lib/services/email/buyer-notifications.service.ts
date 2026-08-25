// lib/services/email/buyer-notifications.service.ts
//
// Post-intake buyer notification emails. Two transactional touches sent on the
// buyer's behalf as the auto-outreach pipeline runs:
//
//   A. sendDealersContactedEmail   — "we've contacted N dealers" (drives the
//                                     buyer to pay the $99 Auction Access Deposit).
//   B. sendFirstOfferReceivedEmail — "your first offer is in" (drives the buyer
//                                     to the portal — pay if not yet active,
//                                     otherwise view offers).
//
// PRIVACY (non-negotiable): these emails NEVER expose any dealer's name, phone,
// email, salesperson, or specific offer amount. Buyers only ever see the COUNT
// of dealers contacted and are always driven back into the platform — AutoLenis
// is the sole intermediary between buyer and dealer.
//
// Reuses the project's lazy-Resend pattern so `next build` never throws when the
// API key isn't in scope. Sends are best-effort and never throw to the caller.

import { logger } from "@/lib/logger";
import { Resend } from "resend"

const FROM_NAME = process.env.FROM_NAME ?? "AutoLenis"
const FROM_EMAIL = "info@autolenis.com"
const FROM = `${FROM_NAME} <${FROM_EMAIL}>`
const FOOTER_ADDRESS = "AutoLenis | 4500 Spring Creek Pkwy, Suite 200, Plano, TX 75024"

// Lazy Resend client — constructed on first use. Returns null when the API key
// is missing or a placeholder so dev/build never sends or throws.
let resendInstance: Resend | null = null
function getResend(): Resend | null {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey || apiKey.includes("placeholder")) return null
  if (!resendInstance) resendInstance = new Resend(apiKey)
  return resendInstance
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
}

// Shared send helper — never throws. Logs and swallows every failure so a buyer
// notification can never break the calling after() hook.
async function sendBuyerEmail(params: {
  to: string
  subject: string
  html: string
}): Promise<void> {
  const resend = getResend()
  if (!resend) {
    logger.warn(
      `[buyer-notifications] RESEND_API_KEY not configured — email skipped. To: ${params.to}`,
    )
    return
  }
  try {
    const result = await resend.emails.send({
      from: FROM,
      to: params.to,
      replyTo: FROM_EMAIL,
      subject: params.subject,
      html: params.html,
    })
    if (result.error || !result.data?.id) {
      logger.error(
        `[buyer-notifications] Resend dispatch failed for ${params.to}:`,
        result.error ?? "no id returned",
      )
      return
    }
    logger.info(
      `[buyer-notifications] Email sent to ${params.to} (resend ${result.data.id})`,
    )
  } catch (err) {
    logger.error(
      `[buyer-notifications] Email send threw for ${params.to}:`,
      err,
    )
  }
}

// ─── Email A — dealers contacted ─────────────────────────────────────────────

export async function sendDealersContactedEmail(params: {
  buyerEmail: string
  buyerFirstName: string
  vehicleMake: string
  vehicleModel: string
  dealerCount: number // ONLY the count — never any dealer names
  depositUrl: string // link to pay the $99 Auction Access Deposit
}): Promise<void> {
  const vehicle = [params.vehicleMake, params.vehicleModel]
    .filter(Boolean)
    .join(" ")
    .trim()
  const firstName = params.buyerFirstName?.trim() || "there"

  const subject = `We've contacted ${params.dealerCount} dealers for your ${vehicle}`

  const html = `<div style="font-family:-apple-system,system-ui,sans-serif;max-width:600px;margin:0 auto;background:#fff;color:#1f2937">
  <div style="background:#0B5FD1;padding:32px;text-align:center">
    <h1 style="color:#fff;margin:0;font-size:22px">${params.dealerCount} Dealers Contacted</h1>
  </div>
  <div style="padding:32px;line-height:1.7;font-size:14px">
    <p style="margin:0 0 16px">Hi ${escapeHtml(firstName)},</p>
    <p style="margin:0 0 16px">We've reached out to <strong>${params.dealerCount} verified dealerships</strong> on your behalf who carry the ${escapeHtml(vehicle)} you're looking for.</p>
    <p style="margin:0 0 16px">Your personal contact information will <strong>NOT</strong> be shared with any dealer until you select a winning offer.</p>
    <p style="margin:0 0 16px">To activate your 48-hour auction and receive their competitive offers, complete your $99 Auction Access Deposit:</p>
    <div style="text-align:center;margin:24px 0">
      <a href="${escapeHtml(params.depositUrl)}" style="display:inline-block;background:#0B5FD1;color:#fff;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:700;font-size:14px">ACTIVATE MY AUCTION — $99 →</a>
    </div>
    <p style="margin:0 0 8px;font-weight:600">Once activated:</p>
    <ul style="margin:0 0 16px;padding-left:20px;color:#4B5563">
      <li>Dealers have 48 hours to submit their best out-the-door price</li>
      <li>You'll see all offers side by side</li>
      <li>You choose the offer that works best for you</li>
      <li>No dealership visits until you decide</li>
    </ul>
    <p style="margin:0 0 16px">Questions? Reply to this email anytime.</p>
    <p style="margin:0 0 16px">Markist Athelus<br/>Founder, AutoLenis<br/><a href="mailto:info@autolenis.com" style="color:#0B5FD1">info@autolenis.com</a><br/><a href="https://www.autolenis.com" style="color:#0B5FD1">https://www.autolenis.com</a></p>
    <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0"/>
    <p style="margin:0;color:#94a3b8;font-size:12px">${FOOTER_ADDRESS}<br/>To unsubscribe, reply with 'UNSUBSCRIBE'.</p>
  </div>
</div>`

  await sendBuyerEmail({ to: params.buyerEmail, subject, html })
}

// ─── Email B — first offer received ──────────────────────────────────────────

export async function sendFirstOfferReceivedEmail(params: {
  buyerEmail: string
  buyerFirstName: string
  vehicleMake: string
  vehicleModel: string
  hasDeposit: boolean // whether the buyer already paid the $99 Auction Access Deposit
  depositUrl: string // link to pay if not active
  offersUrl: string // link to view offers if active
}): Promise<void> {
  const vehicle = [params.vehicleMake, params.vehicleModel]
    .filter(Boolean)
    .join(" ")
    .trim()
  const firstName = params.buyerFirstName?.trim() || "there"

  const subject = `🎉 First offer received for your ${vehicle}!`

  // Body diverges on deposit status. We NEVER reveal which dealer submitted the
  // offer or the amount — the buyer is always driven into the platform.
  const inner = params.hasDeposit
    ? `<p style="margin:0 0 16px">A dealer has submitted an offer for your ${escapeHtml(vehicle)}. More offers may be coming in before your auction closes.</p>
    <p style="margin:0 0 16px">Log in to see your offers:</p>
    <div style="text-align:center;margin:24px 0">
      <a href="${escapeHtml(params.offersUrl)}" style="display:inline-block;background:#0B5FD1;color:#fff;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:700;font-size:14px">VIEW MY OFFERS →</a>
    </div>`
    : `<p style="margin:0 0 16px">A dealer has submitted an offer for your ${escapeHtml(vehicle)} — but your auction isn't active yet.</p>
    <p style="margin:0 0 16px">Activate now to see this offer and all competing dealer offers before the auction window closes:</p>
    <div style="text-align:center;margin:24px 0">
      <a href="${escapeHtml(params.depositUrl)}" style="display:inline-block;background:#0B5FD1;color:#fff;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:700;font-size:14px">ACTIVATE MY AUCTION — $99 →</a>
    </div>
    <p style="margin:0 0 16px">Once activated, you'll see all dealer offers side by side and choose the best one.</p>`

  const html = `<div style="font-family:-apple-system,system-ui,sans-serif;max-width:600px;margin:0 auto;background:#fff;color:#1f2937">
  <div style="background:#0B5FD1;padding:32px;text-align:center">
    <h1 style="color:#fff;margin:0;font-size:22px">🎉 First Offer Received</h1>
  </div>
  <div style="padding:32px;line-height:1.7;font-size:14px">
    <p style="margin:0 0 16px">Hi ${escapeHtml(firstName)},</p>
    ${inner}
    <p style="margin:0 0 16px">Markist Athelus<br/>Founder, AutoLenis</p>
    <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0"/>
    <p style="margin:0;color:#94a3b8;font-size:12px">${FOOTER_ADDRESS}<br/>To unsubscribe, reply with 'UNSUBSCRIBE'.</p>
  </div>
</div>`

  await sendBuyerEmail({ to: params.buyerEmail, subject, html })
}
