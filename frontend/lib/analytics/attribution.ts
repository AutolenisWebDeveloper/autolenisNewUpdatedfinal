// Phase C-Attribution — first-party, last-touch content attribution.
//
// When a visitor reads a buying-guide article we drop a short-lived cookie
// describing the article (cluster / city / state / metro). When that visitor
// later converts on any lead form, the server reads this cookie and records a
// ContentAttribution row, so conversions can be reported by content dimension.
//
// Cookie-only, no PII. SameSite=Lax, 30-day TTL. Mirrored to localStorage so
// client code (e.g. firing the content_lead GA4 event) can read it without
// re-parsing the cookie. `parseTouch` is pure and reused by the server reader.

export const ATTRIBUTION_COOKIE = "al_content_attr";
const TTL_DAYS = 30;

export interface ContentAttributionTouch {
  slug: string;
  cluster: string;
  city: string;
  state: string;
  metro?: string;
  ts: number; // epoch ms of the touch
}

/** Validate + normalise a raw JSON string into a touch. Pure — server-safe. */
export function parseTouch(raw: string): ContentAttributionTouch | null {
  try {
    const v = JSON.parse(raw) as Record<string, unknown>;
    if (
      v &&
      typeof v.slug === "string" &&
      typeof v.cluster === "string" &&
      typeof v.city === "string" &&
      typeof v.state === "string"
    ) {
      return {
        slug: v.slug,
        cluster: v.cluster,
        city: v.city,
        state: v.state,
        metro: typeof v.metro === "string" ? v.metro : undefined,
        ts: typeof v.ts === "number" ? v.ts : Date.now(),
      };
    }
  } catch {
    // fall through
  }
  return null;
}

/** Record a last-touch on the current article. Client-only; never throws. */
export function captureContentAttribution(
  touch: Omit<ContentAttributionTouch, "ts">,
): void {
  if (typeof document === "undefined") return;
  try {
    const value: ContentAttributionTouch = { ...touch, ts: Date.now() };
    const encoded = encodeURIComponent(JSON.stringify(value));
    const maxAge = TTL_DAYS * 24 * 60 * 60;
    document.cookie = `${ATTRIBUTION_COOKIE}=${encoded}; Max-Age=${maxAge}; Path=/; SameSite=Lax`;
    window.localStorage?.setItem(ATTRIBUTION_COOKIE, encoded);
  } catch {
    // Attribution must never throw into UX.
  }
}

/** Read the current last-touch, if any. Client-only. */
export function readContentAttribution(): ContentAttributionTouch | null {
  if (typeof document === "undefined") return null;
  try {
    const fromCookie = document.cookie
      .split("; ")
      .find((c) => c.startsWith(`${ATTRIBUTION_COOKIE}=`))
      ?.slice(ATTRIBUTION_COOKIE.length + 1);
    const raw =
      fromCookie ?? window.localStorage?.getItem(ATTRIBUTION_COOKIE) ?? null;
    if (!raw) return null;
    return parseTouch(decodeURIComponent(raw));
  } catch {
    return null;
  }
}
