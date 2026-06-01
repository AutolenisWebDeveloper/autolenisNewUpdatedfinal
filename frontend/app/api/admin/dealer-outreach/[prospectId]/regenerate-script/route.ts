// POST /api/admin/dealer-outreach/[prospectId]/regenerate-script
// Re-drafts the founder phone script for a single prospect.
import { NextRequest } from "next/server";
import { getAdminFromRequest, adminSuccess, adminError } from "@/lib/auth/admin-api";
import { prisma } from "@/lib/prisma";
import { draftAndSaveScript } from "@/lib/services/dealer-recruitment/phone-script-drafter.service";

export const dynamic = "force-dynamic";

interface Params {
  params: Promise<{ prospectId: string }>;
}

export async function POST(request: NextRequest, { params }: Params) {
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);

  const { prospectId } = await params;

  const existing = await prisma.dealerProspect.findUnique({
    where: { id: prospectId },
    select: { id: true },
  });
  if (!existing) return adminError("NOT_FOUND", "Prospect not found", 404);

  try {
    const ok = await draftAndSaveScript(prospectId);
    if (!ok) {
      return adminError("DRAFT_FAILED", "Script generation failed", 502);
    }
    const prospect = await prisma.dealerProspect.findUnique({
      where: { id: prospectId },
      select: { outreachScript: true, scriptDraftedAt: true, scriptAttempts: true, status: true },
    });
    return adminSuccess({ success: true, script: prospect?.outreachScript ?? null, prospect });
  } catch (err) {
    return adminError(
      "DRAFT_FAILED",
      err instanceof Error ? err.message : "Script generation failed",
      500,
    );
  }
}
