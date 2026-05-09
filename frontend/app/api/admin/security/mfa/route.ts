import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { adminSuccess, adminError, getAdminFromRequest } from "@/lib/auth/admin-api";
import {
  generateTotpSecret,
  getTotpQrCode,
  generateRecoveryCodes,
  verifyTotpCode,
  encryptTotpSecret,
} from "@/lib/admin-auth";

export async function GET(request: NextRequest) {
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Authentication required.", 401);

  const record = await prisma.admin.findUnique({ where: { id: admin.adminId } });
  if (!record) return adminError("NOT_FOUND", "Admin record not found.", 404);

  return adminSuccess({
    totpEnabled: record.totpEnabled,
    codesRemaining: record.recoveryCodes.length,
    lastRecoveryCodeUsedAt: record.lastRecoveryCodeUsedAt,
  });
}

export async function POST(request: NextRequest) {
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Authentication required.", 401);

  const body = await request.json() as {
    action: string;
    secret?: string;
    code?: string;
  };
  const { action } = body;

  if (action === "start-reset") {
    const secret = generateTotpSecret();
    const qrCode = await getTotpQrCode(secret, admin.email);
    const { plain: recoveryCodes } = await generateRecoveryCodes();

    await prisma.adminAuditLog.create({
      data: {
        adminId: admin.adminId,
        adminEmail: admin.email,
        action: "ADMIN_MFA_RESET_STARTED",
        entityType: "Admin",
        entityId: admin.adminId,
      },
    });

    // DO NOT save to DB yet — only save after verification
    return adminSuccess({ secret, qrCode, recoveryCodes });
  }

  if (action === "complete-reset") {
    const { secret, code } = body;
    if (!secret || !code) {
      return adminError("INVALID_BODY", "Missing required fields.", 400);
    }

    if (!verifyTotpCode(secret, code)) {
      await prisma.adminAuditLog.create({
        data: {
          adminId: admin.adminId,
          adminEmail: admin.email,
          action: "ADMIN_MFA_RESET_FAILED",
          entityType: "Admin",
          entityId: admin.adminId,
        },
      });
      return adminError("INVALID_CODE", "Invalid TOTP code. Please try again.", 400);
    }

    const freshAdmin = await prisma.admin.findUniqueOrThrow({ where: { id: admin.adminId } });
    if (!freshAdmin.pendingRecoveryCodes || freshAdmin.pendingRecoveryCodes.length === 0) {
      return adminError("SETUP_EXPIRED", "Setup session expired. Please start MFA reset again.", 400);
    }

    await prisma.admin.update({
      where: { id: admin.adminId },
      data: {
        totpSecret: encryptTotpSecret(secret),
        totpEnabled: true,
        recoveryCodes: freshAdmin.pendingRecoveryCodes,
        pendingRecoveryCodes: [],
        lastRecoveryCodeUsedAt: null,
      },
    });

    await prisma.adminAuditLog.createMany({
      data: [
        {
          adminId: admin.adminId,
          adminEmail: admin.email,
          action: "ADMIN_MFA_RESET_COMPLETED",
          entityType: "Admin",
          entityId: admin.adminId,
        },
        {
          adminId: admin.adminId,
          adminEmail: admin.email,
          action: "ADMIN_MFA_BACKUP_CODES_REGENERATED",
          entityType: "Admin",
          entityId: admin.adminId,
          metadata: { count: freshAdmin.pendingRecoveryCodes.length },
        },
      ],
    });

    return adminSuccess({ success: true });
  }

  if (action === "generate-codes") {
    // Generate bcrypt-hashed recovery codes server-side (used by the regen flow).
    // Store hashes pending confirmation; return ONLY plaintext for one-time display.
    const { plain: recoveryCodes, hashed: pendingHashes } = await generateRecoveryCodes();

    await prisma.admin.update({
      where: { id: admin.adminId },
      data: { pendingRecoveryCodes: pendingHashes },
    });

    return adminSuccess({ recoveryCodes });
  }

  if (action === "regen-codes") {
    const freshAdmin = await prisma.admin.findUniqueOrThrow({ where: { id: admin.adminId } });
    if (!freshAdmin.pendingRecoveryCodes || freshAdmin.pendingRecoveryCodes.length === 0) {
      return adminError("SETUP_EXPIRED", "Recovery code generation expired. Please generate codes again.", 400);
    }

    await prisma.admin.update({
      where: { id: admin.adminId },
      data: {
        recoveryCodes: freshAdmin.pendingRecoveryCodes,
        pendingRecoveryCodes: [],
        lastRecoveryCodeUsedAt: null,
      },
    });

    await prisma.adminAuditLog.create({
      data: {
        adminId: admin.adminId,
        adminEmail: admin.email,
        action: "ADMIN_MFA_BACKUP_CODES_REGENERATED",
        entityType: "Admin",
        entityId: admin.adminId,
        metadata: { count: freshAdmin.pendingRecoveryCodes.length },
      },
    });

    return adminSuccess({ success: true });
  }

  return adminError("INVALID_ACTION", "Unknown action.", 400);
}
