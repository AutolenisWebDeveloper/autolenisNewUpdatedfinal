// Rendered content for the Phase 2 transactional messages.
//
// WHY THIS EXISTS RATHER THAN A TEMPLATE ID. `deliverEmail` resolves
// `payload.templateId` through `TemplateService.getTemplate`, which filters
// `email_templates.id` — a UUID PRIMARY KEY. A template KEY there is a 22P02, not
// a lookup miss, so the render throws on every attempt and the row terminal-fails.
// No `draft_recovery_*` or `application_submitted_admin` row exists in
// `email_templates` either, so pointing at one by key would render nothing.
//
// The row's `template_key` column stays the identity — the state recheck and the
// §27 completeness assertion read it. This module supplies the CONTENT the drain
// renders, which is the other half of §27's "template and required content".
//
// Deliberately plain HTML with an inline style block: these are transactional
// notices, they must survive every mail client, and the marketing template system
// (`email_templates` + TemplateService) is a separate, admin-editable surface that
// is not the right owner for a message whose absence breaks a transaction.
//
// Run: pnpm test:comms-outbox

const BRAND = "#0B5FD1";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
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

function paragraph(text: string): string {
  return `<p style="margin:0 0 12px;font-size:15px;line-height:1.55;color:#374151">${escapeHtml(text)}</p>`;
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

/** §6.4's four touches. `touch` is 1-4; `resumeUrl` is the link back. */
export function renderDraftRecovery(touch: 1 | 2 | 3 | 4, input: { firstName?: string | null; resumeUrl: string }): RenderedEmail {
  const name = input.firstName?.trim() || "there";
  const copy: Record<1 | 2 | 3 | 4, { subject: string; lines: string[]; cta: string }> = {
    1: {
      subject: "Your AutoLenis request — here's your link back",
      lines: [
        `Hi ${name},`,
        "We saved what you told us so far. Nothing is charged, and no dealer sees your request until you finish it.",
        "Pick up where you left off whenever you're ready.",
      ],
      cta: "Finish my request",
    },
    2: {
      subject: "Still want dealers to compete for your car?",
      lines: [
        `Hi ${name},`,
        "Your request is saved but not submitted yet. It takes about a minute to finish.",
      ],
      cta: "Finish my request",
    },
    3: {
      subject: "What happens after you finish your request",
      lines: [
        `Hi ${name},`,
        "Once you submit, vetted dealers get about 48 hours to compete on price. You compare the offers side by side and choose — or walk away.",
        "Your saved request is still here.",
      ],
      cta: "Finish my request",
    },
    4: {
      subject: "Last reminder about your saved request",
      lines: [
        `Hi ${name},`,
        "This is the last email we'll send about this one. Your request stays saved, so the link still works if you come back later.",
      ],
      cta: "Finish my request",
    },
  };
  const c = copy[touch];
  return {
    subject: c.subject,
    html: layout(c.subject, c.lines.map(paragraph).join(""), { label: c.cta, url: input.resumeUrl }),
    text: `${c.lines.join("\n\n")}\n\n${c.cta}: ${input.resumeUrl}`,
  };
}

/** §5 Stage 3 — the receipt Operations gets for EVERY prequalification application. */
export function renderPrequalAdminReceipt(input: {
  prequalId: string;
  buyerId: string;
  decision: string;
  submittedAt: string;
  adminUrl: string;
}): RenderedEmail {
  const rows: [string, string][] = [
    ["Reference", input.prequalId],
    ["Buyer", input.buyerId],
    ["Decision", input.decision],
    ["Submitted", input.submittedAt],
  ];
  const subject = `Prequalification ${input.decision} — ${input.prequalId}`;
  const table = `<table style="border-collapse:collapse;font-size:14px;margin:0 0 8px">${rows
    .map(
      ([k, v]) =>
        `<tr><td style="padding:4px 16px 4px 0;color:#6B7280">${escapeHtml(k)}</td><td style="padding:4px 0;color:#111827"><strong>${escapeHtml(v)}</strong></td></tr>`,
    )
    .join("")}</table>`;
  return {
    subject,
    // No bureau payload, no OFAC detail, no SSN — none is collectable in this flow,
    // and a reviewer reaches the record through the link under their own authorisation.
    html: layout("A prequalification application was submitted", table, { label: "Open the buyer record", url: input.adminUrl }),
    text: `${rows.map(([k, v]) => `${k}: ${v}`).join("\n")}\n\nOpen: ${input.adminUrl}`,
  };
}

/**
 * The rule-16 claim link: someone used a registered address on a public form.
 *
 * Deliberately says nothing about what was submitted. The person reading this may
 * not be the person who filled the form in, and the whole reason nothing was
 * attached is that the submitter did not prove they control this address.
 */
export function renderRegisteredClaimPrompt(input: { firstName?: string | null; claimUrl: string }): RenderedEmail {
  const name = input.firstName?.trim() || "there";
  const lines = [
    `Hi ${name},`,
    "Someone started a vehicle request on autolenis.com using this email address. Because it belongs to an existing AutoLenis account, we did not add anything to your account.",
    "If that was you, use the link below to continue. If it wasn't, you can ignore this email — nothing was changed and nothing was charged.",
  ];
  const subject = "Continue the request started with your email";
  return {
    subject,
    html: layout(subject, lines.map(paragraph).join(""), { label: "Continue my request", url: input.claimUrl }),
    text: `${lines.join("\n\n")}\n\nContinue: ${input.claimUrl}`,
  };
}

/**
 * §27.1 — "Prequalification under review | Buyer | Honest status and expected follow-up".
 *
 * PHASE 10. This message existed as `sendPrequalUnderReviewEmail`, a DIRECT Resend call
 * on the §8.4 allowlist: no retry, no send-time state recheck, no terminal-failure
 * alert, and it lived and died with the request that triggered it. §27 is explicit that
 * "no page request determines whether a transaction communication survives", and this
 * is a compliance-adjacent notice to someone whose credit application is being reviewed
 * by a human — one of the worst messages in the system to lose silently.
 *
 * WHAT IT MUST NOT SAY. The OFAC screen is one of the reasons a decision lands here,
 * and §Stage 3 keeps that silent: a buyer is never told they were screened, matched, or
 * escalated. So the copy names no reason at all — not "further checks", which invites
 * the question, and not a decision, which has not been made. It commits to the one
 * thing that IS true and useful: a person is looking, and they will hear back.
 */
export function renderPrequalUnderReview(input: {
  firstName?: string | null;
  dashboardUrl: string;
}): RenderedEmail {
  const name = input.firstName?.trim() || "there";
  const lines = [
    `Hi ${name},`,
    "Thanks for your prequalification application. It needs a manual review before we can give you a decision, so one of our team is looking at it now.",
    "You do not need to do anything. We will email you as soon as the review is complete — this usually takes one business day.",
  ];
  const subject = "Your prequalification is under review";
  return {
    subject,
    html: layout(subject, lines.map(paragraph).join(""), { label: "View my dashboard", url: input.dashboardUrl }),
    text: `${lines.join("\n\n")}\n\nDashboard: ${input.dashboardUrl}`,
  };
}

/**
 * §27.1 "Prequalification provider delay | Buyer | Honest processing notice".
 *
 * WHY THIS IS NOT `renderPrequalUnderReview`. Both notices go to a buyer whose decision
 * has been held, and until Phase 10 both got the under-review copy — which says "one of
 * our team is looking at it now". When the hold is a PROVIDER FAILURE that is not true:
 * nobody is looking, because nobody has anything to look at. The buyer was told a person
 * was working on their file while the real state was an integration returning nothing.
 *
 * §26's own wording for the exception is "Retry and notify; honest processing notice", and
 * §22a's rule that "a provider failure is never shown as an empty market" is the same
 * principle one surface over: a failure is disclosed as a failure, in terms the person can
 * use. So this copy says the application is still processing and is taking longer than
 * usual — which is exactly what `queue_items.buyer_visible_status` carries for the row.
 *
 * WHAT IT STILL MUST NOT SAY. The same §Stage 3 silence applies: no screening, no decision,
 * and no provider name. "Our checks are taking longer than usual" is true and discloses
 * nothing about the buyer.
 */
export function renderPrequalProviderDelay(input: {
  firstName?: string | null;
  dashboardUrl: string;
}): RenderedEmail {
  const name = input.firstName?.trim() || "there";
  const lines = [
    `Hi ${name},`,
    "Thanks for your prequalification application. Our checks are taking longer than usual, so your application is still processing.",
    "You do not need to do anything and you do not need to apply again. We are retrying, and we will email you with your decision as soon as we have it.",
  ];
  const subject = "Your prequalification is still processing";
  return {
    subject,
    html: layout(subject, lines.map(paragraph).join(""), { label: "View my dashboard", url: input.dashboardUrl }),
    text: `${lines.join("\n\n")}\n\nDashboard: ${input.dashboardUrl}`,
  };
}

/**
 * §27.1 "Guest capture → Buyer → claim link".
 *
 * A visitor who filled in a public form has a `buyers` row, a request, and no proved
 * control of the address on it. `renderRegisteredClaimPrompt` above is the sibling for an
 * address that already belongs to a REGISTERED account — the two read differently on
 * purpose: that one has to explain why a stranger's submission is being mentioned at all,
 * and this one simply hands the person their own account.
 */
export function renderGuestCaptureClaim(input: {
  firstName?: string | null;
  claimUrl: string;
}): RenderedEmail {
  const name = input.firstName?.trim() || "there";
  const lines = [
    `Hi ${name},`,
    "Your request is saved. Claim your account with the link below and you can track it, add vehicles, and see dealer offers as they come in.",
    "The link is for you alone and expires in a few days. If you did not fill in a form on AutoLenis, ignore this email and nothing happens.",
  ];
  const subject = "Claim your AutoLenis account";
  return {
    subject,
    html: layout(subject, lines.map(paragraph).join(""), { label: "Claim my account", url: input.claimUrl }),
    text: `${lines.join("\n\n")}\n\nClaim: ${input.claimUrl}`,
  };
}

/**
 * §27.1's three verification reminders, at 1h / 24h / 72h.
 *
 * NO CREDENTIAL IN THESE. The claim link is a live write credential and it is sent ONCE, in
 * `renderGuestCaptureClaim`. A reminder that carried its own copy would put the same
 * credential in four places at rest for the sake of saving the reader one click, and the
 * three rows are enqueued hours or days ahead of being sent. So a reminder points at the
 * public page and says where the link is — the `skipIfVerified` recheck is what stops it
 * being sent at all once they have used it.
 *
 * The escalation is in the WORDING, not in the urgency: the platform is not owed anything
 * by someone who has not verified, and three emails telling them so would be the wrong
 * relationship to start.
 */
export function renderVerificationReminder(
  touch: 1 | 24 | 72,
  input: { firstName?: string | null; siteUrl: string },
): RenderedEmail {
  const name = input.firstName?.trim() || "there";
  const copy: Record<1 | 24 | 72, { subject: string; body: string[] }> = {
    1: {
      subject: "Your AutoLenis link is waiting",
      body: [
        "We sent you a link to claim your account a little while ago. It is in your inbox — check your spam folder if it is not there.",
        "Until you claim it, your request is saved but you cannot see offers or add vehicles to it.",
      ],
    },
    24: {
      subject: "Still want dealers to compete for your car?",
      body: [
        "Your request from yesterday is saved and unclaimed. Claiming your account is what lets dealerships start competing on it.",
        "The claim link is in the email we sent you. If it has expired, start again from the site and we will send a new one.",
      ],
    },
    72: {
      subject: "Last reminder about your saved request",
      body: [
        "Your request is still saved and still unclaimed. This is the last reminder we will send about it.",
        "If you want to pick it up, start from the site with the same email address and we will send you a fresh link.",
      ],
    },
  };
  const { subject, body } = copy[touch];
  const lines = [`Hi ${name},`, ...body];
  return {
    subject,
    html: layout(subject, lines.map(paragraph).join(""), { label: "Go to AutoLenis", url: input.siteUrl }),
    text: `${lines.join("\n\n")}\n\n${input.siteUrl}`,
  };
}

/** §27.1 "Onboarding incomplete → Buyer". One nudge, not a sequence. */
export function renderOnboardingIncomplete(input: {
  firstName?: string | null;
  onboardingUrl: string;
}): RenderedEmail {
  const name = input.firstName?.trim() || "there";
  const lines = [
    `Hi ${name},`,
    "Your email is verified — there are a few details left before dealerships can be asked to compete for your car.",
    "It takes a couple of minutes, and you are not charged anything to see what dealers will offer.",
  ];
  const subject = "A couple of details left on your AutoLenis account";
  return {
    subject,
    html: layout(subject, lines.map(paragraph).join(""), { label: "Finish setting up", url: input.onboardingUrl }),
    text: `${lines.join("\n\n")}\n\n${input.onboardingUrl}`,
  };
}

/**
 * §27.1 "Prequalification expiring / expired → Buyer".
 *
 * WHAT NEITHER OF THESE SAYS. No amount, no tier, no reason, and nothing about the original
 * decision. §Stage 3 keeps the screening silent, and an expiry notice is about a CLOCK, not
 * about creditworthiness — a buyer re-applies and is assessed again from scratch.
 */
export function renderPrequalExpiry(
  kind: "expiring" | "expired",
  input: { firstName?: string | null; expiresAt: Date; renewUrl: string },
): RenderedEmail {
  const name = input.firstName?.trim() || "there";
  // The DATE only — a time would imply a precision the expiry does not have, and the
  // reader's zone is unknown here.
  const when = input.expiresAt.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  const lines =
    kind === "expiring"
      ? [
          `Hi ${name},`,
          `Your AutoLenis prequalification expires on ${when}. Renewing takes a couple of minutes and keeps your purchase moving without a pause.`,
          "If your deal completes before then, nothing here applies and you can ignore this.",
        ]
      : [
          `Hi ${name},`,
          `Your AutoLenis prequalification expired on ${when}, so your purchase is paused until it is renewed.`,
          "Renewing takes a couple of minutes. Nothing about your request, your shortlist or your offers is lost while you do it.",
        ];
  const subject =
    kind === "expiring" ? "Your prequalification expires soon" : "Your prequalification has expired";
  return {
    subject,
    html: layout(subject, lines.map(paragraph).join(""), { label: "Renew my prequalification", url: input.renewUrl }),
    text: `${lines.join("\n\n")}\n\n${input.renewUrl}`,
  };
}
