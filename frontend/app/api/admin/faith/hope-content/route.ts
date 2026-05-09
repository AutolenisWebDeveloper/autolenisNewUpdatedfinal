import { NextRequest } from "next/server";
import { getAdminFromRequest, adminSuccess, adminError } from "@/lib/auth/admin-api";
import { getHopeContent } from "@/lib/services/faith/faith.service";
import { prisma } from "@/lib/prisma";

export async function GET(request: NextRequest) {
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);
  const content = await getHopeContent();
  return adminSuccess({ content });
}

export async function PATCH(request: NextRequest) {
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);
  const { section, body, title } = await request.json() as { section: string; body: string; title?: string };
  if (!section || !body) return adminError("VALIDATION_ERROR", "section and body required", 400);
  const updated = await prisma.hopePageContent.upsert({
    where: { section },
    create: { section, body, title, isActive: true, order: 0 },
    update: { body, title },
  });
  return adminSuccess({ updated });
}
