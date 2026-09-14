// Rendered content for the Phase 7 transactional messages — Stage 10 reaffirmation, Stage 11
// recap, Stage 12 financing checkpoints.
//
// SAME REASON THIS EXISTS AS `phase2-`, `phase5-` AND `phase6-email-content.ts`: `deliverEmail`
// resolves `payload.templateId` through `TemplateService.getTemplate`, which filters
// `email_templates.id` — a UUID primary key — so a template KEY there is a 22P02 rather than a
// lookup miss, and the row terminal-fails on every attempt. The outbox row's `template_key` stays
// the identity; this module supplies the CONTENT the drain renders.
//
// TWO THINGS HERE ARE REQUIREMENTS RATHER THAN POLISH.
//
// 1. THE MATERIAL-CHANGE EMAIL NAMES THE DIFFERENCES AND ASKS FOR NOTHING. §10a's decision is a
//    single accept-or-reject, and it is made on the screen where both columns are visible side by
//    side — not in an inbox, where a reply-to-accept is unauthenticated, unlogged, and impossible
//    to present as a comparison. The email states what changed and links to the decision. It has
//    no accept link, deliberately.
//
// 2. NO DEALER-FACING MESSAGE CARRIES BUYER IDENTITY. §25.1's release happens in the secure
//    handoff behind authentication, not in email — the reaffirmation REQUEST goes out before the
//    firewall lifts, so an email that named the buyer would release identity a stage early to an
//    inbox that forwards. The request identifies the deal and the vehicle and nothing else.

const BRAND = "#0B5FD1";
const WARN = "#B45309";

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

function money(cents: number | null): string {
  if (cents == null) return "—";
  return `$${(cents / 100).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

function appUrl(path: string): string {
  const base = process.env.NEXT_PUBLIC_APP_URL || "https://autolenis.com";
  return `${base.replace(/\/$/, "")}${path}`;
}

// ───────────────────────────────────────────────────────────────────────────────
// Stage 10 — to the dealership
// ───────────────────────────────────────────────────────────────────────────────

/** §27.1 "Buyer selects offer → winning dealership → Confirmation and reaffirmation request". */
export function renderReaffirmationRequest(input: {
  dealershipName: string;
  vehicle: string;
  vin: string | null;
  otdCents: number;
  dueAt: Date;
  dealId: string;
}): RenderedEmail {
  const url = appUrl(`/dealer/deals/${input.dealId}`);
  const headline = "You won — confirm within 24 hours";
  const lines = [
    `${input.dealershipName}, a buyer has accepted your offer on ${input.vehicle}${input.vin ? ` (VIN ${input.vin})` : ""} at ${money(input.otdCents)} out the door.`,
    `Confirm by ${input.dueAt.toUTCString()}: that the vehicle is still available, the VIN and current mileage, the out-the-door amount, every fee, incentive and add-on, pickup or delivery terms, out-of-state registration handling, and that you can proceed. Set a hold-until date and attach the condition report, history report and current photographs.`,
    `The buyer's contact details and the trade packet are released to you the moment you confirm — not before.`,
    `If you do not confirm within 24 hours the buyer returns to the remaining offers and the miss is recorded on your scorecard.`,
  ];
  return {
    subject: `Confirm within 24 hours — ${input.vehicle}`,
    html: layout(headline, lines.map(paragraph).join(""), { label: "Confirm this deal", url }),
    text: textFrom(headline, lines, { label: "Confirm this deal", url }),
  };
}

/** §27.1 "Reaffirmation reminder → winning dealership → 12-hour reminder". */
export function renderReaffirmationReminder(input: {
  dealershipName: string;
  vehicle: string;
  dueAt: Date;
  dealId: string;
}): RenderedEmail {
  const url = appUrl(`/dealer/deals/${input.dealId}`);
  const headline = "12 hours left to confirm";
  const lines = [
    `${input.dealershipName}, the buyer who accepted your offer on ${input.vehicle} is still waiting.`,
    `Your confirmation is due by ${input.dueAt.toUTCString()}. After that the buyer returns to the remaining offers.`,
  ];
  return {
    subject: `12 hours left — confirm ${input.vehicle}`,
    html: layout(headline, lines.map(paragraph).join(""), { label: "Confirm this deal", url }),
    text: textFrom(headline, lines, { label: "Confirm this deal", url }),
  };
}

/** §27.1 "Outside dealer verification needed → Dealership + Operations". */
export function renderOutsideDealerVerification(input: {
  dealershipName: string;
  missing: string[];
}): RenderedEmail {
  // The claim URL is built HERE, like every other CTA in this file, rather than passed in. A
  // caller-supplied URL is a caller-supplied 404 that the route-existence guard cannot see.
  const claimUrl = appUrl("/dealer/claim");
  const headline = "Claim your account to complete this sale";
  const lines = [
    `${input.dealershipName}, a buyer has accepted your offer. Before the deal can move forward you need an AutoLenis dealership account.`,
    `Outstanding: ${input.missing.join("; ")}.`,
    `This is a one-time setup. Once it is done the buyer's details are released to you and the deal continues.`,
  ];
  return {
    subject: "Claim your AutoLenis dealership account",
    html: layout(headline, lines.map(paragraph).join(""), { label: "Claim your account", url: claimUrl }),
    text: textFrom(headline, lines, { label: "Claim your account", url: claimUrl }),
  };
}

// ───────────────────────────────────────────────────────────────────────────────
// Stage 10 — to the buyer
// ───────────────────────────────────────────────────────────────────────────────

/** §27.1 "Dealer confirms → Buyer + AutoLenis → Confirmed vehicle, condition report, summary". */
export function renderDealerConfirmed(input: {
  firstName: string;
  dealId: string;
  autoAppliedSavingCents: number | null;
}): RenderedEmail {
  const url = appUrl(`/buyer/deal/${input.dealId}/reaffirmation`);
  const headline = "Dealership confirmed — review your vehicle";
  const lines = [
    `${input.firstName}, the dealership has confirmed it can do this deal.`,
    ...(input.autoAppliedSavingCents
      ? [
          `They also came down ${money(input.autoAppliedSavingCents)}. A lower out-the-door price with nothing else changed applies automatically in your favour, so there is nothing for you to approve — your new total is already on your deal.`,
        ]
      : []),
    `Review the condition report, the history report and the photographs, then acknowledge the disclosure to move to your final recap.`,
  ];
  return {
    subject: input.autoAppliedSavingCents
      ? `Dealership confirmed — and your price came down ${money(input.autoAppliedSavingCents)}`
      : "Dealership confirmed — review your vehicle and condition report",
    html: layout(headline, lines.map(paragraph).join(""), { label: "Review and acknowledge", url }),
    text: textFrom(headline, lines, { label: "Review and acknowledge", url }),
  };
}

/**
 * §27.1 "Material change proposed → Buyer → Side-by-side change with accept or reject".
 *
 * The email names every difference. The DECISION is on the screen — see this module's header for
 * why there is no accept link here.
 */
export function renderMaterialChangeProposed(input: {
  firstName: string;
  differences: Array<{ label: string; confirmed: string; proposed: string; consequence: string }>;
  dealId: string;
}): RenderedEmail {
  const url = appUrl(`/buyer/deal/${input.dealId}/reaffirmation`);
  const headline = "The dealership changed something — your decision";
  const rows = input.differences
    .map(
      (d) =>
        `<tr>` +
        `<td style="padding:8px 12px;border-bottom:1px solid #E5E7EB;font-size:14px;color:#111827"><strong>${escapeHtml(d.label)}</strong><br><span style="color:#6B7280;font-size:13px">${escapeHtml(d.consequence)}</span></td>` +
        `<td style="padding:8px 12px;border-bottom:1px solid #E5E7EB;font-size:14px;color:#6B7280;text-decoration:line-through">${escapeHtml(d.confirmed)}</td>` +
        `<td style="padding:8px 12px;border-bottom:1px solid #E5E7EB;font-size:14px;color:${WARN};font-weight:700">${escapeHtml(d.proposed)}</td>` +
        `</tr>`,
    )
    .join("");
  const table =
    `<table style="width:100%;border-collapse:collapse;margin:8px 0 4px">` +
    `<thead><tr>` +
    `<th style="text-align:left;padding:8px 12px;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#6B7280">What changed</th>` +
    `<th style="text-align:left;padding:8px 12px;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#6B7280">You accepted</th>` +
    `<th style="text-align:left;padding:8px 12px;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#6B7280">Now proposed</th>` +
    `</tr></thead><tbody>${rows}</tbody></table>`;

  const lines = [
    `${input.firstName}, the dealership confirmed your deal but changed ${input.differences.length === 1 ? "one thing" : `${input.differences.length} things`} from the offer you accepted.`,
    `Nothing moves forward until you decide. You can accept the change, or reject it and go back to the other offers on your auction.`,
  ];
  return {
    subject: `Your decision needed — the dealership changed ${input.differences.length === 1 ? "a detail" : `${input.differences.length} details`}`,
    html: layout(headline, lines.map(paragraph).join("") + table, { label: "See the comparison and decide", url }),
    text: textFrom(
      headline,
      [
        ...lines,
        "",
        ...input.differences.map((d) => `${d.label}: you accepted ${d.confirmed} — now proposed ${d.proposed}. ${d.consequence}`),
      ],
      { label: "See the comparison and decide", url },
    ),
  };
}

/** §27.1 "Dealer rejects or times out → Buyer + Operations → Return-to-offers instructions". */
export function renderReturnedToOffers(input: {
  firstName: string;
  reason: string;
  remainingOfferCount: number;
  auctionId: string | null;
}): RenderedEmail {
  const url = input.auctionId ? appUrl(`/buyer/auctions/${input.auctionId}`) : appUrl("/buyer/dashboard");
  const headline =
    input.remainingOfferCount > 0
      ? "You are back with your other offers"
      : "This deal could not go ahead";
  const lines = [
    `${input.firstName}, ${input.reason}`,
    input.remainingOfferCount > 0
      ? `You have ${input.remainingOfferCount} other valid offer${input.remainingOfferCount === 1 ? "" : "s"} on this auction. Nothing you paid is affected and you can choose again now.`
      : `There are no other valid offers left on this auction. Our team is reviewing your options and will come back to you — you do not need to do anything.`,
  ];
  return {
    subject: input.remainingOfferCount > 0 ? "Choose again — your other offers are still open" : "An update on your deal",
    html: layout(headline, lines.map(paragraph).join(""), input.remainingOfferCount > 0 ? { label: "See your offers", url } : undefined),
    text: textFrom(headline, lines, input.remainingOfferCount > 0 ? { label: "See your offers", url } : undefined),
  };
}

/** §27.1 "Vehicle hold expiring → Buyer + dealership + Operations → Extend or release". */
export function renderVehicleHoldExpiring(input: {
  /** The buyer's first name, or the dealership's name when `forDealer`. */
  firstName: string;
  holdUntil: Date;
  expired: boolean;
  dealId: string;
  /**
   * §27.1's row is "Vehicle hold expiring → Buyer AND DEALERSHIP + Operations → extend or
   * release". Only the buyer half existed, and the buyer's copy told them "our team has asked
   * them to extend the hold or release it" — a statement about a message nobody sent. The ask has
   * to actually reach the dealership, and it is the only one of the two that carries an action.
   */
  forDealer?: boolean;
}): RenderedEmail {
  if (input.forDealer) {
    const dealerUrl = appUrl(`/dealer/deals/${input.dealId}`);
    const headline = input.expired ? "Your hold on this vehicle has expired" : "Your hold on this vehicle expires soon";
    const lines = [
      input.expired
        ? `${input.firstName}, your hold on the vehicle for this deal ran out on ${input.holdUntil.toUTCString()} and the contract has not been requested yet.`
        : `${input.firstName}, your hold on the vehicle for this deal runs out on ${input.holdUntil.toUTCString()} and the contract has not been requested yet.`,
      "Extend the hold if the vehicle is still available, or release it if it is not. Releasing it returns the buyer to their other offers — that is the honest outcome, and it is better than a buyer arriving for a vehicle that has gone.",
    ];
    return {
      subject: input.expired ? "Your vehicle hold has expired" : "Extend or release your vehicle hold",
      html: layout(headline, lines.map(paragraph).join(""), { label: "Extend or release", url: dealerUrl }),
      text: textFrom(headline, lines, { label: "Extend or release", url: dealerUrl }),
    };
  }
  const url = appUrl(`/buyer/deal`);
  const headline = input.expired ? "The dealership's hold has expired" : "The dealership's hold expires soon";
  const lines = [
    input.expired
      ? `${input.firstName}, the dealership's hold on your vehicle ran out on ${input.holdUntil.toUTCString()} and your contract has not been requested yet.`
      : `${input.firstName}, the dealership is holding your vehicle until ${input.holdUntil.toUTCString()} and your contract has not been requested yet.`,
    `We have asked them to extend the hold or release it. You do not need to do anything — we will tell you either way, and if the hold is released you go back to your other offers.`,
  ];
  return {
    subject: input.expired ? "Your vehicle hold has expired" : "Your vehicle hold expires soon",
    html: layout(headline, lines.map(paragraph).join(""), { label: "See your deal", url }),
    text: textFrom(headline, lines, { label: "See your deal", url }),
  };
}

// ───────────────────────────────────────────────────────────────────────────────
// Stage 11 — the recap
// ───────────────────────────────────────────────────────────────────────────────

/** §27.1 "Recap ready → Buyer + dealership → Confirm the final numbers". */
export function renderRecapReady(input: {
  recipientName: string;
  version: number;
  otdCents: number | null;
  dealId: string;
  forDealer: boolean;
  isRevision: boolean;
}): RenderedEmail {
  const url = input.forDealer
    ? appUrl(`/dealer/deals/${input.dealId}`)
    : appUrl(`/buyer/deal/${input.dealId}/recap`);
  const headline = input.isRevision ? `Corrected recap — version ${input.version}` : "Your final numbers — confirm to continue";
  const lines = [
    input.isRevision
      ? `${input.recipientName}, the figures have been corrected and this is version ${input.version} of the recap. The previous version is kept on the record — settled figures are never silently rewritten.`
      : `${input.recipientName}, here is the complete recap of this deal: every party, the vehicle, the itemised out-the-door total${input.otdCents ? ` of ${money(input.otdCents)}` : ""}, each optional product priced separately, the trade equity, and the pickup or delivery terms.`,
    `Both you and the ${input.forDealer ? "buyer" : "dealership"} confirm it before any paperwork is prepared. If a figure is wrong, dispute it and the dealership issues a corrected version.`,
  ];
  return {
    subject: input.isRevision ? `Corrected recap (version ${input.version}) — please confirm` : "Confirm your final numbers",
    html: layout(headline, lines.map(paragraph).join(""), { label: "Review and confirm", url }),
    text: textFrom(headline, lines, { label: "Review and confirm", url }),
  };
}

// ───────────────────────────────────────────────────────────────────────────────
// Stage 12 — the financing checkpoint
// ───────────────────────────────────────────────────────────────────────────────

/** §27.1 "Financing path selected → Buyer + AutoLenis → External handoff and status explanation". */
export function renderFinancingPathSelected(input: {
  firstName: string;
  path: "DEALER" | "EXTERNAL" | "CASH";
  dealId: string;
}): RenderedEmail {
  const url = appUrl(`/buyer/deal/financing`);
  const headline = "Your financing path is set";
  const explanation: Record<typeof input.path, string> = {
    DEALER: "The dealership will arrange your financing with its own lenders. AutoLenis coordinates and verifies; the loan itself is between you and that lender.",
    EXTERNAL: "You are bringing your own approval from a bank, credit union or other lender. Send us the approval letter and we will attach it to your deal.",
    CASH: "You are paying cash. There is no loan to arrange — the dealership confirms the funds at handover.",
  };
  const lines = [
    `${input.firstName}, your deal is recorded as ${input.path === "CASH" ? "a cash purchase" : `${input.path === "DEALER" ? "dealer-arranged" : "external"} financing`}.`,
    explanation[input.path],
    `All financing happens outside AutoLenis. We refer, coordinate, follow up and verify — we never take an application, pull credit or lend.`,
  ];
  return {
    subject: "Your financing path is set",
    html: layout(headline, lines.map(paragraph).join(""), { label: "See your deal", url }),
    text: textFrom(headline, lines, { label: "See your deal", url }),
  };
}

/** §27.1 "Financing in progress → Buyer → Progress or missing-evidence reminder". */
export function renderFinancingInProgress(input: {
  firstName: string;
  missingEvidence: boolean;
  dealId: string;
}): RenderedEmail {
  const url = appUrl(`/buyer/deal/financing`);
  const headline = input.missingEvidence ? "We still need your approval letter" : "Your financing is in progress";
  const lines = input.missingEvidence
    ? [
        `${input.firstName}, your deal is waiting on one thing: the approval letter from your lender.`,
        `Upload it and our team verifies the terms — lender, approved amount, APR, term, payment and expiry — and locks them so the dealership can prepare your contract.`,
      ]
    : [
        `${input.firstName}, your financing is being worked. Our team is coordinating with the lender and will tell you the moment the terms are locked.`,
      ];
  return {
    subject: input.missingEvidence ? "One thing left — your approval letter" : "Your financing is in progress",
    html: layout(headline, lines.map(paragraph).join(""), { label: "See your financing", url }),
    text: textFrom(headline, lines, { label: "See your financing", url }),
  };
}

/** §27.1 "Financing terms locked → Buyer + dealership → Terms confirmed; contract next". */
export function renderFinancingTermsLocked(input: {
  recipientName: string;
  cash: boolean;
  approvedAmountCents: number | null;
  aprRate: number | null;
  termMonths: number | null;
  dealId: string;
  forDealer: boolean;
}): RenderedEmail {
  const url = input.forDealer ? appUrl(`/dealer/deals/${input.dealId}`) : appUrl(`/buyer/deal`);
  const headline = input.cash ? "Cash purchase confirmed — contract next" : "Your financing terms are confirmed";
  const terms = [
    input.approvedAmountCents != null ? `approved amount ${money(input.approvedAmountCents)}` : null,
    input.aprRate != null ? `${input.aprRate.toFixed(2)}% APR` : null,
    input.termMonths != null ? `${input.termMonths} months` : null,
  ]
    .filter(Boolean)
    .join(", ");
  const lines = [
    input.cash
      ? `${input.recipientName}, this deal is recorded as a cash purchase. The dealership will confirm the funds are received before the vehicle is released.`
      : `${input.recipientName}, the financing terms are locked${terms ? `: ${terms}` : ""}. Verified by our team against the lender's own evidence.`,
    `The dealership is preparing your contract next. Financing is not complete until the lender funds it — that is a second checkpoint, after signing and before the vehicle moves.`,
  ];
  return {
    subject: input.cash ? "Cash purchase confirmed — contract next" : "Your financing terms are confirmed",
    html: layout(headline, lines.map(paragraph).join(""), { label: "See your deal", url }),
    text: textFrom(headline, lines, { label: "See your deal", url }),
  };
}

/** §27.1 "Financing failed or expired → Buyer + AutoLenis → Alternative-path instruction". */
export function renderFinancingFailedOrExpired(input: {
  firstName: string;
  expired: boolean;
  failureReason: string | null;
  dealId: string;
}): RenderedEmail {
  const url = appUrl(`/buyer/deal/financing`);
  const headline = input.expired ? "Your approval expired — here is what happens next" : "That lender did not work out — here is what happens next";
  const lines = [
    input.expired
      ? `${input.firstName}, the approval attached to your deal has expired.`
      : `${input.firstName}, the financing we were working on did not come through.${input.failureReason ? ` Reason given: ${input.failureReason}.` : ""}`,
    `Your deal is not cancelled. We try another path — a different lender, a different structure, a larger down payment, or cash — and our team owns the follow-up and will tell you plainly what is being tried and by when.`,
    `We are also re-checking the dealership's hold on your vehicle and will have it extended or released.`,
  ];
  return {
    subject: input.expired ? "Your approval expired — what happens next" : "A financing update on your deal",
    html: layout(headline, lines.map(paragraph).join(""), { label: "See your financing", url }),
    text: textFrom(headline, lines, { label: "See your financing", url }),
  };
}

/** §23.2a touchpoint 5 — the second and final Premium ask. After this, AutoLenis stops asking. */
export function renderPremiumFollowUpFinal(input: {
  firstName: string;
  balanceCents: number;
  dealId: string;
}): RenderedEmail {
  // `/buyer/plan/upgrade` DOES NOT EXIST — nothing in `app/` resolves it, and a CTA in a
  // transactional email is not a place to find that out. The outstanding premium balance is a
  // billing fact, and `/buyer/billing` is the surface that carries it.
  //
  // (The same dead path exists OUTSIDE this phase at `components/buyer/PremiumInvitation.tsx:186`,
  // which links `/buyer/plan/premium`. Reported, not changed — it is not Phase 7's to fix.)
  const url = appUrl(`/buyer/billing`);
  void input.dealId;
  const headline = "The last time we will ask";
  const lines = [
    `${input.firstName}, your dealership has confirmed and your final numbers are being agreed. What is left is the coordination: the recap held honest, the financing handoff, the contract and Contract Shield, insurance, funding clearance and pickup.`,
    `A concierge does that with you for ${money(input.balanceCents)} — the $499 total less the $99 you have already paid.`,
    `This is the last time we will ask. The option stays quietly in your dashboard until your funding clears, and your deal continues exactly as it is if you do nothing.`,
  ];
  return {
    subject: "The last time we will ask about a concierge",
    html: layout(headline, lines.map(paragraph).join(""), { label: "See what a concierge does", url }),
    text: textFrom(headline, lines, { label: "See what a concierge does", url }),
  };
}
