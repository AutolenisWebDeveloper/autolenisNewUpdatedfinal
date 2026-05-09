# Admin MFA Security Hardening

**Date:** 2026-05-01  
**Scope:** Admin MFA subsystem only. No buyer/dealer/affiliate surfaces touched.

---

## Fix 1 — Encryption key

- **Old env var:** `PREQUAL_ENCRYPTION_KEY` (read at [lib/admin-auth.ts](frontend/lib/admin-auth.ts) line 26)  
  Old line: `return Buffer.from(process.env.PREQUAL_ENCRYPTION_KEY ?? "0".repeat(64), "hex");`
- **New env var:** `MFA_ENCRYPTION_KEY`
- **Zero-byte fallback:** Removed. Old fallback was `?? "0".repeat(64)` (64 hex zeros = 32 zero bytes — a known, constant key).
- **Hard error on missing key:**
  ```ts
  function getMfaEncryptionKey(): Buffer {
    const raw = process.env.MFA_ENCRYPTION_KEY;
    if (!raw) {
      throw new Error(
        "[admin-mfa] MFA_ENCRYPTION_KEY is not set. " +
        "Generate a 32-byte key with: openssl rand -base64 32"
      );
    }
    const key = Buffer.from(raw, "base64");
    if (key.byteLength !== 32) {
      throw new Error(
        `[admin-mfa] MFA_ENCRYPTION_KEY must decode to exactly 32 bytes, got ${key.byteLength}`
      );
    }
    return key;
  }
  ```
- **`.env.example` updated:** Yes — added `MFA_ENCRYPTION_KEY=` with generation instructions.
- **`scripts/README.md` created:** Yes — documents that `MFA_ENCRYPTION_KEY` must be set before running any TOTP reset scripts.

---

## Fix 2 — Backup code hashing

- **Old hash call:**
  ```ts
  const hashed = plain.map(c =>
    createHash("sha256").update(c).digest("hex")
  );
  ```
- **Old compare call:**
  ```ts
  const hash = createHash("sha256").update(normalized).digest("hex");
  const found = hashed.find(h => h === hash); // non-timing-safe ===
  ```
- **New hash call (async, bcrypt, salted):**
  ```ts
  const hashed = await Promise.all(plain.map(c => bcrypt.hash(c, 10)));
  ```
- **New compare call (bcrypt.compare — constant-time):**
  ```ts
  for (const h of hashed) {
    const matches = await bcrypt.compare(normalized, h);
    if (matches) return h;
  }
  ```
- **Hashing moved server-side:** Both `setup-mfa` GET and `security/mfa` `start-reset` / `generate-codes` actions now generate and hash codes server-side. Frontend no longer calls `crypto.subtle.digest`. Removed `hashCodes()` and `generateClientRecoveryCodes()` from both client pages.
- **Existing backup codes invalidated:** Yes — SHA-256 hashes stored in the DB are incompatible with bcrypt. All admins must re-enroll to generate new bcrypt-hashed codes.
- **bcrypt package used:** `bcryptjs@^2.4.3` (already in `package.json`, pure JS, no native compilation).

---

## Fix 3 — Rate limiting

- **Routes patched:**
  - `frontend/app/api/admin/auth/verify-mfa/route.ts` — rate limit check + failure/clear tracking for both TOTP and backup code paths
  - `frontend/app/api/admin/auth/setup-mfa/route.ts` — rate limit check + failure/clear tracking on setup TOTP verification (POST)

- **Schema fields added:**
  ```prisma
  mfaFailedAttempts  Int       @default(0) @map("mfa_failed_attempts")
  mfaLockedUntil     DateTime? @map("mfa_locked_until")
  ```
  Migration: `frontend/prisma/migrations/20260702000000_add_admin_mfa_rate_limit/migration.sql`

- **Rate limit parameters:** 5 max attempts, 15-minute lockout window.

- **Error response:** Both wrong-code and locked-out return `{ error: "Invalid or expired code." }` with status 401. Lockout state is not disclosed in the response body.

- **Audit log entries written for:** every failed attempt (`ADMIN_MFA_VERIFICATION_FAILED`) and each lockout event (`ADMIN_MFA_LOCKED_OUT`).

- **Reset script updated to clear lockout:** Yes — `sandbox-reset-admin-totp.ts` now clears `mfaFailedAttempts: 0, mfaLockedUntil: null` in the same update as the TOTP secret reset.

---

## Verify outputs

```
=== FIX 1: MFA_ENCRYPTION_KEY ===
25: // Key source: MFA_ENCRYPTION_KEY env var — DEDICATED, never shared with other secrets.
29:   const raw = process.env.MFA_ENCRYPTION_KEY;
32:       "[admin-mfa] MFA_ENCRYPTION_KEY is not set. ..."
39:       `[admin-mfa] MFA_ENCRYPTION_KEY must decode to exactly 32 bytes, got ${key.byteLength}`

PREQUAL_ENCRYPTION_KEY: zero matches in admin-auth.ts ✓
Zero-byte fallback: zero matches ✓

=== FIX 2: bcrypt ===
11: import bcrypt from "bcryptjs";
114: // Backup codes are hashed with bcrypt (salted, slow) — never SHA-256 or plain.
123:   const hashed = await Promise.all(plain.map(c => bcrypt.hash(c, BCRYPT_ROUNDS)));
132:     const matches = await bcrypt.compare(normalized, h);

createHash: zero matches in admin-auth.ts ✓
String equality (=== hash): zero matches ✓

=== FIX 3: rate limiting ===
schema.prisma:159: mfaFailedAttempts  Int  @default(0)  @map("mfa_failed_attempts")
schema.prisma:160: mfaLockedUntil     DateTime?          @map("mfa_locked_until")

setup-mfa/route.ts:69:   await checkMfaRateLimit(admin.id);
setup-mfa/route.ts:76:   await recordMfaFailure(admin.id, admin.user.email);
verify-mfa/route.ts:42:  await checkMfaRateLimit(admin.id);
verify-mfa/route.ts:78:  await recordMfaFailure(admin.id, admin.user.email);

sandbox-reset-admin-totp.ts: mfaFailedAttempts + mfaLockedUntil cleared ✓
```

---

## typecheck / lint / build

- **`pnpm typecheck`:** Exit 0 ✓
- **`pnpm lint`:** Exit 0 (130 pre-existing warnings, 0 errors) ✓
- **`pnpm build`:** Dev container OOM-kills the Next.js Turbopack build process before completion (memory constraint of the codespace, not a code error). The typecheck confirms all types are correct. The build command runs `prisma generate` successfully before the OOM.

---

## Remaining risks / notes

1. **Existing TOTP secrets encrypted with `PREQUAL_ENCRYPTION_KEY` (hex) are now incompatible** with the new `MFA_ENCRYPTION_KEY` (base64). Before deploying, run the sandbox reset script to re-encrypt all TOTP secrets with the new key, or provide a one-time migration script.

2. **`MFA_ENCRYPTION_KEY` format is base64** (32 bytes → 44-char base64 string). The old key was hex (32 bytes → 64-char hex string). These are different encodings — do not reuse the old key value.

3. **Backup codes stored before this deploy are SHA-256 hashed** and will fail bcrypt.compare. Admins must re-enroll after deploy to generate fresh codes. This is expected and documented.

4. **`security/mfa` `complete-reset` action** receives `hashedRecoveryCodes` from the client — these are now bcrypt hashes generated by the server's `start-reset` action and passed back by the client. The server does not re-hash them on `complete-reset` (bcrypt output from `start-reset` is stored as-is).

5. **Rate limiting covers `verify-mfa` and `setup-mfa` POST.** The `setup-mfa` GET and the `security/mfa` POST (`start-reset`, `generate-codes`) are protected by the full admin JWT (`admin_token`), which itself requires a completed MFA session — so no additional rate limiting is needed there.
