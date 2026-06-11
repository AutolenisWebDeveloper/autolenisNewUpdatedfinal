// Server-side HTML sanitizer for AI-generated article bodies.
//
// Article `body` is AI-generated HTML rendered with dangerouslySetInnerHTML, so
// it MUST be sanitized server-side against an allowlist before it can reach the
// browser. This module is dependency-free (no Groq/DB imports) so it can run in
// three places without pulling the generation stack:
//   1. at generation time (lib/content/generator.ts) — sanitize before storage,
//   2. in the validation service (the HTML-sanitization layer),
//   3. at render time (the public buying-guide page) — defense in depth for any
//      legacy/manually-edited body that predates server-side sanitization.
//
// The same regex-based allowlist primitive is already used by the AMIPS markdown
// renderer (lib/amips/markdown.ts); this keeps the Bulk Article system on the
// proven pattern rather than introducing a new sanitizer dependency.

const ALLOWED_TAGS = new Set([
  "p",
  "h2",
  "h3",
  "ul",
  "ol",
  "li",
  "strong",
  "a",
  "em",
  "br",
]);

// Light HTML hardening: drop any tag outside the allowed set (keeping inner
// text) and strip on*/javascript: attributes from the tags that survive.
export function sanitizeBody(html: string): string {
  if (!html) return "";
  let out = html.trim();

  // Remove disallowed elements but keep their text content. Well-formed
  // disallowed tags (e.g. <script>, <img onerror=…>) are dropped entirely; their
  // payload is left as inert text, never executed.
  out = out.replace(/<\/?([a-zA-Z][a-zA-Z0-9]*)\b[^>]*>/g, (tag, nameRaw) => {
    const name = String(nameRaw).toLowerCase();
    if (!ALLOWED_TAGS.has(name)) return "";
    // Strip event handlers and javascript: URLs from allowed tags.
    return tag
      .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
      .replace(/javascript:/gi, "");
  });

  return out.replace(/\s+\n/g, "\n").trim();
}

// True when sanitizing `html` removed something meaningful (a disallowed tag or
// a dangerous attribute). Used by the validation service to fail the
// HTML-sanitization layer so the stored body is the sanitized one.
export function bodyNeededSanitizing(html: string): boolean {
  return sanitizeBody(html) !== (html ?? "").trim().replace(/\s+\n/g, "\n").trim();
}

export const SANITIZER_ALLOWED_TAGS = ALLOWED_TAGS;
