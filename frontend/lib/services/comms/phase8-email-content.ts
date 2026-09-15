// Rendered content for the Phase 8 transactional messages — Stage 13 contract request,
// Contract Shield outcome and signatures; Stage 14 funding clearance; Stage 15 insurance.
//
// SAME REASON THE PHASE 2/5/6/7 CONTENT MODULES EXIST: `deliverEmail` resolves
// `payload.templateId` through `TemplateService.getTemplate`, which filters
// `email_templates.id` — a UUID primary key — so a template KEY there is a 22P02 rather
// than a lookup miss, and the row terminal-fails on every attempt. The outbox row's
// `template_key` stays the identity; this module supplies the CONTENT the drain renders.
//
// FOUR THINGS HERE ARE REQUIREMENTS RATHER THAN POLISH.
//
// 1. THE CONTRACT REQUEST CARRIES ITS DEADLINE IN THE BODY, NOT JUST THE SUBJECT.
//    Stage 13/14a specifies "a secure upload request with a 24-hour deadline". The one
//    message this replaces — `sendDealerContractPendingEmail`, fired only when an admin
//    typed CONTRACT_PENDING into the action route — carried no deadline at all, so the
//    escalation that follows it had nothing to escalate against.
//
// 2. A REVISION EMAIL NAMES THE DISCREPANCIES. §26's "Contract mismatch" row requires
//    the specific discrepancies be "named to both parties". A message that says only
//    "your contract was rejected" makes the dealership guess, which produces a second
//    wrong upload and a second review cycle.
//
// 3. NO DEALER-FACING MESSAGE CARRIES BUYER IDENTITY beyond what the deal already
//    released. §25.1's firewall lifts at reaffirmation for the WINNING dealership only,
//    and these messages all go to that dealership — but they still identify the deal and
//    the vehicle rather than restating personal details into an inbox that forwards.
//
// 4. THE FUNDING-BLOCKED EMAIL NAMES THE OUTSTANDING ITEM AND ITS OWNER. Stage 14's
//    buyer-visible copy is "the specific outstanding condition and who owns it" — not a
//    generic hold. A clearance list with six items and a message that names none of them
//    is how a deal sits for a week with nobody knowing whose move it is.

import {
  type RenderedEmail,
  appUrl,
  bullets,
  deadline,
  layout,
  money,
  paragraph,
  textFrom,
} from "./email-layout";

// ───────────────────────────────────────────────────────────────────────────────
// Stage 13 — to the dealership
// ───────────────────────────────────────────────────────────────────────────────

/** §27.1 "Contract requested → Winning dealership → Secure upload link and 24-hour deadline". */
export function renderContractRequested(p: {
  dealershipName: string;
  vehicle: string;
  vin: string | null;
  otdCents: number | null;
  dueAt: Date;
  dealId: string;
}): RenderedEmail {
  const url = appUrl(`/dealer/contracts/upload?dealId=${p.dealId}`);
  const headline = "Upload the contract package — 24 hours";
  const lines = [
    `${p.dealershipName}, the buyer has confirmed the final numbers for ${p.vehicle}${p.vin ? ` (VIN ${p.vin})` : ""}.`,
    `Agreed out-the-door: ${money(p.otdCents)}.`,
    `Due by ${deadline(p.dueAt)}.`,
    "You determine which forms this transaction requires and confirm the package is complete — AutoLenis does not prescribe them.",
    "The package may include the buyer's order or purchase agreement, the external financing contract or evidence, odometer disclosure, title and registration forms, trade documents and payoff authorization, optional-product agreements, due-bill commitments and delivery acknowledgments.",
    "Contract Shield compares the uploaded contract against the winning offer, your reaffirmation and the confirmed recap before the buyer is asked to sign.",
  ];
  return {
    subject: `Contract package due in 24 hours — ${p.vehicle}`,
    html: layout(headline, lines.map(paragraph).join(""), { label: "Upload the package", url }),
    text: textFrom(headline, lines, { label: "Upload the package", url }),
  };
}

/** §27.1 "Contract overdue → Dealership + Operations → Reminder and escalation". */
export function renderContractOverdue(p: {
  dealershipName: string;
  vehicle: string;
  dueAt: Date;
  dealId: string;
}): RenderedEmail {
  const url = appUrl(`/dealer/contracts/upload?dealId=${p.dealId}`);
  const headline = "The contract package is overdue";
  const lines = [
    `${p.dealershipName}, the contract package for ${p.vehicle} was due ${deadline(p.dueAt)} and has not arrived.`,
    "The buyer cannot sign and the vehicle cannot be released until it does.",
    "AutoLenis Operations has been notified. If something is blocking the package, reply to this message and tell us what it is.",
  ];
  return {
    subject: `Overdue: contract package — ${p.vehicle}`,
    html: layout(headline, lines.map(paragraph).join(""), { label: "Upload the package", url }),
    text: textFrom(headline, lines, { label: "Upload the package", url }),
  };
}

/** §27.1 "Contract revision required → Buyer + dealership → Specific mismatches and required correction". */
export function renderContractRevisionRequired(p: {
  audience: "buyer" | "dealer";
  vehicle: string;
  discrepancies: string[];
  dealId: string;
}): RenderedEmail {
  const url = appUrl(p.audience === "buyer" ? `/buyer/contracts/${p.dealId}` : `/dealer/deals/${p.dealId}`);
  const headline =
    p.audience === "buyer"
      ? "Your contract is on hold — we found differences"
      : "Contract Shield held this contract — correction required";
  const intro =
    p.audience === "buyer"
      ? `We compared the dealership's contract for ${p.vehicle} against your accepted offer and the recap you confirmed. These did not match, so we have held it rather than asking you to sign:`
      : `The uploaded contract for ${p.vehicle} does not match the winning offer, your reaffirmation and the confirmed recap on these points:`;
  const closing =
    p.audience === "buyer"
      ? "You do not need to do anything. The dealership has been sent the same list and will upload a corrected package, which is rescanned before you are asked to sign."
      : "Upload a corrected package. It is rescanned in full — an approval is bound to the exact version it judged, so the corrected one is reviewed on its own merits.";
  const body = paragraph(intro) + bullets(p.discrepancies) + paragraph(closing);
  return {
    subject: `Contract held — correction required (${p.vehicle})`,
    html: layout(headline, body, { label: "See the details", url }),
    text: textFrom(headline, [intro, ...p.discrepancies.map((d) => `• ${d}`), closing], {
      label: "See the details",
      url,
    }),
  };
}

/** §27.1 "Contract approved → Buyer + dealership → Signing readiness". */
export function renderContractApproved(p: {
  audience: "buyer" | "dealer";
  vehicle: string;
  dealId: string;
}): RenderedEmail {
  const url = appUrl(p.audience === "buyer" ? `/buyer/esign?dealId=${p.dealId}` : `/dealer/deals/${p.dealId}`);
  const headline =
    p.audience === "buyer" ? "Your contract passed review — ready to sign" : "Contract approved — buyer signing now";
  const lines =
    p.audience === "buyer"
      ? [
          `Contract Shield compared the dealership's contract for ${p.vehicle} against your accepted offer, the dealership's reaffirmation and the recap you confirmed.`,
          "You can see exactly what it checked and what it found before you sign anything.",
          "Signing needs your electronic-records consent and an adopted name. A page view is not a signature.",
        ]
      : [
          `The contract package for ${p.vehicle} passed Contract Shield and has gone to the buyer for signature.`,
          "Once every required signature is in, you will be asked to execute and return the fully executed copy.",
        ];
  return {
    subject: p.audience === "buyer" ? `Ready to sign — ${p.vehicle}` : `Contract approved — ${p.vehicle}`,
    html: layout(headline, lines.map(paragraph).join(""), { label: p.audience === "buyer" ? "Review and sign" : "Open the deal", url }),
    text: textFrom(headline, lines, { label: p.audience === "buyer" ? "Review and sign" : "Open the deal", url }),
  };
}

/** §27.1 "Signature required → Buyer + co-buyer → Secure signing link and deadline". */
/**
 * §13-D30 — the signature request, and the type that makes the deadlock unrepresentable.
 *
 * A CO-BUYER RENDER REQUIRES A TOKEN, enforced by this union rather than by a runtime
 * fallback. That is deliberate: the deadlock was a co-buyer sent to `/buyer/esign`, which
 * calls requireBuyer() and redirects to Supabase sign-in, for an account they do not have by
 * the owner's own ruling. A fallback branch would let that shape exist again the next time
 * someone adds a caller. Now it does not compile.
 *
 * The raw token appears in the rendered email and NOWHERE else — never logged, never
 * persisted (only its SHA-256 is), never echoed by any route.
 */
export type SignatureRequiredParams = {
  signerName: string | null;
  vehicle: string;
  expiresAt: Date;
  dealId: string;
} & (
  | { isCoBuyer: true; signerToken: string }
  | { isCoBuyer: false; signerToken?: never }
);

export function renderSignatureRequired(p: SignatureRequiredParams): RenderedEmail {
  const url = p.isCoBuyer
    ? appUrl(`/esign/invited/${p.signerToken}`)
    : appUrl(`/buyer/esign?dealId=${p.dealId}`);
  const headline = "Your signature is needed";
  const lines = [
    `${p.signerName ?? "Hello"}, the contract for ${p.vehicle} has passed Contract Shield and is ready for your signature.`,
    p.isCoBuyer
      ? "You are named as a required signer on this purchase, so the contract cannot proceed without you. Your link signs you in — you do not need an AutoLenis account."
      : "You can read the whole contract and see what Contract Shield checked before you sign.",
    `This signing link expires ${deadline(p.expiresAt)}. If it does, it can be reissued against the same approved contract.`,
    "Signing requires affirmative electronic-records consent and an adopted name.",
  ];
  return {
    subject: `Signature required — ${p.vehicle}`,
    html: layout(headline, lines.map(paragraph).join(""), { label: "Review and sign", url }),
    text: textFrom(headline, lines, { label: "Review and sign", url }),
  };
}

/** §27.1 "Signature reminder or expiration → Required signer → Remaining time or reissue instruction". */
export function renderSignatureReminder(p: {
  signerName: string | null;
  vehicle: string;
  expiresAt: Date;
  expired: boolean;
  dealId: string;
}): RenderedEmail {
  const url = appUrl(`/buyer/esign?dealId=${p.dealId}`);
  const headline = p.expired ? "Your signing link has expired" : "Your signature is still needed";
  const lines = p.expired
    ? [
        `${p.signerName ?? "Hello"}, the signing window for ${p.vehicle} closed on ${deadline(p.expiresAt)}.`,
        "Nothing is lost. The contract is still approved, and a fresh signing link can be issued against that same approved version — the document does not change.",
        "Open your deal to request a new link.",
      ]
    : [
        `${p.signerName ?? "Hello"}, the contract for ${p.vehicle} is still waiting on your signature.`,
        `The signing link expires ${deadline(p.expiresAt)}.`,
        "The vehicle cannot be released until every required signature is in.",
      ];
  return {
    subject: p.expired ? `Signing link expired — ${p.vehicle}` : `Reminder: signature needed — ${p.vehicle}`,
    html: layout(headline, lines.map(paragraph).join(""), { label: p.expired ? "Request a new link" : "Review and sign", url }),
    text: textFrom(headline, lines, { label: p.expired ? "Request a new link" : "Review and sign", url }),
  };
}

/** §27.1 "Buyer signatures completed → Dealership → Dealer execution request". */
export function renderDealerExecutionRequested(p: {
  dealershipName: string;
  vehicle: string;
  dealId: string;
}): RenderedEmail {
  const url = appUrl(`/dealer/deals/${p.dealId}`);
  const headline = "Every required signature is in — execute and return the copy";
  const lines = [
    `${p.dealershipName}, every required signer has signed the approved contract for ${p.vehicle}.`,
    "Execute the contract on your side and upload the fully executed copy. AutoLenis verifies that it corresponds to the approved transaction, stores it, and records its hash.",
    "The transaction is not contract-executed merely because the buyer signed — release stays blocked until your fully executed copy is stored.",
  ];
  return {
    subject: `Execute and return the contract — ${p.vehicle}`,
    html: layout(headline, lines.map(paragraph).join(""), { label: "Upload the executed copy", url }),
    text: textFrom(headline, lines, { label: "Upload the executed copy", url }),
  };
}

/** §27.1 "Fully executed contract stored → Buyer + dealership → Executed-document access notice". */
export function renderExecutedContractStored(p: {
  audience: "buyer" | "dealer";
  vehicle: string;
  dealId: string;
}): RenderedEmail {
  const url = appUrl(p.audience === "buyer" ? `/buyer/contracts/${p.dealId}` : `/dealer/deals/${p.dealId}`);
  const headline = "The fully executed contract is stored";
  const lines = [
    `The fully executed contract for ${p.vehicle} is stored and available to you at any time.`,
    "Its hash is recorded, so the copy you can download is provably the copy that was executed.",
    p.audience === "buyer"
      ? "Next: financing completion and funding clearance. Your vehicle is not released until both are confirmed."
      : "Next: AutoLenis confirms financing completion and funding clearance before release.",
  ];
  return {
    subject: `Executed contract available — ${p.vehicle}`,
    html: layout(headline, lines.map(paragraph).join(""), { label: "Open the contract", url }),
    text: textFrom(headline, lines, { label: "Open the contract", url }),
  };
}

// ───────────────────────────────────────────────────────────────────────────────
// Stage 14 — financing completion and funding clearance
// ───────────────────────────────────────────────────────────────────────────────

/** §27.1 "Financing completed → Buyer + dealership + AutoLenis → Verified checkpoint confirmation". */
export function renderFinancingCompleted(p: { vehicle: string; dealId: string }): RenderedEmail {
  const url = appUrl("/buyer/deal");
  const headline = "Financing complete";
  const lines = [
    `Financing for ${p.vehicle} is recorded as complete against the lender's own evidence.`,
    "One checkpoint remains before your vehicle can be prepared for delivery: funding clearance.",
  ];
  return {
    subject: `Financing complete — ${p.vehicle}`,
    html: layout(headline, lines.map(paragraph).join(""), { label: "See your deal", url }),
    text: textFrom(headline, lines, { label: "See your deal", url }),
  };
}

/** §27.1 "Funding cleared or blocked → Dealership, buyer, Operations" — the CLEARED half. */
export function renderFundingCleared(p: { vehicle: string; dealId: string }): RenderedEmail {
  const url = appUrl("/buyer/deal");
  const headline = "Financing complete — preparing your vehicle for delivery";
  const lines = [
    `Funding for ${p.vehicle} has cleared. Every condition has been confirmed against evidence rather than assumed.`,
    "AutoLenis never releases a vehicle on the expectation that financing will complete later, which is why this checkpoint exists and why it comes before anything is scheduled.",
  ];
  return {
    subject: `Funding cleared — ${p.vehicle}`,
    html: layout(headline, lines.map(paragraph).join(""), { label: "See your deal", url }),
    text: textFrom(headline, lines, { label: "See your deal", url }),
  };
}

/** The BLOCKED half — "the specific outstanding condition and who owns it". */
export function renderFundingBlocked(p: {
  audience: "buyer" | "dealer";
  vehicle: string;
  outstanding: string[];
  dealId: string;
}): RenderedEmail {
  const url = appUrl(p.audience === "buyer" ? "/buyer/deal" : `/dealer/deals/${p.dealId}`);
  const headline = "Funding is not cleared yet";
  const intro = `Funding for ${p.vehicle} cannot clear until these are resolved:`;
  const closing =
    p.audience === "buyer"
      ? "Anything owned by AutoLenis or the dealership is already in hand — you will only hear from us again about items that are yours."
      : "Release stays blocked until every item is resolved.";
  return {
    subject: `Funding on hold — ${p.vehicle}`,
    html: layout(headline, paragraph(intro) + bullets(p.outstanding) + paragraph(closing), {
      label: "See what is outstanding",
      url,
    }),
    text: textFrom(headline, [intro, ...p.outstanding.map((o) => `• ${o}`), closing], {
      label: "See what is outstanding",
      url,
    }),
  };
}

/** §27.1 "Premium election reverted to Standard → Buyer → Reversion notice at funding clearance". */
export function renderPremiumElectionReverted(p: { vehicle: string; dealId: string }): RenderedEmail {
  const url = appUrl("/buyer/deal");
  const headline = "You are on Standard — nothing further is due";
  const lines = [
    `Funding for ${p.vehicle} has cleared, which closes the window to upgrade to Premium.`,
    "The Premium balance was never charged, so your plan has reverted to Standard — which is already paid in full by your $99.",
    "Nothing about your purchase changes. Your contract, your vehicle and your pickup are exactly as they were.",
  ];
  return {
    subject: "Your plan: Standard, paid in full",
    html: layout(headline, lines.map(paragraph).join(""), { label: "See your deal", url }),
    text: textFrom(headline, lines, { label: "See your deal", url }),
  };
}

// ───────────────────────────────────────────────────────────────────────────────
// Stage 15 — insurance
// ───────────────────────────────────────────────────────────────────────────────

/** §27.1 "Insurance required → Buyer → Requirements and secure submission link". */
export function renderInsuranceRequired(p: { vehicle: string; vin: string | null }): RenderedEmail {
  const url = appUrl("/buyer/insurance");
  const headline = "Proof of insurance — start this now";
  const intro = `We have asked the dealership for your contract on ${p.vehicle}. Insurance is requested at the same moment so you have the whole contract-and-signing window to arrange it rather than being asked at the last minute.`;
  const reqs = [
    "The policy must be active on the day you take the vehicle.",
    "It must name you (and your co-buyer, where one is on the purchase).",
    p.vin ? `It must match VIN ${p.vin}.` : "It must match the VIN on your contract.",
  ];
  const closing =
    "Upload proof of coverage, or bind a policy with your own insurer and upload the binder. AutoLenis does not sell, bind or broker insurance — we can help you get quotes, and that is all.";
  return {
    subject: `Proof of insurance needed — ${p.vehicle}`,
    html: layout(headline, paragraph(intro) + bullets(reqs) + paragraph(closing), {
      label: "Submit proof of insurance",
      url,
    }),
    text: textFrom(headline, [intro, ...reqs.map((r) => `• ${r}`), closing], {
      label: "Submit proof of insurance",
      url,
    }),
  };
}

/** §27.1 "Insurance uploaded → Buyer + Operations → Receipt and review task". */
export function renderInsuranceUploaded(p: { vehicle: string }): RenderedEmail {
  const headline = "We have your proof of insurance — it is under review";
  const lines = [
    `Your proof of coverage for ${p.vehicle} has been received and is with our team.`,
    "An upload is not approval. We confirm the policy is active, names you, and matches the VIN before it clears.",
    "You will hear from us either way — if anything needs correcting we will tell you exactly what.",
  ];
  return {
    subject: `Insurance received — under review (${p.vehicle})`,
    html: layout(headline, lines.map(paragraph).join(""), { label: "See your deal", url: appUrl("/buyer/insurance") }),
    text: textFrom(headline, lines, { label: "See your deal", url: appUrl("/buyer/insurance") }),
  };
}

/** §27.1 "Insurance verified → Buyer + dealership → Clearance confirmation". */
export function renderInsuranceVerified(p: { audience: "buyer" | "dealer"; vehicle: string }): RenderedEmail {
  const headline = "Insurance verified";
  const lines = [
    `Coverage for ${p.vehicle} is verified: the policy is active, correctly named and matched to the VIN.`,
    p.audience === "buyer"
      ? "One of the release requirements is now met. Keep the policy active through pickup — coverage that lapses before you take the vehicle blocks release until it is corrected."
      : "The insurance requirement for release is met.",
  ];
  return {
    subject: `Insurance verified — ${p.vehicle}`,
    html: layout(headline, lines.map(paragraph).join(""), { label: "See your deal", url: appUrl("/buyer/insurance") }),
    text: textFrom(headline, lines, { label: "See your deal", url: appUrl("/buyer/insurance") }),
  };
}

/** §27.1 "Insurance rejected or expired → Buyer → Specific correction required". */
export function renderInsuranceRejected(p: {
  vehicle: string;
  reason: string;
  expired: boolean;
}): RenderedEmail {
  const url = appUrl("/buyer/insurance");
  const headline = p.expired ? "Your coverage has expired" : "Your proof of insurance needs correcting";
  const lines = [
    p.expired
      ? `The policy on file for ${p.vehicle} has passed its expiry date.`
      : `We reviewed your proof of coverage for ${p.vehicle} and it cannot be accepted as it stands.`,
    `What needs to change: ${p.reason}`,
    "This blocks release of the vehicle until it is corrected — nothing else about your purchase is affected.",
  ];
  return {
    subject: p.expired ? `Coverage expired — ${p.vehicle}` : `Insurance correction needed — ${p.vehicle}`,
    html: layout(headline, lines.map(paragraph).join(""), { label: "Submit corrected proof", url }),
    text: textFrom(headline, lines, { label: "Submit corrected proof", url }),
  };
}
