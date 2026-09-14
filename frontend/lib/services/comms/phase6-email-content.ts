// Rendered content for the Phase 6 transactional messages — Stage 8 close and Stage 9
// selection.
//
// SAME REASON THIS EXISTS AS `phase2-email-content.ts` AND `phase5-email-content.ts`:
// `deliverEmail` resolves `payload.templateId` through `TemplateService.getTemplate`, which
// filters `email_templates.id` — a UUID primary key — so a template KEY there is a 22P02
// rather than a lookup miss, and the row terminal-fails on every attempt. The outbox row's
// `template_key` stays the identity; this module supplies the CONTENT the drain renders.
//
// ONE THING HERE IS A REQUIREMENT RATHER THAN POLISH: §13-D35 keeps the auction sealed, and
// that does not stop at close. The offers-ready notice says HOW MANY qualified offers are
// waiting and never what they cost — the numbers live behind authentication on the Best Price
// Report, which is also where §8c's "equal results are presented honestly as equal" can be
// shown side by side. An email that quoted a price would publish a dealer's sealed bid to
// whatever inbox forwards it.

const BRAND = "#0B5FD1";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

function paragraph(text: string): string {
  return `<p style="margin:0 0 12px;font-size:15px;line-height:1.55;color:#374151">${escapeHtml(text)}</p>`;
}

function layout(headline: string, bodyHtml: string, cta?: { label: string; url: string }): string {
  return [
    `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#111827">`,
    `<h1 style="font-size:20px;line-height:1.3;margin:0 0 16px;color:#111827">${escapeHtml(headline)}</h1>`,
    bodyHtml,
    cta
      ? `<p style="margin:24px 0 0"><a href="${escapeHtml(cta.url)}" style="display:inline-block;background:${BRAND};color:#fff;text-decoration:none;padding:12px 20px;border-radius:6px;font-weight:600">${escapeHtml(cta.label)}</a></p>`
      : "",
    `<p style="margin:24px 0 0;font-size:12px;color:#6B7280">AutoLenis — dealers compete, you choose. You are never charged to see offers.</p>`,
    `</div>`,
  ].join("");
}

function textFrom(headline: string, lines: string[], cta?: { label: string; url: string }): string {
  return [headline, "", ...lines, cta ? `\n${cta.label}: ${cta.url}` : ""].filter((l) => l !== "").join("\n");
}

// ───────────────────────────────────────────────────────────────────────────────
// Buyer-facing — Stage 8 close
// ───────────────────────────────────────────────────────────────────────────────

/**
 * §27.1 "Offers ready → Buyer → Ranked report and selection instructions".
 *
 * THE COUNT IS THE QUALIFIED COUNT, not every row on the auction. §8c: a disqualified offer
 * is "never presented as qualified", so promising five offers and showing three would make
 * the email the thing that lies. `validOfferCount` is what the close path counted.
 */
export function renderOffersReady(input: {
  firstName?: string | null;
  validOfferCount: number;
  offersUrl: string;
}): RenderedEmail {
  const name = input.firstName?.trim() || "there";
  const n = input.validOfferCount;
  const subject = "Your offers are ready — choose your best deal";
  const lines = [
    `Hi ${name},`,
    n === 1
      ? "Your auction has closed and one dealership submitted a qualified offer."
      : `Your auction has closed and ${n} dealerships submitted qualified offers.`,
    // Sealed until the buyer is authenticated: the report is where the numbers are.
    "Your Best Price Report breaks each one down to the out-the-door price — the number you actually pay — so you can compare them like for like.",
    "Choose the one you want and we take it from there. Nothing is committed until you select.",
  ];
  const cta = { label: "See your Best Price Report", url: input.offersUrl };
  return { subject, html: layout(subject, lines.map(paragraph).join(""), cta), text: textFrom(subject, lines, cta) };
}

/**
 * §27.1 "Zero offers → Buyer + Operations → Outcome and recovery path".
 *
 * THREE FACTS, IN THIS ORDER, because the buyer paid $99 and is owed all three:
 *
 *   1. what happened — no dealership submitted a qualified offer;
 *   2. what happens to the money — §23.1 keeps the deposit and makes a refund a reviewed
 *      request, never an automatic reversal, so the copy says exactly that rather than
 *      implying either an automatic refund or a forfeit;
 *   3. who owns it now — an AutoLenis reviewer, because `ZERO_OFFERS_ALL_CANDIDATES` is
 *      raised in the same close path and its owner is Operations. §26 requires a
 *      buyer-visible status, and this message is where the buyer meets it.
 *
 * It does NOT offer the relaunch as a self-service button. §13-D39 makes the one relaunch
 * Ops-owned, and a buyer who clicked "try again" expecting a second auction would be
 * promised something only an operator can start.
 */
export function renderAuctionZeroOffers(input: {
  firstName?: string | null;
  depositAmount: string;
  dashboardUrl: string;
}): RenderedEmail {
  const name = input.firstName?.trim() || "there";
  const subject = "An update on your auction";
  const lines = [
    `Hi ${name},`,
    "Your auction has closed without a qualified offer from any of the dealerships we invited.",
    `Your ${input.depositAmount} Auction Access Deposit secured the auction and has not been spent on anything else. It stays refundable on request — our team reviews every request.`,
    "A member of our team is already reviewing your request and will be in touch with your options, including running your auction again at no additional cost. Nothing has been closed.",
  ];
  const cta = { label: "View your request", url: input.dashboardUrl };
  return { subject, html: layout(subject, lines.map(paragraph).join(""), cta), text: textFrom(subject, lines, cta) };
}

// ───────────────────────────────────────────────────────────────────────────────
// Premium — §23.2a touchpoint 4
// ───────────────────────────────────────────────────────────────────────────────

/**
 * §27.1 "Premium follow-up first (1h, only if declined)" — K27-1330, §23.2a touchpoint 4.
 *
 * PAY-72 IS THE HARD CONSTRAINT ON THIS COPY: "never sold on fear". Nothing here may imply the
 * deal goes worse on Standard, that Standard offers are weaker, or that any gate is slower —
 * because none of that is true. Everything §23 guarantees a buyer is guaranteed on both plans, and
 * this email is read by someone who has ALREADY SAID NO ONCE an hour ago. So it states what the
 * upgrade adds, says the deposit already counts toward it, and says plainly that nothing is
 * required — and it is the second of at most two emails, ever.
 *
 * It is deliberately short. A long second ask to someone who declined the first reads as pressure
 * however carefully each sentence is worded.
 */
export function renderPremiumFollowUp(input: {
  firstName?: string | null;
  balanceDueUsd: string;
  upgradeUrl: string;
}): RenderedEmail {
  const name = input.firstName?.trim() || "there";
  const subject = "One option on your deal, if you want it";
  const lines = [
    `Hi ${name},`,
    "You chose your deal earlier — congratulations. Everything from here runs exactly as it should on your current plan, and nothing below is needed for it.",
    `If you'd like a concierge to handle the financing, paperwork and pickup coordination for you, Premium is available: your $99 deposit counts toward it, leaving ${input.balanceDueUsd}.`,
    "If not, no action is needed and we won't ask again.",
  ];
  const cta = { label: "See what Premium includes", url: input.upgradeUrl };
  return { subject, html: layout(subject, lines.map(paragraph).join(""), cta), text: textFrom(subject, lines, cta) };
}
