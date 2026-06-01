// POST /api/admin/dealer-outreach/backfill — draft missing phone scripts.
// Finds DISCOVERED prospects with no outreachScript (e.g. ones that failed
// during initial discovery due to Groq rate limits) and re-drafts them.
// Optional ?buyerOppId= filter. Capped at 20 per call to stay within the
// serverless function timeout, with a 12s gap between drafts to respect the
// free-tier TPM budget.
import { NextRequest } from "next/server";
import { getAdminFromRequest, adminSuccess, adminError } from "@/lib/auth/admin-api";
import { prisma } from "@/lib/prisma";
import { draftAndSaveScript } from "@/lib/services/dealer-recruitment/phone-script-drafter.service";
import { type Prisma } from "@prisma/client";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// 20 prospects × (draft time + 12s gap) can run several minutes on free tier.
export const maxDuration = 300;

const MAX_PROSPECTS = 20;
const INTER_DRAFT_DELAY_MS = 12000;

interface BackfillResult {
  prospectId: string;
  name: string;
  succeeded: boolean;
}

export async function POST(request: NextRequest) {
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);

  const { searchParams } = new URL(request.url);
  const buyerOppId = searchParams.get("buyerOppId");

  const where: Prisma.DealerProspectWhereInput = {
    status: "DISCOVERED",
    outreachScript: null,
  };
  if (buyerOppId) {
    where.buyerOppId = buyerOppId;
  }

  try {
    const prospects = await prisma.dealerProspect.findMany({
      where,
      select: { id: true, name: true },
      orderBy: { createdAt: "asc" },
      take: MAX_PROSPECTS,
    });

    const results: BackfillResult[] = [];
    let succeeded = 0;
    let failed = 0;

    for (let i = 0; i < prospects.length; i++) {
      const p = prospects[i];
      let ok = false;
      try {
        ok = await draftAndSaveScript(p.id);
      } catch (err) {
        console.error(`[backfill] Script drafting threw for ${p.id}:`, err);
        ok = false;
      }

      results.push({ prospectId: p.id, name: p.name, succeeded: ok });
      if (ok) succeeded++;
      else failed++;

      // Space out gpt-oss-120b calls to respect TPM; skip the wait after the
      // final prospect.
      if (i < prospects.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, INTER_DRAFT_DELAY_MS));
      }
    }

    return adminSuccess({
      attempted: prospects.length,
      succeeded,
      failed,
      results,
    });
  } catch (err) {
    return adminError(
      "BACKFILL_FAILED",
      err instanceof Error ? err.message : "Backfill failed",
      500,
    );
  }
}
