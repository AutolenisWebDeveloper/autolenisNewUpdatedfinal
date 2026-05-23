import { NextRequest } from "next/server";
import { getAdminFromRequest, adminSuccess, adminError, createAuditLog } from "@/lib/auth/admin-api";
import { prisma } from "@/lib/prisma";

interface Props { params: Promise<{ id: string }> }

export async function PATCH(request: NextRequest, { params }: Props) {
  const { id } = await params;
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);
  const { approved } = await request.json() as { approved: boolean };
  const updated = await prisma.testimonial.update({
    where: { id },
    data: { isApproved: approved, isPublished: approved, reviewedAt: new Date(), reviewedBy: admin.adminId },
  });
  await createAuditLog(admin, request, {
    action: approved ? "TESTIMONIAL_APPROVED" : "TESTIMONIAL_UNAPPROVED",
    entityType: "Testimonial",
    entityId: id,
    metadata: { approved },
  });
  return adminSuccess({ testimonial: updated });
}
