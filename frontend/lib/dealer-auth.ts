// lib/dealer-auth.ts — Dealer JWT authentication system
// Issues a dealer_token cookie after Supabase credential verification.
// Mirrors admin-auth.ts but without MFA — dealer auth is credential-only.

import { SignJWT, jwtVerify } from "jose";

const _jwtSecretRaw = process.env.JWT_SECRET;
if (!_jwtSecretRaw) {
  if (process.env.NODE_ENV === "production") {
    throw new Error("JWT_SECRET is required in production");
  }
  console.warn("[dealer-auth] JWT_SECRET not set — using insecure placeholder");
}
const DEALER_JWT_SECRET = new TextEncoder().encode(
  _jwtSecretRaw ?? "placeholder-must-set-jwt-secret-in-env"
);
const DEALER_JWT_ISSUER = "autolenis-dealer";
const DEALER_JWT_TTL_DEFAULT = "7d";
const DEALER_JWT_TTL_REMEMBER = "30d";

export const DEALER_TOKEN_COOKIE = "dealer_token";

export interface DealerJwtPayload {
  dealerId: string;
  userId: string;
  email: string;
  role: "DEALER";
}

export async function signDealerJwt(payload: DealerJwtPayload, opts?: { remember?: boolean }): Promise<string> {
  const ttl = opts?.remember ? DEALER_JWT_TTL_REMEMBER : DEALER_JWT_TTL_DEFAULT;
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(DEALER_JWT_ISSUER)
    .setIssuedAt()
    .setExpirationTime(ttl)
    .sign(DEALER_JWT_SECRET);
}

export async function verifyDealerJwt(token: string): Promise<DealerJwtPayload | null> {
  try {
    const { payload } = await jwtVerify(token, DEALER_JWT_SECRET, {
      issuer: DEALER_JWT_ISSUER,
    });
    return payload as unknown as DealerJwtPayload;
  } catch {
    return null;
  }
}
