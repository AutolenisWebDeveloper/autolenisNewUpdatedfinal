// DELETE /api/admin/admins/[adminId] — deactivate an admin account (SUPER_ADMIN).
// Removes the admin's access by deleting the User (which cascades to the Admin
// record), freeing the email for re-invite. An admin cannot deactivate their
// own account. The action is audit-logged; audit history is preserved because
// AdminAuditLog stores the actor as denormalized strings, not a foreign key.
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
    // Deleting the user cascades to the Admin record (Admin.userId onDelete: Cascade).
    await tx.user.delete({ where: { id: target.user.id } });
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
