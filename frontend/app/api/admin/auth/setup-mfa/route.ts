import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import {
  verifyPreMfaToken, generateTotpSecret, getTotpQrCode, generateRecoveryCodes,
  verifyTotpCode, signAdminJwt, encryptTotpSecret, hashMfaEmailToken,
  ADMIN_PREMFA_COOKIE, ADMIN_TOKEN_COOKIE,
  checkMfaRateLimit, recordMfaFailure,
} from "@/lib/admin-auth";
import { AdminRole } from "@prisma/client";

// GET — check email confirmation status; if confirmed generate TOTP secret + QR code.
// Requires ?emailToken=<token> query parameter (issued by POST /api/admin/auth/setup-mfa/send-email).
// Without a valid emailToken, returns { requiresEmailConfirmation: true }.
export async function GET(request: NextRequest) {
  const cookieStore = await cookies();
  const preMfaToken = cookieStore.get(ADMIN_PREMFA_COOKIE)?.value;
  if (!preMfaToken) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const payload = await verifyPreMfaToken(preMfaToken);
  if (!payload) return NextResponse.json({ error: "Invalid session" }, { status: 401 });

  const admin = await prisma.admin.findUnique({
    where: { id: payload.adminId },
    include: { user: true },
  });
  if (!admin) return NextResponse.json({ error: "Admin not found" }, { status: 404 });

  // If MFA is already enrolled, setup is not available
  if (admin.totpEnabled) {
    return NextResponse.json({ error: "MFA already enrolled. Use /admin/security/mfa to reset." }, { status: 400 });
  }

  // Check for email confirmation token in query string
  const { searchParams } = new URL(request.url);
  const rawToken = searchParams.get("emailToken");

  if (!rawToken) {
    // No token provided — client should call the send-email endpoint first
    return NextResponse.json({ requiresEmailConfirmation: true, emailSentTo: admin.user.email });
  }

  // Verify the token
  const tokenHash = hashMfaEmailToken(rawToken);
  const emailToken = await prisma.adminMfaEmailToken.findFirst({
    where: {
      adminId: admin.id,
      tokenHash,
      usedAt: null,
      expiresAt: { gt: new Date() },
    },
  });

  if (!emailToken) {
    return NextResponse.json(
      { error: "Email confirmation link is invalid or has expired. Please request a new one." },
      { status: 400 }
    );
  }

  // Mark token as used (single-use)
  await prisma.adminMfaEmailToken.update({
    where: { id: emailToken.id },
    data: { usedAt: new Date() },
  });

  // Emit email-confirmed audit event
  await prisma.adminAuditLog.create({
    data: {
      adminId: admin.id,
      adminEmail: admin.user.email,
      action: "ADMIN_MFA_EMAIL_CONFIRMED",
      entityType: "Admin",
      entityId: admin.id,
    },
  }).catch(err => console.error("[setup-mfa] audit log error:", err));

  // Generate TOTP secret + QR code — show only after email confirmation
  const secret = generateTotpSecret();
  const qrCode = await getTotpQrCode(secret, admin.user.email);
  const { plain: codes, hashed: pendingHashes } = await generateRecoveryCodes();

  // Store hashed codes so the POST confirmation step can verify them.
  // Without this, freshAdmin.pendingRecoveryCodes is empty and POST returns
  // "Setup session expired", blocking all first-time MFA enrollment.
  // This mirrors the pattern used in security/mfa/route.ts.
  await prisma.admin.update({
    where: { id: admin.id },
    data: { pendingRecoveryCodes: pendingHashes },
  });

  const res = NextResponse.json({
    success: true,
    data: {
      secret,   // Show once for manual entry
      qrCode,   // Data URI for QR display
      recoveryCodes: codes, // Show once — user must save
      email: admin.user.email,
    },
  });
  // Plaintext recovery codes & TOTP secret must never be cached anywhere.
  res.headers.set("Cache-Control", "no-store, no-cache, must-revalidate, private");
  res.headers.set("Pragma", "no-cache");
  return res;
}

// POST — confirm TOTP setup + save secret + issue full session
export async function POST(request: NextRequest) {
  const cookieStore = await cookies();
  const preMfaToken = cookieStore.get(ADMIN_PREMFA_COOKIE)?.value;
  if (!preMfaToken) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const payload = await verifyPreMfaToken(preMfaToken);
  if (!payload) return NextResponse.json({ error: "Invalid session" }, { status: 401 });

  const { secret, code } = await request.json() as {
    secret: string;
    code: string;
  };

  const admin = await prisma.admin.findUnique({
    where: { id: payload.adminId },
    include: { user: true },
  });
  if (!admin) return NextResponse.json({ error: "Admin not found" }, { status: 404 });

  // Rate limit: reject if admin is currently locked out
  try {
    await checkMfaRateLimit(admin.id);
  } catch {
    return NextResponse.json({ error: "Invalid or expired code." }, { status: 401 });
  }

  // Verify TOTP code before saving
  if (!verifyTotpCode(secret, code)) {
    await recordMfaFailure(admin.id, admin.user.email);
    return NextResponse.json({ error: "Invalid or expired code." }, { status: 401 });
  }

  const freshAdmin = await prisma.admin.findUniqueOrThrow({
    where: { id: payload.adminId },
  });

  if (!freshAdmin.pendingRecoveryCodes || freshAdmin.pendingRecoveryCodes.length === 0) {
    return NextResponse.json(
      { error: "Setup session expired. Please start MFA setup again." },
      { status: 400 }
    );
  }

  // Activate server-generated pending recovery codes; never trust client-supplied hashes.
  await prisma.admin.update({
    where: { id: payload.adminId },
    data: {
      totpSecret: encryptTotpSecret(secret), // AES-256-GCM encrypted at rest
      totpEnabled: true,
      recoveryCodes: freshAdmin.pendingRecoveryCodes,
      pendingRecoveryCodes: [],
      failedMfaAttempts: 0,
      mfaLockedUntil: null,
    },
  });

  // Emit enrollment completed audit event
  await prisma.adminAuditLog.create({
    data: {
      adminId: admin.id,
      adminEmail: admin.user.email,
      action: "ADMIN_MFA_ENROLLED",
      entityType: "Admin",
      entityId: admin.id,
      metadata: { recoveryCodeCount: freshAdmin.pendingRecoveryCodes.length },
    },
  }).catch(err => console.error("[setup-mfa] audit log error:", err));

  // Issue full admin session
  const adminToken = await signAdminJwt({
    adminId: admin.id,
    role: admin.role as AdminRole,
    email: admin.user.email,
    mfaVerified: true,
  });

  const res = NextResponse.json({ success: true });
  res.cookies.delete(ADMIN_PREMFA_COOKIE);
  res.cookies.set(ADMIN_TOKEN_COOKIE, adminToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 86400,
    path: "/",
  });

  return res;
}
