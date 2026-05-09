import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import {
  verifyPreMfaToken, verifyTotpCodeFromEncrypted, signAdminJwt,
  verifyRecoveryCode, ADMIN_PREMFA_COOKIE, ADMIN_TOKEN_COOKIE,
  checkMfaRateLimit, recordMfaFailure, clearMfaFailures,
} from "@/lib/admin-auth";
import { AdminRole } from "@prisma/client";

const MAX_FAILED_MFA_ATTEMPTS = 5;
const MFA_LOCKOUT_MINUTES = 15;

// POST /api/admin/auth/verify-mfa — verify TOTP code OR recovery code
// MFA is REQUIRED — no skip path exists for any admin role
export async function POST(request: NextRequest) {
  try {
    const cookieStore = await cookies();
    const preMfaToken = cookieStore.get(ADMIN_PREMFA_COOKIE)?.value;

    if (!preMfaToken) {
      return NextResponse.json({ error: "Session expired. Please sign in again." }, { status: 401 });
    }

    const preMfaPayload = await verifyPreMfaToken(preMfaToken);
    if (!preMfaPayload) {
      return NextResponse.json({ error: "Invalid or expired session." }, { status: 401 });
    }

    const { code, isRecoveryCode } = await request.json() as { code: string; isRecoveryCode?: boolean };

    if (!code) {
      return NextResponse.json({ error: "Verification code is required." }, { status: 400 });
    }

    const admin = await prisma.admin.findUnique({
      where: { id: preMfaPayload.adminId },
      include: { user: true },
    });

    if (!admin) {
      return NextResponse.json({ error: "Admin account not found." }, { status: 401 });
    }

    // ── Lockout check ──────────────────────────────────────────────────────────
    if (admin.mfaLockedUntil && admin.mfaLockedUntil > new Date()) {
      const minutesLeft = Math.ceil((admin.mfaLockedUntil.getTime() - Date.now()) / 60_000);
      return NextResponse.json(
        { error: `Account temporarily locked after too many failed attempts. Try again in ${minutesLeft} minute${minutesLeft === 1 ? "" : "s"}.` },
        { status: 429 }
      );
    }

    // ── Recovery code exhausted message ────────────────────────────────────────
    if (isRecoveryCode && admin.recoveryCodes.length === 0) {
      return NextResponse.json(
        {
          error:
            "All recovery codes have been used. Contact platform owner or run the operational MFA reset script.",
          code: "RECOVERY_CODES_EXHAUSTED",
        },
        { status: 403 }
      );
    }

    let mfaValid = false;

    if (isRecoveryCode && admin.recoveryCodes.length > 0) {
      const matched = await verifyRecoveryCode(code, admin.recoveryCodes);
      if (matched) {
        const remaining = admin.recoveryCodes.filter(c => c !== matched);
        // Remove used recovery code — one-time use; track timestamp
        await prisma.admin.update({
          where: { id: admin.id },
          data: {
            recoveryCodes: remaining,
            lastRecoveryCodeUsedAt: new Date(),
            failedMfaAttempts: 0,
            mfaLockedUntil: null,
          },
        });
        mfaValid = true;

        // Audit log — recovery-code usage is a critical security event
        await prisma.adminAuditLog.create({
          data: {
            adminId: admin.id,
            adminEmail: admin.user.email,
            action: "ADMIN_MFA_RECOVERY_CODE_USED",
            entityType: "Admin",
            entityId: admin.id,
            metadata: { codesRemaining: remaining.length },
          },
        }).catch(err => console.error("[verify-mfa] audit log error:", err));
      }
    } else if (admin.totpEnabled && admin.totpSecret) {
      // totpSecret is stored AES-256-GCM encrypted — must decrypt before verifying
      mfaValid = verifyTotpCodeFromEncrypted(admin.totpSecret, code);
    }

    if (!mfaValid) {
      // Increment failed attempts and apply lockout if threshold reached
      const newFailedCount = admin.failedMfaAttempts + 1;
      const shouldLock = newFailedCount >= MAX_FAILED_MFA_ATTEMPTS;
      const lockedUntil = shouldLock
        ? new Date(Date.now() + MFA_LOCKOUT_MINUTES * 60_000)
        : admin.mfaLockedUntil;

      await prisma.admin.update({
        where: { id: admin.id },
        data: {
          failedMfaAttempts: newFailedCount,
          mfaLockedUntil: lockedUntil,
        },
      });

      // Audit log — failed attempt
      await prisma.adminAuditLog.create({
        data: {
          adminId: admin.id,
          adminEmail: admin.user.email,
          action: "ADMIN_MFA_FAILED_ATTEMPT",
          entityType: "Admin",
          entityId: admin.id,
          metadata: {
            attempt: newFailedCount,
            isRecoveryCode: isRecoveryCode ?? false,
            locked: shouldLock,
          },
        },
      }).catch(err => console.error("[verify-mfa] audit log error:", err));

      if (shouldLock) {
        // Emit lockout event
        await prisma.adminAuditLog.create({
          data: {
            adminId: admin.id,
            adminEmail: admin.user.email,
            action: "ADMIN_MFA_LOCKED",
            entityType: "Admin",
            entityId: admin.id,
            metadata: { lockedUntil: lockedUntil?.toISOString(), durationMinutes: MFA_LOCKOUT_MINUTES },
          },
        }).catch(err => console.error("[verify-mfa] audit log error:", err));

        return NextResponse.json(
          {
            error: `Too many failed attempts. Account locked for ${MFA_LOCKOUT_MINUTES} minutes.`,
            code: "MFA_LOCKED",
          },
          { status: 429 }
        );
      }

      const attemptsLeft = MAX_FAILED_MFA_ATTEMPTS - newFailedCount;
      return NextResponse.json(
        {
          error: `Invalid verification code. ${attemptsLeft} attempt${attemptsLeft === 1 ? "" : "s"} remaining before lockout.`,
        },
        { status: 401 }
      );
    }

    // Success — reset failure counter
    await clearMfaFailures(admin.id);

    // Issue full admin JWT — mfaVerified: true
    const adminToken = await signAdminJwt({
      adminId: admin.id,
      role: admin.role as AdminRole,
      email: admin.user.email,
      mfaVerified: true,
    });

    // Record MFA verification time and reset failed attempts
    await prisma.admin.update({
      where: { id: admin.id },
      data: {
        mfaVerifiedAt: new Date(),
        failedMfaAttempts: 0,
        mfaLockedUntil: null,
      },
    });

    // Audit log — successful MFA verification
    await prisma.adminAuditLog.create({
      data: {
        adminId: admin.id,
        adminEmail: admin.user.email,
        action: "ADMIN_MFA_VERIFIED",
        entityType: "Admin",
        entityId: admin.id,
        metadata: { method: isRecoveryCode ? "recovery_code" : "totp" },
      },
    }).catch(err => console.error("[verify-mfa] audit log error:", err));

    const res = NextResponse.json({ success: true });

    // CRITICAL: Emit ONLY ONE Set-Cookie header here. Earlier attempts with
    // two cookies (clear admin_premfa + set admin_token) hit a Cloudflare /
    // HTTP-2 proxy merge that joins Set-Cookie headers with a literal comma,
    // causing browsers to parse only the first cookie and drop admin_token.
    // admin_premfa already has Max-Age=600 (10 min) and self-expires; route
    // guards prefer admin_token, so leaving the stale pre-MFA cookie around
    // is harmless. See iter29/iter30 reports for the wire-level RCA.
    const isProd = process.env.NODE_ENV === "production";
    const secureFlag = isProd ? "; Secure" : "";
    res.headers.set(
      "Set-Cookie",
      `${ADMIN_TOKEN_COOKIE}=${adminToken}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400${secureFlag}`,
    );

    return res;

  } catch (err) {
    // Always return JSON — never let unhandled exceptions produce empty body
    console.error("[verify-mfa] Error:", err);
    return NextResponse.json(
      { error: "An unexpected error occurred. Please sign in again." },
      { status: 500 }
    );
  }
}
