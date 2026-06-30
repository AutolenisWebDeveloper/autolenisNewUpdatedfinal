// lib/dealer-auth.ts — Dealer JWT authentication system
// Issues a dealer_token cookie after Supabase credential verification.
// Mirrors admin-auth.ts but without MFA — dealer auth is credential-only.

import { logger } from "@/lib/logger";
import { SignJWT, jwtVerify } from "jose";

function getJwtSecret(): Uint8Array {
  // Prefer a dedicated dealer signing secret so dealer and admin tokens are
  // cryptographically isolated. Falls back to the shared JWT_SECRET so existing
  // deployments/sessions keep working until ops sets DEALER_JWT_SECRET.
  // proxy.ts mirrors this exact precedence.
  const secret = process.env.DEALER_JWT_SECRET ?? process.env.JWT_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("DEALER_JWT_SECRET (or JWT_SECRET) is required in production");
    }
    logger.warn("[dealer-auth] DEALER_JWT_SECRET/JWT_SECRET not set — using insecure placeholder");
    return new TextEncoder().encode("placeholder-must-set-jwt-secret-in-env");
  }
  return new TextEncoder().encode(secret);
}
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
    .sign(getJwtSecret());
}

export async function verifyDealerJwt(token: string): Promise<DealerJwtPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getJwtSecret(), {
      issuer: DEALER_JWT_ISSUER,
    });
    return payload as unknown as DealerJwtPayload;
  } catch {
    return null;
  }
}
