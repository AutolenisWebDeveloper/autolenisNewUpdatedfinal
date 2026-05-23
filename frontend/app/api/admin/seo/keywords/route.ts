import { NextRequest } from "next/server";
import { getAdminWithRole, adminSuccess, adminError, OPERATIONAL_ROLES, createAuditLog } from "@/lib/auth/admin-api";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

export async function GET(request: NextRequest) {
  const admin = await getAdminWithRole(request, OPERATIONAL_ROLES);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);

  const keywords = await prisma.seoKeyword.findMany({
    where: { isActive: true },
    orderBy: [{ searchVolume: "desc" }, { keyword: "asc" }],
  });
  return adminSuccess({ keywords, count: keywords.length });
}

const createSchema = z.object({
  keyword: z.string().min(2).max(200).transform(v => v.toLowerCase().trim()),
  searchVolume: z.number().int().min(0).optional(),
  difficulty: z.number().int().min(0).max(100).optional(),
  targetPages: z.array(z.string()).default([]),
});

export async function POST(request: NextRequest) {
  const admin = await getAdminWithRole(request, OPERATIONAL_ROLES);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);

  const body = await request.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return adminError("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Invalid input", 400);
  }

  const data = parsed.data;
  const keyword = await prisma.seoKeyword.upsert({
    where: { keyword: data.keyword },
    create: {
      keyword: data.keyword,
      searchVolume: data.searchVolume,
      difficulty: data.difficulty,
      targetPages: data.targetPages,
    },
    update: {
      searchVolume: data.searchVolume,
      difficulty: data.difficulty,
      targetPages: data.targetPages,
      isActive: true,
    },
  });

  await createAuditLog(admin, request, {
    action: "SEO_KEYWORD_UPSERTED",
    entityType: "SeoKeyword",
    entityId: keyword.id,
    metadata: { keyword: data.keyword, searchVolume: data.searchVolume, difficulty: data.difficulty },
  });

  return adminSuccess({ keyword }, 201);
}
