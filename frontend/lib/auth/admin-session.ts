import { createServerSupabaseClient } from "@/lib/supabase";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { verifyAdminJwt, ADMIN_TOKEN_COOKIE, ADMIN_ROLE_LABELS, type AdminJwtPayload } from "@/lib/admin-auth";
import { AdminRole } from "@prisma/client";

// Get current admin from httpOnly cookie — NEVER touches Supabase auth
export async function getAuthenticatedAdmin(): Promise<AdminJwtPayload | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(ADMIN_TOKEN_COOKIE)?.value;
  if (!token) return null;

  const payload = await verifyAdminJwt(token);
  if (!payload?.mfaVerified) return null; // MFA must be completed — no skip

  return payload;
}

// Require full admin auth (credentials + MFA) — no skip path for any role
export async function requireAdmin(): Promise<AdminJwtPayload> {
  const admin = await getAuthenticatedAdmin();
  if (!admin) redirect("/admin/auth/signin");
  return admin;
}

// Require specific admin role
export async function requireAdminRole(roles: AdminRole[]): Promise<AdminJwtPayload> {
  const admin = await requireAdmin();
  if (!roles.includes(admin.role)) {
    redirect("/admin/dashboard"); // Redirect to dashboard — not an error
  }
  return admin;
}

// Get full admin db record
export async function getAdminRecord(adminId: string) {
  return prisma.admin.findUnique({
    where: { id: adminId },
    include: { user: true },
  });
}
