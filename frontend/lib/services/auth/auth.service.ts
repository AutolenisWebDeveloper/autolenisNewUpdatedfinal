// lib/services/auth/auth.service.ts
import { prisma } from "@/lib/prisma";
import { UserRole } from "@prisma/client";

export async function ensurePrismaUser(supabaseId: string, email: string, role: UserRole = UserRole.BUYER) {
  return prisma.user.upsert({
    where: { supabaseId },
    create: {
      supabaseId, email: email.toLowerCase(), role,
      ...(role === UserRole.BUYER ? { buyer: { create: { firstName: email.split("@")[0], lastName: "", onboardingComplete: false } } } : {}),
    },
    update: {},
    include: { buyer: true, dealer: true, affiliate: true },
  });
}

export async function recordLoginAttempt(email: string, success: boolean, ipAddress?: string, adminId?: string, failReason?: string) {
  await prisma.adminLoginLog.create({ data: { adminId, email, success, ipAddress, failReason } }).catch(() => {});
}

export async function createAdminSession(adminId: string, token: string, ipAddress?: string, userAgent?: string) {
  const expiresAt = new Date(Date.now() + 24 * 3600000);
  return prisma.adminSession.create({ data: { adminId, token, ipAddress, userAgent, expiresAt } });
}

export async function invalidateAdminSession(token: string) {
  await prisma.adminSession.deleteMany({ where: { token } });
}

export async function cleanExpiredAdminSessions() {
  const { count } = await prisma.adminSession.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  return count;
}
