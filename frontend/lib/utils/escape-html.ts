// Shared HTML-escaping for text interpolated into email/HTML templates.
// (dealer-recruitment/email-template.service carries a private copy predating
// this util; new call sites use this one.)
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
