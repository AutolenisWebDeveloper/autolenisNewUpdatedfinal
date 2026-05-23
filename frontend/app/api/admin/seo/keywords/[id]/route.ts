import { NextRequest } from "next/server";
import { getAdminWithRole, adminSuccess, adminError, OPERATIONAL_ROLES, createAuditLog } from "@/lib/auth/admin-api";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

interface Props {
  params: Promise<{ id: string }>;
}

const patchSchema = z.object({
  searchVolume: z.number().int().min(0).optional(),
  difficulty: z.number().int().min(0).max(100).optional(),
  targetPages: z.array(z.string()).optional(),
  isActive: z.boolean().optional(),
});

export async function PATCH(request: NextRequest, { params }: Props) {
  const { id } = await params;
  const admin = await getAdminWithRole(request, OPERATIONAL_ROLES);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);

  const body = await request.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return adminError("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Invalid input", 400);
  }

  const existing = await prisma.seoKeyword.findUnique({ where: { id } });
  if (!existing) return adminError("NOT_FOUND", "Keyword not found", 404);

  const keyword = await prisma.seoKeyword.update({
    where: { id },
    data: parsed.data,
  });
  await createAuditLog(admin, request, {
    action: "SEO_KEYWORD_UPDATED",
    entityType: "SeoKeyword",
    entityId: id,
    previousState: existing as unknown as Record<string, unknown>,
    newState: keyword as unknown as Record<string, unknown>,
  });
  return adminSuccess({ keyword });
}

export async function DELETE(request: NextRequest, { params }: Props) {
  const { id } = await params;
  const admin = await getAdminWithRole(request, OPERATIONAL_ROLES);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);

  const existing = await prisma.seoKeyword.findUnique({ where: { id } });
  if (!existing) return adminError("NOT_FOUND", "Keyword not found", 404);

  // Soft-delete: set isActive=false to preserve history
  const keyword = await prisma.seoKeyword.update({
    where: { id },
    data: { isActive: false },
  });
  await createAuditLog(admin, request, {
    action: "SEO_KEYWORD_DEACTIVATED",
    entityType: "SeoKeyword",
    entityId: id,
    metadata: { keyword: existing.keyword },
  });
  return adminSuccess({ keyword });
}
