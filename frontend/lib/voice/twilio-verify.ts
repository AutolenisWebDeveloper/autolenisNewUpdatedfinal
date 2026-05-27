import twilio from "twilio";

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL ?? "https://autolenis.com").trim();

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
  const verified = !!authToken && verifyTwilioRequest(authToken, signature, url, params);
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
