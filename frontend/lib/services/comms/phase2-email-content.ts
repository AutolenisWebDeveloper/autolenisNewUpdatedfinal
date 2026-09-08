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
