import { logger } from "@/lib/logger";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { signPreMfaToken, ADMIN_PREMFA_COOKIE } from "@/lib/admin-auth";
import { compare } from "bcryptjs";

// POST /api/admin/auth/signin — admin credentials check
// Uses SEPARATE admin auth — never Supabase buyer/dealer system
export async function POST(request: NextRequest) {
  try {
    let email: string, password: string;
    try {
      ({ email, password } = await request.json() as { email: string; password: string });
    } catch {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }

    if (!email || !password) {
      // "Incorrect email or password" — never distinguish which
      return NextResponse.json({ error: "Incorrect email or password" }, { status: 401 });
    }

    const user = await prisma.user.findFirst({
      where: { email: email.toLowerCase(), role: { in: ["SUPER_ADMIN", "OPERATIONS_ADMIN", "COMPLIANCE_ADMIN", "FINANCE_ADMIN", "SUPPORT_ADMIN"] } },
      include: { admin: true },
    });

    if (!user?.admin) {
      return NextResponse.json({ error: "Incorrect email or password" }, { status: 401 });
    }

    // Password verification against bcrypt hash stored in Admin.passwordHash
    const storedHash = user.admin.passwordHash;
    if (!storedHash) {
      // No password set — admin account exists but needs setup
      return NextResponse.json({ error: "Incorrect email or password" }, { status: 401 });
    }

    const valid = await compare(password, storedHash);
    if (!valid) {
      return NextResponse.json({ error: "Incorrect email or password" }, { status: 401 });
    }

    // MFA is REQUIRED — issue pre-MFA token, redirect to verify-mfa or setup-mfa
    const preMfaToken = await signPreMfaToken(user.admin.id);

    // Emit enrollment-started audit event when MFA is not yet enrolled (non-blocking)
    if (!user.admin.totpEnabled) {
      void prisma.adminAuditLog.create({
        data: {
          adminId: user.admin.id,
          adminEmail: user.email,
          action: "ADMIN_MFA_ENROLLMENT_STARTED",
          entityType: "Admin",
          entityId: user.admin.id,
          metadata: { reason: "MFA not enrolled — redirecting to setup" },
        },
      }).catch(err => logger.error("[signin] audit log error:", err));
    }

    const redirectPath = user.admin.totpEnabled
      ? "/admin/auth/verify-mfa"
      : "/admin/auth/setup-mfa";

    const res = NextResponse.json({ redirect: redirectPath });

    res.cookies.set(ADMIN_PREMFA_COOKIE, preMfaToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 600, // 10 minutes to complete MFA
      path: "/",
    });

    return res;
  } catch (err) {
    logger.error("[signin] unexpected error:", err);
    return NextResponse.json({ error: "An unexpected error occurred. Please try again." }, { status: 500 });
  }
}
