// Shared admin API auth helper
import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifyAdminJwt, ADMIN_TOKEN_COOKIE } from "@/lib/admin-auth";
import type { AdminJwtPayload } from "@/lib/admin-auth";
import type { AdminRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export function adminSuccess<T>(data: T, status = 200) {
  return NextResponse.json({ success: true, data }, { status });
}
export function adminError(code: string, message: string, status = 400) {
  return NextResponse.json({ error: { code, message }, correlationId: crypto.randomUUID() }, { status });
}
export async function getAdminFromRequest(request: NextRequest): Promise<AdminJwtPayload | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(ADMIN_TOKEN_COOKIE)?.value;
  if (!token) return null;
  const payload = await verifyAdminJwt(token);
  if (!payload?.mfaVerified) return null;
  return payload;
}

/**
 * Extracts the real client IP from standard proxy headers.
 * Returns the first non-empty IP from x-forwarded-for, x-real-ip, or null.
 */
export function getClientIp(request: NextRequest): string | null {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]?.trim() ?? null;
  return request.headers.get("x-real-ip") ?? null;
}

/**
 * Creates an AdminAuditLog entry, automatically capturing the client IP.
 */
export async function createAuditLog(
  admin: AdminJwtPayload,
  request: NextRequest,
  params: {
    action: string;
    entityType: string;
    entityId: string;
    reason?: string;
    metadata?: Record<string, unknown>;
    previousState?: Record<string, unknown> | null;
    newState?: Record<string, unknown> | null;
  }
) {
  type AuditLogJson = Parameters<typeof prisma.adminAuditLog.create>[0]["data"]["metadata"];
  return prisma.adminAuditLog.create({
    data: {
      adminId: admin.adminId,
      adminEmail: admin.email,
      action: params.action,
      entityType: params.entityType,
      entityId: params.entityId,
      ipAddress: getClientIp(request),
      reason: params.reason,
      metadata: params.metadata ? (params.metadata as AuditLogJson) : undefined,
      previousState: params.previousState ? (params.previousState as AuditLogJson) : undefined,
      newState: params.newState ? (params.newState as AuditLogJson) : undefined,
    },
  });
}

/**
 * Returns the admin payload if the admin's role is in `allowedRoles`.
 * Returns null otherwise.
 * Use this instead of getAdminFromRequest() for role-sensitive routes.
 */
export async function getAdminWithRole(
  request: NextRequest,
  allowedRoles: AdminRole[]
): Promise<AdminJwtPayload | null> {
  const admin = await getAdminFromRequest(request);
  if (!admin) return null;
  if (!allowedRoles.includes(admin.role as AdminRole)) return null;
  return admin;
}

/**
 * All roles except SUPPORT_ADMIN — for routes that should be blocked from
 * read-only support staff but accessible to all operational admins.
 */
export const OPERATIONAL_ROLES: AdminRole[] = [
  "SUPER_ADMIN",
  "OPERATIONS_ADMIN",
  "COMPLIANCE_ADMIN",
  "FINANCE_ADMIN",
];
