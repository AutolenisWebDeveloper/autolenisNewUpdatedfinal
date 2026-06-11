// AutoLenis — Single source of truth for the canonical site origin.
// ─────────────────────────────────────────────────────────────────────────────
// Every SEO surface (sitemap, robots, metadata, JSON-LD, entity graph, AMIPS)
// must resolve the origin through SITE_ORIGIN / absoluteUrl so canonicals,
// schema @id's, and the robots `host` directive never split across hostnames.
//
// IMPORTANT: the production canonical origin uses the `www` subdomain.
// The fallback below MUST stay `https://www.autolenis.com` — a non-www
// fallback would fragment the canonical graph if NEXT_PUBLIC_APP_URL is unset.

/** Canonical production origin (www), used when NEXT_PUBLIC_APP_URL is unset. */
const DEFAULT_ORIGIN = "https://www.autolenis.com";

/**
 * The resolved site origin, e.g. `https://www.autolenis.com`.
 * Reads NEXT_PUBLIC_APP_URL, trims whitespace, and strips any trailing slash.
 */
export const SITE_ORIGIN: string = (
  process.env.NEXT_PUBLIC_APP_URL?.trim() || DEFAULT_ORIGIN
).replace(/\/$/, "");

/** The bare canonical host, e.g. `www.autolenis.com` (no protocol). */
export const SITE_HOST: string = (() => {
  try {
    return new URL(SITE_ORIGIN).host;
  } catch {
    return "www.autolenis.com";
  }
})();

/**
 * Join the site origin with a path. Guarantees exactly one separating slash and
 * preserves the root (`/`) without a trailing slash on the origin.
 */
export function absoluteUrl(path = "/"): string {
  if (!path) return SITE_ORIGIN;
  if (/^https?:\/\//i.test(path)) return path;
  return `${SITE_ORIGIN}${path.startsWith("/") ? path : `/${path}`}`;
}
