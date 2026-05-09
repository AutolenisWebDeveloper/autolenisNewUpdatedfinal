// lib/admin-auth.ts — Admin authentication system
// SEPARATE from buyer/dealer Supabase auth — never mix these systems
// TOTP uses `otpauth` npm library (D6 fix — no custom TOTP implementation)
// JWT uses `jose` library
// MFA is REQUIRED for all admin roles — no skip path exists

import * as OTPAuth from "otpauth";
import { SignJWT, jwtVerify } from "jose";
import { randomBytes, createCipheriv, createDecipheriv, createHash } from "crypto";
import QRCode from "qrcode";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { AdminRole } from "@prisma/client";

// Lazy JWT secret loader — evaluated on first use, not at module load.
// Turbopack evaluates module-level code during static page builds before
// runtime env variables are injected. Throwing here would crash the build.
let _adminJwtSecret: Uint8Array | null = null;
function getAdminJwtSecret(): Uint8Array {
  if (_adminJwtSecret) return _adminJwtSecret;
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("JWT_SECRET environment variable is not set");
  }
  _adminJwtSecret = new TextEncoder().encode(secret);
  return _adminJwtSecret;
}
const ADMIN_JWT_ISSUER = "autolenis-admin";
const ADMIN_JWT_TTL = "24h";
const TOTP_ISSUER = "AutoLenis";
const RECOVERY_CODE_COUNT = 10;

// ─── MFA Encryption Key Error ─────────────────────────────────────────────────

export class MfaEncryptionKeyMissingError extends Error {
  constructor() {
    super(
      "MFA_ENCRYPTION_KEY environment variable is not set. " +
        "Generate a 32-byte hex key (64 hex chars) and add it to your environment. " +
        "This key is required for TOTP secret encryption."
    );
    this.name = "MfaEncryptionKeyMissingError";
  }
}

// ─── TOTP Secret Encryption/Decryption ───────────────────────────────────────
// TOTP secrets are stored AES-256-GCM encrypted at rest using MFA_ENCRYPTION_KEY.
// Falls back to PREQUAL_ENCRYPTION_KEY for decryption only (migration path for
// existing secrets encrypted before MFA_ENCRYPTION_KEY was introduced).

function getMfaKey(): Buffer | null {
  const k = process.env.MFA_ENCRYPTION_KEY;
  if (!k) return null;
  return Buffer.from(k, "hex");
}

function getPrequalKey(): Buffer | null {
  const k = process.env.PREQUAL_ENCRYPTION_KEY;
  if (!k) return null;
  return Buffer.from(k, "hex");
}

function getTotpEncryptionKey(): Buffer {
  const key = getMfaKey();
  if (key) return key;
  // Legacy fallback — PREQUAL_ENCRYPTION_KEY used before MFA_ENCRYPTION_KEY was added.
  // New installations must set MFA_ENCRYPTION_KEY.
  const legacy = getPrequalKey();
  if (legacy) {
    console.warn(
      "[SECURITY] MFA_ENCRYPTION_KEY is not set; falling back to PREQUAL_ENCRYPTION_KEY. " +
        "Set MFA_ENCRYPTION_KEY in your environment for dedicated TOTP encryption."
    );
    return legacy;
  }
  throw new MfaEncryptionKeyMissingError();
}

function decryptWithKey(encrypted: string, key: Buffer): string {
  const buf = Buffer.from(encrypted, "base64");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const data = buf.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return decipher.update(data).toString("utf8") + decipher.final("utf8");
}

export function encryptTotpSecret(plaintext: string): string {
  const key = getTotpEncryptionKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString("base64");
}

export function decryptTotpSecret(encrypted: string): string {
  // Try MFA_ENCRYPTION_KEY first (preferred).
  const mfaKey = getMfaKey();
  if (mfaKey) {
    try {
      return decryptWithKey(encrypted, mfaKey);
    } catch {
      // Decryption with MFA_ENCRYPTION_KEY failed — try legacy PREQUAL_ENCRYPTION_KEY.
      // This handles secrets encrypted before the dedicated key was introduced.
      const legacy = getPrequalKey();
      if (legacy) {
        return decryptWithKey(encrypted, legacy);
      }
      throw new Error("TOTP secret decryption failed with MFA_ENCRYPTION_KEY.");
    }
  }
  // No MFA_ENCRYPTION_KEY — use PREQUAL_ENCRYPTION_KEY (legacy path).
  const legacy = getPrequalKey();
  if (legacy) return decryptWithKey(encrypted, legacy);
  throw new MfaEncryptionKeyMissingError();
}

// ─── TOTP (RFC 6238 via otpauth library — D6 requirement) ─────────────────────

export function generateTotpSecret(): string {
  const secret = new OTPAuth.Secret({ size: 20 });
  return secret.base32; // Base32-encoded secret for storage
}

export function getTotpUri(secretBase32: string, adminEmail: string): string {
  const totp = new OTPAuth.TOTP({
    issuer: TOTP_ISSUER,
    label: adminEmail,
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(secretBase32),
  });
  return totp.toString(); // otpauth://totp/AutoLenis:email?secret=...
}

export async function getTotpQrCode(secretBase32: string, adminEmail: string): Promise<string> {
  const uri = getTotpUri(secretBase32, adminEmail);
  // Use local qrcode library — no external API calls (D7)
  return QRCode.toDataURL(uri);
}

export function verifyTotpCode(secretBase32: string, code: string): boolean {
  const totp = new OTPAuth.TOTP({
    issuer: TOTP_ISSUER,
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(secretBase32),
  });
  // window: 1 allows codes from ±1 period (30s tolerance)
  const delta = totp.validate({ token: code.replace(/\s/g, ""), window: 1 });
  return delta !== null;
}

// Verify TOTP code when the stored secret is AES-256-GCM encrypted (production path)
export function verifyTotpCodeFromEncrypted(encryptedSecret: string, code: string): boolean {
  try {
    const secretBase32 = decryptTotpSecret(encryptedSecret);
    return verifyTotpCode(secretBase32, code);
  } catch {
    return false;
  }
}

// ─── Recovery Codes ───────────────────────────────────────────────────────────
// Backup codes are hashed with bcrypt (salted, slow) — never SHA-256 or plain.
// BCRYPT_ROUNDS = 10 balances security and latency for up to 10 codes at setup.

const BCRYPT_ROUNDS = 10;

export async function generateRecoveryCodes(): Promise<{ plain: string[]; hashed: string[] }> {
  const plain = Array.from({ length: RECOVERY_CODE_COUNT }, () =>
    randomBytes(5).toString("hex").toUpperCase().replace(/(.{4})/g, "$1-").slice(0, -1)
  );
  const hashed = await Promise.all(plain.map(c => bcrypt.hash(c, BCRYPT_ROUNDS)));
  return { plain, hashed };
}

// Returns the matched bcrypt hash string so callers can filter it out (single-use).
// Uses bcrypt.compare — constant-time, safe against timing attacks.
export async function verifyRecoveryCode(code: string, hashed: string[]): Promise<string | null> {
  const normalized = code.trim().toUpperCase();
  for (const h of hashed) {
    const matches = await bcrypt.compare(normalized, h);
    if (matches) return h;
  }
  return null;
}

// ─── Admin JWT ────────────────────────────────────────────────────────────────

export interface AdminJwtPayload {
  adminId: string;
  role: AdminRole;
  email: string;
  mfaVerified: boolean;
}

export async function signAdminJwt(payload: AdminJwtPayload): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(ADMIN_JWT_ISSUER)
    .setIssuedAt()
    .setExpirationTime(ADMIN_JWT_TTL)
    .sign(getAdminJwtSecret());
}

export async function verifyAdminJwt(token: string): Promise<AdminJwtPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getAdminJwtSecret(), {
      issuer: ADMIN_JWT_ISSUER,
    });
    return payload as unknown as AdminJwtPayload;
  } catch {
    return null;
  }
}

// Pre-MFA token — grants access to verify-mfa page only
export async function signPreMfaToken(adminId: string): Promise<string> {
  return new SignJWT({ adminId, scope: "pre-mfa" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(ADMIN_JWT_ISSUER)
    .setIssuedAt()
    .setExpirationTime("10m") // 10 min to complete MFA
    .sign(getAdminJwtSecret());
}

export async function verifyPreMfaToken(token: string): Promise<{ adminId: string } | null> {
  try {
    const { payload } = await jwtVerify(token, getAdminJwtSecret(), { issuer: ADMIN_JWT_ISSUER });
    if (payload.scope !== "pre-mfa") return null;
    return { adminId: payload.adminId as string };
  } catch {
    return null;
  }
}

// ─── MFA Rate Limiting ────────────────────────────────────────────────────────
// Per-admin-account lockout after repeated TOTP/backup-code failures.
// IP-based limiting is NOT used — admins may share office IPs or use VPNs.

const MFA_MAX_ATTEMPTS = 5;
const MFA_LOCKOUT_MINUTES = 15;

/**
 * Call at the start of every MFA verification handler.
 * Throws if the admin is currently locked out.
 */
export async function checkMfaRateLimit(adminId: string): Promise<void> {
  const admin = await prisma.admin.findUniqueOrThrow({ where: { id: adminId } });
  if (admin.mfaLockedUntil && admin.mfaLockedUntil > new Date()) {
    const minutesLeft = Math.ceil(
      (admin.mfaLockedUntil.getTime() - Date.now()) / 60000
    );
    throw new Error(`MFA_LOCKED:${minutesLeft}`);
  }
}

/**
 * Call after every failed TOTP or backup-code attempt.
 * Increments the counter; locks the account after MFA_MAX_ATTEMPTS failures.
 */
export async function recordMfaFailure(adminId: string, adminEmail: string): Promise<void> {
  const admin = await prisma.admin.findUniqueOrThrow({ where: { id: adminId } });
  const newCount = admin.failedMfaAttempts + 1;
  const lockedUntil =
    newCount >= MFA_MAX_ATTEMPTS
      ? new Date(Date.now() + MFA_LOCKOUT_MINUTES * 60 * 1000)
      : null;

  await prisma.admin.update({
    where: { id: adminId },
    data: {
      failedMfaAttempts: newCount,
      ...(lockedUntil ? { mfaLockedUntil: lockedUntil } : {}),
    },
  });

  await prisma.adminAuditLog.create({
    data: {
      adminId,
      adminEmail,
      action: "ADMIN_MFA_VERIFICATION_FAILED",
      entityType: "Admin",
      entityId: adminId,
      metadata: { attemptNumber: newCount, lockedUntil },
    },
  }).catch(err => console.error("[admin-mfa] audit log error:", err));

  if (lockedUntil) {
    await prisma.adminAuditLog.create({
      data: {
        adminId,
        adminEmail,
        action: "ADMIN_MFA_LOCKED_OUT",
        entityType: "Admin",
        entityId: adminId,
        metadata: { lockedUntil, attempts: newCount },
      },
    }).catch(err => console.error("[admin-mfa] lockout audit log error:", err));
  }
}

/**
 * Call after a successful MFA verification to reset the failure counter.
 */
export async function clearMfaFailures(adminId: string): Promise<void> {
  await prisma.admin.update({
    where: { id: adminId },
    data: { failedMfaAttempts: 0, mfaLockedUntil: null },
  });
}

// ─── Cookie name ──────────────────────────────────────────────────────────────
export const ADMIN_TOKEN_COOKIE = "admin_token";
export const ADMIN_PREMFA_COOKIE = "admin_premfa";

// ─── MFA Email Confirmation Tokens ────────────────────────────────────────────
// Single-use tokens sent to admin email before showing QR code during setup.
// Stored hashed — plaintext never persisted in the database.

export const MFA_EMAIL_TOKEN_TTL_MS = 10 * 60 * 1000; // 10 minutes

export function generateMfaEmailToken(): { plain: string; hash: string } {
  const plain = randomBytes(32).toString("hex");
  const hash = createHash("sha256").update(plain).digest("hex");
  return { plain, hash };
}

export function hashMfaEmailToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

// ─── Canonical admin tier display names ───────────────────────────────────────
export const ADMIN_ROLE_LABELS: Record<AdminRole, string> = {
  SUPER_ADMIN: "Super Admin",
  OPERATIONS_ADMIN: "Operations Admin",
  COMPLIANCE_ADMIN: "Compliance Admin",
  FINANCE_ADMIN: "Finance Admin",
  SUPPORT_ADMIN: "Support Admin",
};