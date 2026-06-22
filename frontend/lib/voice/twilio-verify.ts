import { logger } from "@/lib/logger";
import twilio from "twilio";

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL ?? "https://autolenis.com").trim();

// F-013 — host parity. The signed URL is rebuilt from NEXT_PUBLIC_APP_URL, but
// Twilio signs over the EXACT public host it called. If the Twilio console is
// configured against `www.autolenis.com` while NEXT_PUBLIC_APP_URL is the apex
// `autolenis.com` (or vice-versa), `validateRequest` fails and ALL inbound
// voice is rejected — including nothing for SMS here (that path uses
// TWILIO_WEBHOOK_URL). Until the production console host is confirmed we DO NOT
// pick a canonical host. When TWILIO_VERIFY_ALT_HOST === 'true' we additionally
// accept a signature that validates against the www<->apex sibling of the same
// origin. This is strictly additive (the primary URL is tried first, unchanged)
// and only ever accepts a request Twilio genuinely signed for one of our own
// hosts. Default OFF = byte-for-byte current behavior.
const VERIFY_ALT_HOST = process.env.TWILIO_VERIFY_ALT_HOST === "true";

// Return the www<->apex sibling of a URL's host, or null when there is no
// meaningful sibling (non-apex/non-www host, or unparseable URL).
function altHostUrl(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.hostname.startsWith("www.")) {
      u.hostname = u.hostname.slice(4);
    } else {
      u.hostname = `www.${u.hostname}`;
    }
    return u.toString().replace(/\/$/, "") + (url.endsWith("/") ? "/" : "");
  } catch {
    return null;
  }
}

// Validate that an inbound request was signed by Twilio. `url` must be the
// exact public URL Twilio called (scheme + host + path, no query for POST) and
// `params` the parsed form body — Twilio computes the signature over both.
export function verifyTwilioRequest(
  authToken: string,
  signature: string,
  url: string,
  params: Record<string, string>,
): boolean {
  try {
    return twilio.validateRequest(authToken, signature, url, params);
  } catch {
    return false;
  }
}

// Read a Twilio webhook's form body and verify its signature in one step.
// The signed URL is rebuilt from NEXT_PUBLIC_APP_URL + the route path because
// behind Vercel's proxy the inbound request host/scheme does not match what
// Twilio signed. Pass `pathPart` as the absolute route path (e.g.
// "/api/twilio/voice/incoming").
export async function parseTwilioRequest(
  request: Request,
  pathPart: string,
): Promise<{ params: Record<string, string>; verified: boolean }> {
  const rawBody = await request.text();
  const params = Object.fromEntries(new URLSearchParams(rawBody)) as Record<string, string>;
  const signature = request.headers.get("x-twilio-signature") ?? "";
  const authToken = process.env.TWILIO_AUTH_TOKEN ?? "";
  const url = `${APP_URL}${pathPart}`;
  let verified = !!authToken && verifyTwilioRequest(authToken, signature, url, params);
  // F-013 fallback (opt-in): retry against the www<->apex sibling host so a
  // host mismatch between NEXT_PUBLIC_APP_URL and the Twilio console no longer
  // silently rejects legitimate inbound. Only runs when the primary failed AND
  // the flag is on — never weakens the default path.
  if (!verified && authToken && VERIFY_ALT_HOST && !!signature) {
    const alt = altHostUrl(url);
    if (alt && alt !== url && verifyTwilioRequest(authToken, signature, alt, params)) {
      logger.warn("[twilio-verify] verified via alt-host fallback — set NEXT_PUBLIC_APP_URL to the host Twilio calls", {
        path: pathPart,
        primaryUrl: url,
        altUrl: alt,
      });
      verified = true;
    }
  }
  if (!verified) {
    // Surfaces the most common failure cause: the URL Twilio signed does not
    // match `${NEXT_PUBLIC_APP_URL}${path}` (wrong host/scheme/trailing slash).
    logger.error("[twilio-verify] signature verification failed", {
      path: pathPart,
      expectedUrl: url,
      hasAuthToken: !!authToken,
      hasSignature: !!signature,
    });
  }
  return { params, verified };
}

export function twimlResponse(xml: string): Response {
  return new Response(xml, {
    headers: { "Content-Type": "text/xml; charset=utf-8" },
  });
}

// Escape the five XML predefined entities so AI-generated text can be embedded
// inside a <Say> element without breaking the TwiML document.
export function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// Strip markdown / symbols the TTS engine would read aloud literally
// ("asterisk", "hash") and collapse whitespace so Polly reads a clean sentence.
export function sanitizeForSpeech(text: string): string {
  return text
    .replace(/[*_`#>~|]/g, "")
    .replace(/\[(.*?)\]\(.*?\)/g, "$1") // markdown links -> label only
    .replace(/\s+/g, " ")
    .trim();
}
