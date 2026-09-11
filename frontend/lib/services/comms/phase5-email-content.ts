// Rendered content for the Phase 5 transactional messages — Stage 6 sourcing and Stage 7
// invitations.
//
// SAME REASON THIS EXISTS AS `phase2-email-content.ts`: `deliverEmail` resolves
// `payload.templateId` through `TemplateService.getTemplate`, which filters
// `email_templates.id` — a UUID primary key — so a template KEY there is a 22P02 rather than
// a lookup miss and the row terminal-fails on every attempt. The outbox row's
// `template_key` stays the identity; this module supplies the CONTENT the drain renders.
//
// TWO THINGS HERE ARE NOT IN THE PHASE 2 MODULE, AND BOTH ARE REQUIREMENTS RATHER THAN
// POLISH.
//
// 1. THE DEALER INVITATION CARRIES NO BUYER IDENTITY. §25.1: "Invited dealerships receive
//    complete vehicle criteria, general location, distance, and trade indication — and no
//    buyer identity. Name, email, phone, and exact address are released only at Stage 10."
//    The payload type below cannot express a buyer name, email, phone or street address —
//    there is no field for one — which is a stronger guarantee than remembering not to pass
//    it. `dealer-invitation-pii.test.ts` asserts the rendered output too.
//
// 2. EVERY DEALER-FACING MESSAGE CARRIES A WORKING OPT-OUT. Defect 1, the half that was live
//    at HEAD: the transactional Resend rail sets no `List-Unsubscribe` header anywhere, and
//    outside-dealer invitations go to addresses that never opted in. A recipient had no
//    working way to stop them, and the one-click link that does exist writes
//    `email_suppression.reason = 'unsubscribed'` — a SOFT reason the invitation rail did not
//    honour. The honouring is fixed on the send path; the visible footer is fixed here,
//    because a header alone is not an opt-out a human can use.

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

function layout(
  headline: string,
  bodyHtml: string,
  cta?: { label: string; url: string },
  footerHtml?: string,
): string {
  return [
    `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#111827">`,
    `<h1 style="font-size:20px;line-height:1.3;margin:0 0 16px;color:#111827">${escapeHtml(headline)}</h1>`,
    bodyHtml,
    cta
      ? `<p style="margin:24px 0 0"><a href="${escapeHtml(cta.url)}" style="display:inline-block;background:${BRAND};color:#fff;text-decoration:none;padding:12px 20px;border-radius:6px;font-weight:600">${escapeHtml(cta.label)}</a></p>`
      : "",
    footerHtml ??
      `<p style="margin:24px 0 0;font-size:12px;color:#6B7280">AutoLenis — dealers compete, you choose. You are never charged to see offers.</p>`,
    `</div>`,
  ].join("");
}

function textFrom(headline: string, lines: string[], cta?: { label: string; url: string }, footer?: string): string {
  return [headline, "", ...lines, cta ? `\n${cta.label}: ${cta.url}` : "", footer ? `\n${footer}` : ""]
    .filter((l) => l !== "")
    .join("\n");
}

// ───────────────────────────────────────────────────────────────────────────────
// Buyer-facing — Stage 6
// ───────────────────────────────────────────────────────────────────────────────

/**
 * §27.1 "Radius authorization needed → Buyer → Coverage shortfall and maximum-distance
 * request", and the 24h/72h reminders of the same ask.
 *
 * HONEST ABOUT WHAT HAPPENED. §Stage 6's buyer-facing rule is "honest expectations", and the
 * shortfall is a fact about dealer density, not about the buyer's car. The copy says how far
 * was searched and how many were found, because a buyer asked to widen a search is entitled
 * to know what the current one returned.
 */
export function renderRadiusAuthorizationNeeded(input: {
  firstName?: string | null;
  searchedMiles: number;
  readyCount: number;
  authorizeUrl: string;
  touch: "initial" | "24h" | "72h";
}): RenderedEmail {
  const name = input.firstName?.trim() || "there";
  const subject =
    input.touch === "initial"
      ? "We need your permission to search further afield"
      : input.touch === "24h"
        ? "Still waiting: how far should we search?"
        : "Last reminder: how far should we search?";
  const found =
    input.readyCount === 0
      ? `We searched out to ${input.searchedMiles} miles and have not yet found dealerships able to compete for your vehicle.`
      : `We searched out to ${input.searchedMiles} miles and found ${input.readyCount} ${
          input.readyCount === 1 ? "dealership" : "dealerships"
        } — fewer than we need to run a competitive auction.`;
  const lines = [
    `Hi ${name},`,
    found,
    "Tell us the maximum extra distance you're willing to travel and we'll widen the search. Nothing is charged for this — your $99 already covers the auction.",
    input.touch === "72h"
      ? "If we don't hear from you, we'll close this request after 14 days and keep your history on file so you can pick it back up."
      : "You can change this at any time.",
  ];
  const cta = { label: "Set your maximum distance", url: input.authorizeUrl };
  return {
    subject,
    html: layout(subject, lines.map(paragraph).join(""), cta),
    text: textFrom(subject, lines, cta),
  };
}

/** §27.1 "Sourcing completed → Buyer → Auction preparation status". */
export function renderSourcingCompleted(input: {
  firstName?: string | null;
  readyCount: number;
  dashboardUrl: string;
}): RenderedEmail {
  const name = input.firstName?.trim() || "there";
  const subject = "We've found your dealerships — your auction is being prepared";
  const lines = [
    `Hi ${name},`,
    `${input.readyCount} ${input.readyCount === 1 ? "dealership is" : "dealerships are"} ready to compete for your vehicle.`,
    "We're running the final checks before the auction opens. You'll hear from us the moment it's live.",
  ];
  const cta = { label: "View your request", url: input.dashboardUrl };
  return {
    subject,
    html: layout(subject, lines.map(paragraph).join(""), cta),
    text: textFrom(subject, lines, cta),
  };
}

/**
 * §6c "disclosure of the field size to the buyer" — required before a limited auction of
 * three or four rooftops may run.
 *
 * THE DISCLOSURE IS THE POINT, so the number is in the subject line. §6c makes this one of
 * four conditions for a limited auction, alongside a completely searched radius, documented
 * scarcity and an audited approval — a buyer who is told "your auction is live" without
 * being told it is a field of three has not been disclosed to.
 */
export function renderSourcingLimitedField(input: {
  firstName?: string | null;
  readyCount: number;
  searchedMiles: number;
  dashboardUrl: string;
}): RenderedEmail {
  const name = input.firstName?.trim() || "there";
  const subject = `Your auction will run with ${input.readyCount} dealerships`;
  const lines = [
    `Hi ${name},`,
    `We searched the full ${input.searchedMiles} miles your request permits and found ${input.readyCount} dealerships that can compete for your vehicle. That is a smaller field than we aim for, so we're telling you before it opens.`,
    "A smaller field still runs as a real auction: each dealership submits its best out-the-door price without seeing the others. Fewer bidders can mean less competitive pricing, and you are never obliged to accept any offer.",
    "Your $99 covers this auction either way, and you can ask us to keep looking instead.",
  ];
  const cta = { label: "Review your request", url: input.dashboardUrl };
  return {
    subject,
    html: layout(subject, lines.map(paragraph).join(""), cta),
    text: textFrom(subject, lines, cta),
  };
}

/**
 * §26 "Zero dealer coverage → Operations → Review, then close or expand", with the buyer
 * notice §Stage 6 requires.
 *
 * CLOSURE AND REFUND ARE SEPARATE DECISIONS (§Stage 6, §22.1), so this message promises
 * neither. It says what happened and that a person is looking at it — and deliberately does
 * not say "we will refund you", because refunds are manual review and a message that
 * pre-empts that review creates an expectation Finance has not agreed to.
 */
export function renderSourcingNoCoverage(input: {
  firstName?: string | null;
  searchedMiles: number;
  dashboardUrl: string;
}): RenderedEmail {
  const name = input.firstName?.trim() || "there";
  const subject = "An update on your vehicle request";
  const lines = [
    `Hi ${name},`,
    `We searched out to ${input.searchedMiles} miles and have not found dealerships able to compete for your vehicle.`,
    "A member of our team is reviewing your request now and will be in touch with your options. We have not closed anything.",
  ];
  const cta = { label: "View your request", url: input.dashboardUrl };
  return {
    subject,
    html: layout(subject, lines.map(paragraph).join(""), cta),
    text: textFrom(subject, lines, cta),
  };
}

/** §27.1 "Auction launched → Buyer → 48-hour timeline and next step". */
export function renderAuctionLaunched(input: {
  firstName?: string | null;
  dealershipsInvited: number;
  closesAt: Date;
  dashboardUrl: string;
}): RenderedEmail {
  const name = input.firstName?.trim() || "there";
  const subject = "Your 48-hour auction is live";
  const closes = input.closesAt.toUTCString();
  const lines = [
    `Hi ${name},`,
    `${input.dealershipsInvited} ${input.dealershipsInvited === 1 ? "dealership has" : "dealerships have"} been invited to compete for your vehicle. The auction closes ${closes}.`,
    // §Stage 7 "Buyer sees": the offer count as it grows — NEVER competing prices. The copy
    // must not promise a running price feed, because §13-D35 keeps the auction sealed.
    "You'll see the number of offers grow as they arrive. Prices stay sealed until the auction closes, so no dealership can undercut another at the last moment.",
    "Nothing is needed from you until then.",
  ];
  const cta = { label: "Watch your auction", url: input.dashboardUrl };
  return {
    subject,
    html: layout(subject, lines.map(paragraph).join(""), cta),
    text: textFrom(subject, lines, cta),
  };
}

// ───────────────────────────────────────────────────────────────────────────────
// Dealer-facing — Stage 7. NO BUYER IDENTITY, and a working opt-out.
// ───────────────────────────────────────────────────────────────────────────────

/**
 * The invitation payload. §Stage 7: "Each invitation carries: the full vehicle criteria, the
 * required-versus-preferred feature distinction, the buyer's general location and distance,
 * the trade indication, the pickup or delivery preference, the submission deadline, and the
 * offer submission link. It carries no buyer identity."
 *
 * THERE IS NO FIELD FOR A BUYER NAME, EMAIL, PHONE OR STREET ADDRESS, and that is the
 * guarantee. `generalLocation` is a city/state or a ZIP region — never a street — and
 * `distanceMiles` is what the rooftop is from the buyer, which §25.1 explicitly permits.
 */
export interface DealerInvitationContent {
  dealershipName: string;
  contactName: string | null;
  /** City and state, or a ZIP region. Never a street address. */
  generalLocation: string;
  distanceMiles: number | null;
  criteria: {
    yearMin: number | null;
    yearMax: number | null;
    make: string | null;
    model: string | null;
    trim: string | null;
    /** §Stage 7's "required-versus-preferred feature distinction". */
    requiredFeatures: string[];
    preferredFeatures: string[];
    maxMileage: number | null;
  };
  /** How many of the buyer's shortlisted vehicles this rooftop can answer (§33 #29). */
  candidateCount: number;
  tradeIndicated: boolean;
  deliveryPreference: string | null;
  /** The REAL deadline, computed from `auction.endsAt` (S7-25). */
  deadline: Date;
  submitUrl: string;
  /** The token-bound opt-out. Defect 1. */
  unsubscribeUrl: string;
}

function criteriaList(c: DealerInvitationContent["criteria"]): string {
  const years =
    c.yearMin && c.yearMax
      ? c.yearMin === c.yearMax
        ? `${c.yearMin}`
        : `${c.yearMin}–${c.yearMax}`
      : c.yearMin
        ? `${c.yearMin} or newer`
        : c.yearMax
          ? `${c.yearMax} or older`
          : "any year";
  const rows: Array<[string, string]> = [
    ["Vehicle", [c.make, c.model, c.trim].filter(Boolean).join(" ") || "Open to suggestions"],
    ["Year", years],
    ["Maximum mileage", c.maxMileage ? `${c.maxMileage.toLocaleString()} miles` : "No limit stated"],
  ];
  if (c.requiredFeatures.length) rows.push(["Required", c.requiredFeatures.join(", ")]);
  if (c.preferredFeatures.length) rows.push(["Preferred (not required)", c.preferredFeatures.join(", ")]);
  return [
    `<table role="presentation" style="width:100%;border-collapse:collapse;margin:0 0 16px">`,
    ...rows.map(
      ([k, v]) =>
        `<tr><td style="padding:6px 12px 6px 0;font-size:13px;color:#6B7280;vertical-align:top;white-space:nowrap">${escapeHtml(k)}</td>` +
        `<td style="padding:6px 0;font-size:14px;color:#111827">${escapeHtml(v)}</td></tr>`,
    ),
    `</table>`,
  ].join("");
}

function dealerFooter(unsubscribeUrl: string): string {
  return (
    `<p style="margin:24px 0 0;font-size:12px;color:#6B7280">` +
    `AutoLenis invites vetted dealerships to compete for a buyer who has paid to open this auction. ` +
    `We never share the buyer's identity before a dealership has won and reaffirmed.` +
    `</p>` +
    // The visible half of defect 1's fix. A List-Unsubscribe header alone is not an opt-out
    // a human can use, and these go to addresses that never opted in.
    `<p style="margin:12px 0 0;font-size:12px;color:#6B7280">` +
    `<a href="${escapeHtml(unsubscribeUrl)}" style="color:#6B7280">Stop receiving auction invitations</a>` +
    `</p>`
  );
}

/** §27.1 "Dealer invited → Dealership → Secure invitation, criteria, deadline, submission link". */
export function renderDealerInvitation(c: DealerInvitationContent): RenderedEmail {
  const vehicle = [c.criteria.make, c.criteria.model].filter(Boolean).join(" ") || "a vehicle";
  const subject = `Auction invitation: ${vehicle} — ${c.generalLocation}`;
  const greeting = c.contactName?.trim() ? `Hi ${c.contactName.trim()},` : `Hello ${c.dealershipName},`;
  const distance =
    c.distanceMiles !== null
      ? `The buyer is about ${Math.round(c.distanceMiles)} miles from you in ${c.generalLocation}.`
      : `The buyer is in ${c.generalLocation}.`;
  const candidates =
    c.candidateCount > 1
      ? `You can bid on up to ${c.candidateCount} of the vehicles this buyer is considering — one offer per vehicle.`
      : "";
  const body = [
    paragraph(greeting),
    paragraph(
      "A buyer has paid to open a sealed 48-hour auction and your rooftop is one of a small number invited to compete.",
    ),
    criteriaList(c.criteria),
    paragraph(distance),
    c.tradeIndicated ? paragraph("The buyer has a trade-in to appraise.") : "",
    c.deliveryPreference ? paragraph(`Preference: ${c.deliveryPreference}.`) : "",
    candidates ? paragraph(candidates) : "",
    paragraph(
      `Submit your best out-the-door price by ${c.deadline.toUTCString()}. Offers stay sealed — no other dealership sees your number, and you do not see theirs.`,
    ),
  ].join("");
  const cta = { label: "Submit your offer", url: c.submitUrl };
  return {
    subject,
    html: layout(subject, body, cta, dealerFooter(c.unsubscribeUrl)),
    text: textFrom(
      subject,
      [
        greeting,
        "A buyer has paid to open a sealed 48-hour auction and your rooftop is one of a small number invited.",
        `Vehicle: ${[c.criteria.make, c.criteria.model, c.criteria.trim].filter(Boolean).join(" ") || "open"}`,
        distance,
        c.tradeIndicated ? "The buyer has a trade-in to appraise." : "",
        `Deadline: ${c.deadline.toUTCString()}`,
      ].filter(Boolean),
      cta,
      `Stop receiving auction invitations: ${c.unsubscribeUrl}`,
    ),
  };
}

/**
 * §Stage 7 "Nonresponders are reminded at 50% and 90% of the window."
 *
 * THE REMAINING TIME IS COMPUTED, NEVER HARD-CODED. Defect 5's three rails each carried a
 * fixed offset — +24h/+42h on QStash, a 5h–7h cron window, a ≤2h sweep — and one of them
 * sent `vehicleYear: 0` with an empty make and model into the subject line
 * (`auction-close/route.ts:84-86`), so a dealer received "0h Left — Submit Your Offer for 0".
 * Here the hours come from the auction's own `endsAt` and the vehicle comes from the
 * invitation's own criteria.
 */
export function renderDealerInvitationReminder(
  c: DealerInvitationContent & { percentElapsed: 50 | 90 },
): RenderedEmail {
  const vehicle = [c.criteria.make, c.criteria.model].filter(Boolean).join(" ") || "the vehicle";
  const hoursLeft = Math.max(0, Math.round((c.deadline.getTime() - Date.now()) / 3_600_000));
  const urgency = c.percentElapsed === 90 ? "Closing soon" : "Halfway";
  const subject = `${urgency}: ${hoursLeft}h left to bid on ${vehicle}`;
  const greeting = c.contactName?.trim() ? `Hi ${c.contactName.trim()},` : `Hello ${c.dealershipName},`;
  const lines = [
    greeting,
    c.percentElapsed === 90
      ? `This auction closes in about ${hoursLeft} hours and we have not received an offer from you.`
      : `This auction is halfway through its window — about ${hoursLeft} hours remain — and we have not received an offer from you.`,
    "Your invitation link is still valid and your offer stays sealed from the other dealerships.",
  ];
  const cta = { label: "Submit your offer", url: c.submitUrl };
  return {
    subject,
    html: layout(subject, [...lines.map(paragraph), criteriaList(c.criteria)].join(""), cta, dealerFooter(c.unsubscribeUrl)),
    text: textFrom(subject, lines, cta, `Stop receiving auction invitations: ${c.unsubscribeUrl}`),
  };
}

/**
 * §27.1 "Dealer invitation bounced → Operations → Contact replacement exception".
 *
 * Operations-facing, so it names the rooftop and the failure rather than apologising. The
 * queue item raised alongside it is the system of record; this is the alert that makes
 * someone look at it inside the auction window, which is the only window in which a
 * replacement helps (§Stage 7 "replaced early in the auction window where possible").
 */
export function renderDealerInvitationBounced(input: {
  dealershipName: string;
  rooftopId: string;
  auctionId: string;
  email: string;
  closesAt: Date | null;
  queueUrl: string;
}): RenderedEmail {
  const subject = `Invitation bounced: ${input.dealershipName}`;
  const lines = [
    `The auction invitation to ${input.dealershipName} bounced.`,
    `Rooftop ${input.rooftopId} · auction ${input.auctionId} · address ${input.email}`,
    input.closesAt
      ? `The auction closes ${input.closesAt.toUTCString()}. A replacement contact or rooftop only helps before then.`
      : "This auction has no close time recorded.",
    "The invitation has been marked bounced and a contact-replacement task is open in the queue.",
  ];
  const cta = { label: "Open the queue", url: input.queueUrl };
  return {
    subject,
    html: layout(subject, lines.map(paragraph).join(""), cta),
    text: textFrom(subject, lines, cta),
  };
}
