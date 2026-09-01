// lib/services/ai/zura-session-handle.ts
//
// The server-issued session handle for the anonymous public concierge.
//
// THE PROBLEM IT CLOSES (Phase 1 HIGH / Phase 2 §5.4): the public concierge's
// only identity was a `sessionId` the BROWSER minted (`crypto.randomUUID()` in
// `ChatWidget`) and posted in the body. The server accepted whatever arrived, so
// a caller could open unlimited parallel "sessions" from one origin, and could
// address any session id it chose — including one it guessed.
//
// The fix is an HMAC-signed, short-TTL opaque token issued by the server on turn
// 1 and presented on every later turn. An attacker-chosen id no longer opens a
// session, so parallel sessions from one origin become bounded by the IP limit.
//
// It carries ONE claim beyond the session id: whether the server itself
// validated a lead-gate submission on this session. That is what makes consent
// server-verified without a schema change — consent capture happens in the
// post-stream block of a LATER turn than the gate, so the fact needs to be
// durable, and a signed claim is durable without a new column.
//
// NO NEW SIGNING SCHEME: this is the shape already proven by
// `lib/services/dealer-recruitment/unsubscribe-token.service.ts` —
// `createHmac("sha256")` over a base64url payload, compared with
// `timingSafeEqual`.
//
// It DEGRADES CLOSED, unlike the unsubscribe token. A missing secret there costs
// a convenience link; here it would silently reduce a security control to
// nothing, so minting returns `null` and the caller refuses the request with a
// diagnosable error instead.

import "server-only";
import { createHmac, randomUUID, timingSafeEqual } from "crypto";

/** How long an issued handle stays valid. A concierge conversation is short. */
export const SESSION_HANDLE_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours

/** The response/request header the handle travels in. */
export const SESSION_HANDLE_HEADER = "X-Zura-Session";

export interface ZuraSessionClaims {
  /** The session id. SERVER-minted; never accepted from a request body. */
  sid: string;
  /** Issued-at, epoch ms. */
  iat: number;
  /**
   * Did the SERVER validate a lead-gate submission on this session? Consent is
   * written only when this is true. It can never be set by a client, because the
   * client cannot forge the signature that covers it.
   */
  gate: boolean;
}

function secret(): string | null {
  return process.env.ZURA_SESSION_SECRET || process.env.CRON_SECRET || null;
}

/**
 * Domain separator bound into every signature.
 *
 * The signing key falls back to `CRON_SECRET`, which the unsubscribe-token
 * service also uses. Cross-scheme token confusion is not constructible today —
 * a session payload decodes to JSON with no "@", and an unsubscribe payload is
 * not JSON — but that is an accident of the two payload shapes, not a control.
 * Signing over a scheme-scoped string makes a signature valid for exactly one
 * scheme, so the two can never be confused however their payloads evolve. The
 * version suffix leaves room to rotate the format without accepting old tokens.
 */
const SIGNING_DOMAIN = "autolenis.zura.session.v1";

function sign(payload: string, key: string): string {
  return createHmac("sha256", key).update(`${SIGNING_DOMAIN}.${payload}`).digest("base64url");
}

/**
 * Mint a handle. Returns `null` when no signing secret is configured — the
 * caller must refuse the request rather than proceed unauthenticated.
 */
export function mintSessionHandle(claims: Omit<ZuraSessionClaims, "iat">): string | null {
  const key = secret();
  if (!key) return null;
  const body: ZuraSessionClaims = { ...claims, iat: Date.now() };
  const payload = Buffer.from(JSON.stringify(body), "utf8").toString("base64url");
  return `${payload}.${sign(payload, key)}`;
}

/** Mint a handle for a brand-new session, returning its claims alongside. */
export function startSession(gate: boolean): { handle: string; claims: ZuraSessionClaims } | null {
  const claims: ZuraSessionClaims = { sid: randomUUID(), iat: Date.now(), gate };
  const handle = mintSessionHandle({ sid: claims.sid, gate: claims.gate });
  if (!handle) return null;
  return { handle, claims };
}

/**
 * Verify a handle and return its claims, or `null` for anything that is not a
 * currently-valid, server-issued token: no secret, wrong shape, bad signature,
 * unparseable payload, or expired.
 */
export function verifySessionHandle(token: unknown): ZuraSessionClaims | null {
  const key = secret();
  if (!key || typeof token !== "string" || !token.includes(".")) return null;

  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;

  const expected = sign(payload, key);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  let claims: unknown;
  try {
    claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (typeof claims !== "object" || claims === null) return null;

  const { sid, iat, gate } = claims as Record<string, unknown>;
  if (typeof sid !== "string" || sid.length === 0) return null;
  if (typeof iat !== "number" || !Number.isFinite(iat)) return null;
  if (typeof gate !== "boolean") return null;

  // Reject an expired handle AND one dated in the future: a future `iat` would
  // otherwise extend a token's life indefinitely if the secret ever leaked.
  const age = Date.now() - iat;
  if (age < 0 || age > SESSION_HANDLE_TTL_MS) return null;

  return { sid, iat, gate };
}

/** Is a signing secret configured at all? Lets a caller fail with a clear code. */
export function isSessionHandleConfigured(): boolean {
  return secret() !== null;
}

// ─── Server-side lead-gate validation ────────────────────────────────────────
//
// The gate was validated in the BROWSER only (`ChatWidget.handleLeadSubmit`),
// and the server wrote `consentEmail`/`consentSms` on the strength of an email
// merely being present in the request body. A caller could therefore assert
// consent by posting an email. These are the same checks, performed where they
// count.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_NAME_LENGTH = 120;
const MAX_EMAIL_LENGTH = 254; // RFC 5321 practical maximum

export interface GateSubmission {
  firstName: string;
  email: string;
}

/**
 * Validate a lead-gate submission server-side. Returns the normalised values, or
 * `null` when the submission does not constitute a gate acceptance.
 */
export function validateGateSubmission(input: {
  firstName?: unknown;
  email?: unknown;
}): GateSubmission | null {
  const firstName = typeof input.firstName === "string" ? input.firstName.trim() : "";
  const email = typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
  if (!firstName || firstName.length > MAX_NAME_LENGTH) return null;
  if (!email || email.length > MAX_EMAIL_LENGTH || !EMAIL_RE.test(email)) return null;
  return { firstName, email };
}
