// POST /api/admin/admins — invite a new admin account (SUPER_ADMIN only).
// Creates the User + Admin records with a temporary password and MFA disabled,
// so the invitee must complete MFA setup before their first authenticated
// session. The invite email carries the temp password and the sign-in link.
import { NextRequest } from "next/server";
import { getAdminWithRole, adminSuccess, adminError } from "@/lib/auth/admin-api";
import { prisma } from "@/lib/prisma";
import { AdminRole, UserRole } from "@prisma/client";
import { hash } from "bcryptjs";
import crypto from "crypto";
import { sendCustomAdminEmail } from "@/lib/services/email/resend.service";

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL ?? "https://autolenis.com").trim();
const ADMIN_ROLES: AdminRole[] = ["SUPER_ADMIN", "OPERATIONS_ADMIN", "COMPLIANCE_ADMIN", "FINANCE_ADMIN", "SUPPORT_ADMIN"];

function generateTempPassword(): string {
  // url-safe, ~22 chars of entropy
  return crypto.randomBytes(16).toString("base64url");
}

export async function POST(request: NextRequest) {
  const admin = await getAdminWithRole(request, ["SUPER_ADMIN"]);
  if (!admin) return adminError("FORBIDDEN", "Only a SUPER_ADMIN can create admin accounts", 403);

  const { email, role } = await request.json().catch(() => ({})) as { email?: string; role?: string };
  const normalizedEmail = (email ?? "").toLowerCase().trim();
  if (!normalizedEmail || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normalizedEmail)) {
    return adminError("INVALID_EMAIL", "A valid email is required", 400);
  }
  if (!role || !ADMIN_ROLES.includes(role as AdminRole)) {
    return adminError("INVALID_ROLE", `Role must be one of: ${ADMIN_ROLES.join(", ")}`, 400);
  }

  const existing = await prisma.user.findUnique({ where: { email: normalizedEmail } });
  if (existing) return adminError("EMAIL_EXISTS", "An account with this email already exists", 409);

  const tempPassword = generateTempPassword();
  const passwordHash = await hash(tempPassword, 12);

  const newAdmin = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        // Admins authenticate via the custom Admin.passwordHash + TOTP system,
        // not Supabase — supabaseId is a required unique column so we mint a
        // namespaced placeholder rather than provisioning an unused auth user.
        supabaseId: `admin-${crypto.randomUUID()}`,
        email: normalizedEmail,
        role: role as UserRole,
        requiresPasswordChange: true,
      },
    });
    const created = await tx.admin.create({
      data: { userId: user.id, role: role as AdminRole, passwordHash, totpEnabled: false },
    });
    await tx.adminAuditLog.create({
      data: {
        adminId: admin.adminId,
        adminEmail: admin.email,
        action: "ADMIN_ACCOUNT_CREATED",
        entityType: "Admin",
        entityId: created.id,
        reason: `Invited new ${role} admin: ${normalizedEmail}`,
        metadata: { email: normalizedEmail, role },
      },
    });
    return created;
  });

  const signinUrl = `${APP_URL}/admin/auth/signin`;
  await sendCustomAdminEmail({
    to: normalizedEmail,
    subject: "Your AutoLenis admin account",
    body: `
      <h2 style="margin:0 0 16px">You've been invited as an AutoLenis ${role.replace(/_/g, " ")}</h2>
      <p>An admin account has been created for you. Sign in with the temporary password below, then you'll be required to set up multi-factor authentication before you can access the console.</p>
      <p style="margin:16px 0;padding:12px 16px;background:#f1f5f9;border-radius:8px">
        <strong>Email:</strong> ${normalizedEmail}<br/>
        <strong>Temporary password:</strong> <code>${tempPassword}</code>
      </p>
      <p><a href="${signinUrl}" style="display:inline-block;padding:10px 20px;background:#0B5FD1;color:#fff;border-radius:8px;text-decoration:none">Sign in to AutoLenis Admin</a></p>
      <p style="color:#64748b;font-size:13px">For security, change your password and complete MFA setup on first sign-in.</p>
    `,
    idempotencyKey: `admin-invite-${newAdmin.id}`,
  }).catch(err => console.error("[admins] invite email failed:", err));

  return adminSuccess({ adminId: newAdmin.id, email: normalizedEmail, role }, 201);
}
