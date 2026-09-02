import { NextRequest, NextResponse } from "next/server";
import { authorizeCronRequest } from "@/lib/security/cron-auth";
import { prisma } from "@/lib/prisma";
import { sendDealerInventorySyncFailureEmail } from "@/lib/services/email/resend.service";
import { withCronRun } from "@/lib/services/monitoring/cron-monitor.service";
import { staleSweepWhere, freshnessCutoff } from "@/lib/services/inventory/inventory-eligibility";

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL ?? "https://autolenis.com").trim();

// Cron: /api/cron/inventory-stale-sweep — Schedule: */30 * * * * (every 30 min)
// ENH-5: Deactivate stale Lane 2/3 vehicles not seen in 48h
// Registered in vercel.json ✓
//
// 2026-09-02 — WHY THIS CRON DEACTIVATED NOTHING FOR FOUR MONTHS.
//
// It ran every 30 minutes, COMPLETED, error null, `deactivated: 0`, while 95 rows
// sat active with last_seen_at up to four months old. The cron was healthy. Its
// WHERE clause was wrong:
//
//     { lastSeenAt: { lt: cutoff }, lane: { not: "LANE_1" }, isActive: true }
//
//   • `lane: { not: LANE_1 }` was meant as "never auto-deactivate dealer-verified
//     inventory", but `lane` is a mutable column several write paths set without
//     ever setting `dealerId`. All 95 immortal rows were LANE_1 with
//     dealer_id NULL — aggregator listings holding a dealer exemption with no
//     dealer behind them. The predicate could not reach them, at any age.
//   • `lastSeenAt < cutoff` is UNKNOWN for NULL in SQL, so the one row that was
//     never stamped was unreachable in every lane as well.
//   • The dealer-notification snapshot and the updateMany each carried their own
//     hand-written copy of the predicate, free to drift.
//
// All three are fixed by taking the predicate from ONE place —
// `staleSweepWhere()` in lib/services/inventory/inventory-eligibility.ts, which
// the orchestrator's full-sync sweep now also uses. The exemption is expressed as
// what it always meant: dealer-managed (LANE_1 *with* a dealer link) and
// admin-curated (added_by_admin_id) rows are protected; everything else ages out.
//
// `?dryRun=1` reports exactly what would be deactivated and writes nothing —
// the first real run after this ships will deactivate ~95 rows.

export async function GET(request: NextRequest) {
  const cronAuth = authorizeCronRequest(request);
  if (cronAuth) return cronAuth;

  const dryRun = request.nextUrl.searchParams.get("dryRun") === "1";

  const run = await withCronRun("inventory-stale-sweep", async () => {
  const now = new Date();
  const cutoff = freshnessCutoff(now);
  // ONE predicate, shared with the orchestrator's full-sync sweep.
  const where = staleSweepWhere(now);

  let deactivated: number;
  if (dryRun) {
    // Count only — no write. Lets an operator see the blast radius before the
    // scheduled run applies it. The FIRST real run after this ships deactivates
    // ~95 rows (the LANE_1/dealer_id NULL cohort described above).
    deactivated = await prisma.inventoryItem.count({ where });
  } else {
    ({ count: deactivated } = await prisma.inventoryItem.updateMany({
      where,
      data: { isActive: false },
    }));
  }

  // NO DEALER "we removed your listings" EMAIL ANY MORE, and it is not an omission.
  //
  // This cron used to snapshot the about-to-be-deactivated rows that belonged to a
  // dealer and email each dealer the list. Under the corrected exemption a row with
  // a dealerId is NEVER swept, so that snapshot — `staleSweepWhere() AND dealerId IS
  // NOT NULL` — is `dealer_id IS NULL AND dealer_id IS NOT NULL`: provably empty. A
  // query that cannot return a row, feeding an email that cannot send, is worse than
  // no code at all, so it is gone rather than left looking live.
  //
  // The behaviour change it encodes: AutoLenis no longer auto-deactivates dealer
  // inventory. Dealers archive their own listings (DELETE /api/dealer/inventory/[id]),
  // and a dealer listing nobody touches is now surfaced by the freshness signal
  // instead — flagged stale at 7 days and dropped from shortlist eligibility at 30
  // (lib/services/inventory/inventory-eligibility.ts). The feed-gone-dark
  // notification below is a different signal and still fires.

  // Detect dealers whose inventory has gone fully stale (no fresh items in the
  // window) and notify them — likely indicates a broken feed/sync.
  const activeDealersWithFeeds = await prisma.dealer.findMany({
    where: { status: "ACTIVE", feedConfig: { isNot: null } },
    include: {
      user: { select: { email: true } },
      feedConfig: true,
    },
  }).catch(() => [] as Array<{
    id: string;
    dealershipName: string;
    user: { email: string } | null;
    feedConfig: { lastSyncAt: Date | null } | null;
  }>);
  const failureCutoff = new Date(now.getTime() - 24 * 3600000);
  let feedFailureEmails = 0;
  let feedFailureSuppressed = 0;
  for (const dealer of activeDealersWithFeeds) {
    if (!dealer.user?.email) continue;
    const freshCount = await prisma.inventoryItem.count({
      where: { dealerId: dealer.id, lastSeenAt: { gte: failureCutoff } },
    }).catch(() => 1);
    if (freshCount > 0) continue;
    // FS-G fix (Batch 1): only claim a "feed sync failure" when a feed sync was
    // actually ATTEMPTED (feedConfig.lastSyncAt set). The dealer-feed puller is not
    // wired yet, so lastSyncAt is null — blaming the dealer for a sync the platform
    // never runs is a false signal. Suppress it and account for the suppression.
    if (!dealer.feedConfig?.lastSyncAt) {
      feedFailureSuppressed++;
      continue;
    }
    if (dryRun) { feedFailureSuppressed++; continue; }
    const lastSync = dealer.feedConfig.lastSyncAt.toISOString().slice(0, 10);
    await sendDealerInventorySyncFailureEmail({
      to: dealer.user.email,
      contactName: dealer.dealershipName,
      lastSuccessfulSync: lastSync,
      errorCategory: "FEED_NO_DATA",
      feedSetupUrl: `${APP_URL}/dealer/inventory/feed`,
    }).catch(() => {});
    feedFailureEmails++;
  }

  return { deactivated, dryRun, cutoff, feedFailureEmails, feedFailureSuppressed };
  });
  if (!run.ok) return NextResponse.json({ success: false, error: "inventory-stale-sweep_failed" }, { status: 500 });

  return NextResponse.json({ success: true, data: run.result });
}
