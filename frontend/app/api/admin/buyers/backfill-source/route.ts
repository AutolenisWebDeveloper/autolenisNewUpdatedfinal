// POST /api/admin/buyers/backfill-source — Phase 5.5 historical source backfill.
// Infers a source for BuyerOpportunity records whose source IS NULL using
// context clues, then writes the inferred value. NEVER overwrites an existing
// non-null source. Processes in batches of 50 to stay within the function
// timeout.
import { NextRequest } from "next/server";
import { getAdminFromRequest, adminSuccess, adminError } from "@/lib/auth/admin-api";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

const BATCH_SIZE = 50;

// Inference rules (applied in order). The strongest signal we have for legacy
// records is the voice intent classifier — if callReason is populated the lead
// came in through Zura's voice line. Everything else defaults to the historical
// majority channel: the buyer dashboard.
function inferSource(record: {
  callReason: string | null;
  conversationId: string | null;
}): { source: string; rule: string } {
  if (record.callReason) {
    return { source: "voice_dispatch:unknown", rule: "callReason" };
  }
  if (record.conversationId) {
    // A conversationId without a callReason implies a chat/widget session.
    return { source: "zura_widget", rule: "conversationId" };
  }
  return { source: "buyer_dashboard", rule: "default" };
}

export async function POST(request: NextRequest) {
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);

  try {
    let updated = 0;
    const ruleBreakdown: Record<string, number> = {};

    // Loop in batches until no null-source records remain (or we hit a safety
    // ceiling of 100 batches = 5000 records).
    for (let batch = 0; batch < 100; batch++) {
      const records = await prisma.buyerOpportunity.findMany({
        where: { source: null },
        select: { id: true, callReason: true, conversationId: true },
        take: BATCH_SIZE,
      });
      if (records.length === 0) break;

      for (const rec of records) {
        const { source, rule } = inferSource(rec);
        // Guard: only update while still null (defensive against concurrent writes).
        await prisma.buyerOpportunity.updateMany({
          where: { id: rec.id, source: null },
          data: { source },
        });
        updated++;
        ruleBreakdown[rule] = (ruleBreakdown[rule] ?? 0) + 1;
      }

      // If fewer than a full batch came back, we're done.
      if (records.length < BATCH_SIZE) break;
    }

    const remaining = await prisma.buyerOpportunity.count({ where: { source: null } });

    console.log(
      `[phase-5.5] backfill-source: updated=${updated}, remaining=${remaining}, rules=${JSON.stringify(ruleBreakdown)}`,
    );

    return adminSuccess({ updated, remaining, ruleBreakdown });
  } catch (err) {
    return adminError(
      "BACKFILL_SOURCE_FAILED",
      err instanceof Error ? err.message : "Source backfill failed",
      500,
    );
  }
}
