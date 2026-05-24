// DELETE /api/admin/admins/[adminId] — deactivate an admin account (SUPER_ADMIN).
// Soft-deactivates the admin (isActive = false) so audit history and the user
// record are preserved. A deactivated admin is rejected at session resolution.
// An admin cannot deactivate their own account. The action is audit-logged.
import { NextRequest } from "next/server";
import { getAdminWithRole, adminSuccess, adminError } from "@/lib/auth/admin-api";
import { prisma } from "@/lib/prisma";

interface Props { params: Promise<{ adminId: string }> }

export async function DELETE(request: NextRequest, { params }: Props) {
  const { adminId } = await params;
  const admin = await getAdminWithRole(request, ["SUPER_ADMIN"]);
  if (!admin) return adminError("FORBIDDEN", "Only a SUPER_ADMIN can deactivate admin accounts", 403);

  if (adminId === admin.adminId) {
    return adminError("CANNOT_DEACTIVATE_SELF", "You cannot deactivate your own account", 400);
  }

  const target = await prisma.admin.findUnique({
    where: { id: adminId },
    include: { user: { select: { id: true, email: true } } },
  });
  if (!target) return adminError("NOT_FOUND", "Admin not found", 404);

  await prisma.$transaction(async (tx) => {
    await tx.admin.update({
      where: { id: adminId },
      data: {
        isActive: false,
        deactivatedAt: new Date(),
      },
    });
    await tx.adminAuditLog.create({
      data: {
        adminId: admin.adminId,
        adminEmail: admin.email,
        action: "ADMIN_ACCOUNT_DEACTIVATED",
        entityType: "Admin",
        entityId: adminId,
        reason: `Deactivated admin: ${target.user.email}`,
        metadata: { email: target.user.email, role: target.role },
      },
    });
  });

  return adminSuccess({ deactivated: true, adminId });
}
