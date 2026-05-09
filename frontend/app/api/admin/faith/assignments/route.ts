import { NextRequest } from "next/server";
import { getAdminFromRequest, adminSuccess, adminError } from "@/lib/auth/admin-api";
import { assignVerseToPage } from "@/lib/services/faith/faith.service";
import { prisma } from "@/lib/prisma";

export async function GET(request: NextRequest) {
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);
  const assignments = await prisma.versePageAssignment.findMany({
    where: { isActive: true }, include: { verse: true }, orderBy: { pageKey: "asc" },
  });
  return adminSuccess({ assignments });
}

export async function POST(request: NextRequest) {
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);
  const { pageKey, verseId, isOverride } = await request.json() as { pageKey: string; verseId: string; isOverride?: boolean };
  if (!pageKey || !verseId) return adminError("VALIDATION_ERROR", "pageKey and verseId required", 400);
  const assignment = await assignVerseToPage(pageKey, verseId, isOverride);
  return adminSuccess({ assignment }, 201);
}
