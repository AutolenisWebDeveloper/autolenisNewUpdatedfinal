// lib/services/comms/email-layout.ts
//
// The shared presentation primitives for transactional email content.
//
// WHY THIS EXISTS. `phase2-`, `phase5-`, `phase6-` and `phase7-email-content.ts` each
// carry their own private copy of `escapeHtml`, `paragraph`, `layout`, `textFrom`,
// `money` and `appUrl` — byte-identical in all four. Phase 8 would have been the fifth.
// A fifth copy is not a style problem: it is five places a brand colour, an escaping
// rule or the footer disclaimer can diverge, and escaping in particular is a security
// property that should have exactly one implementation.
//
// SCOPE. Phase 8 uses this module. The four existing modules are NOT rewritten here —
// that is a consolidation touching four files across four phases' surfaces, outside
// this phase's §8.1 row 8 scope, and it is REPORTED rather than done in passing
// (CLAUDE.md: anything duplicated gets reported for an owner decision).

const BRAND = "#0B5FD1";
export const WARN = "#B45309";

export function escapeHtml(value: string): string {
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

export function paragraph(text: string): string {
  return `<p style="margin:0 0 12px;font-size:15px;line-height:1.55;color:#374151">${escapeHtml(text)}</p>`;
}

/** A labelled list — used for discrepancy lists and the clearance checklist. */
export function bullets(items: string[]): string {
  if (!items.length) return "";
  return `<ul style="margin:0 0 12px;padding-left:20px;font-size:15px;line-height:1.55;color:#374151">${items
    .map((i) => `<li style="margin:0 0 6px">${escapeHtml(i)}</li>`)
    .join("")}</ul>`;
}

export function layout(headline: string, bodyHtml: string, cta?: { label: string; url: string }): string {
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

export function textFrom(headline: string, lines: string[], cta?: { label: string; url: string }): string {
  return [headline, "", ...lines, cta ? `\n${cta.label}: ${cta.url}` : ""].filter((l) => l !== "").join("\n");
}

export function money(cents: number | null): string {
  if (cents == null) return "—";
  return `$${(cents / 100).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

export function appUrl(path: string): string {
  const base = process.env.NEXT_PUBLIC_APP_URL || "https://autolenis.com";
  return `${base.replace(/\/$/, "")}${path}`;
}

/** "in 24 hours" / "by Tue 16 Sep, 3:00 PM" — deadlines are stated, never implied. */
export function deadline(at: Date): string {
  return at.toLocaleString("en-US", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
}
