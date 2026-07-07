import "server-only";
import { createHmac, timingSafeEqual } from "crypto";

// One-click unsubscribe tokens for dealer cold outreach (CAN-SPAM + the Gmail/
// Yahoo bulk-sender one-click requirement, RFC 8058). The token is a stateless
// HMAC of the recipient's email, so no per-send DB row is needed and the link
// stays valid for the life of the signing secret.
//
// Secret resolution: a dedicated UNSUBSCRIBE_SECRET if set, else CRON_SECRET
// (already present in this deployment). If NEITHER is configured we return null
// everywhere and the caller degrades to the reply-"UNSUBSCRIBE" footer only —
// never a broken link.

function secret(): string | null {
  return process.env.UNSUBSCRIBE_SECRET || process.env.CRON_SECRET || null;
}

function sign(payload: string, key: string): string {
  return createHmac("sha256", key).update(payload).digest("base64url");
}

/** Mint an unsubscribe token for an email, or null when no secret is set. */
export function makeUnsubscribeToken(email: string): string | null {
  const key = secret();
  if (!key) return null;
  const payload = Buffer.from(email.trim().toLowerCase(), "utf8").toString("base64url");
  return `${payload}.${sign(payload, key)}`;
}

/** Verify a token and return the email it encodes, or null if invalid. */
export function verifyUnsubscribeToken(token: string): string | null {
  const key = secret();
  if (!key || typeof token !== "string" || !token.includes(".")) return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const expected = sign(payload, key);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const email = Buffer.from(payload, "base64url").toString("utf8");
    return email.includes("@") ? email : null;
  } catch {
    return null;
  }
}

/** Build the absolute one-click unsubscribe URL, or null when no secret is set. */
export function buildUnsubscribeUrl(email: string): string | null {
  const token = makeUnsubscribeToken(email);
  if (!token) return null;
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? "https://www.autolenis.com")
    .trim()
    .replace(/\/+$/, "");
  return `${base}/api/public/dealer-unsubscribe?token=${encodeURIComponent(token)}`;
}
