// contract-shield — batch contract scanning, plus Phase 8's two Stage 13/15 deadline sweeps.
//
// THE SWEEPS RIDE THIS CRON RATHER THAN GETTING THEIR OWN, which is what
// docs/transaction-flow/parity/jobs.table.md:62 prescribes and what the registry makes the
// cheap option: a new cron has to be added to BOTH vercel.json and CRON_STALENESS, and the
// registry test asserts completeness in both directions, so a schedule-only or
// registry-only addition fails CI. An hourly job that already walks contract state is the
// right carrier for two hourly deadline checks about contract state.
//
// EACH BUCKET IS INDEPENDENT. A failure in one must not stop the others — a contract that
// cannot be scanned is not a reason for an expired insurance policy to keep passing the
// release gate — so each is wrapped and reported separately in the run summary.
import { NextRequest, NextResponse } from "next/server";
import { authorizeCronRequest } from "@/lib/security/cron-auth";
import { prisma } from "@/lib/prisma";
import { scanContractVersion } from "@/lib/services/dealer/dealer-contract.service";
import { withCronRun } from "@/lib/services/monitoring/cron-monitor.service";
import { raiseException } from "@/lib/services/operations/queue-item.service";
import { logger } from "@/lib/logger";

export async function GET(request: NextRequest) {
  const cronAuth = authorizeCronRequest(request);
  if (cronAuth) return cronAuth;

  const run = await withCronRun("contract-shield", async () => {
  // Find contract versions awaiting a scan (or reset to UPLOADED after a
  // transient extraction failure on a prior pass).
  const pendingVersions = await prisma.contractVersion.findMany({
    where: { status: "UPLOADED" },
    select: { id: true },
    take: 20,
  });

  // Scan each against the REAL extracted PDF text. scanContractVersion converges
  // the status (PASS→APPROVED, WARNING/FAIL→REJECTED, error→retryable UPLOADED)
  // and fails closed — it never auto-approves a document it could not read.
  for (const cv of pendingVersions) {
    await scanContractVersion(cv.id).catch(() => {});
  }

  // ── Stage 13/14a: the contract request's 24-hour deadline ─────────────────
  // §26 "Contract overdue from dealer → Operations → Remind at deadline; escalate".
  // The dealership's own reminder was enqueued at request time with a future runAt, so
  // this is the ESCALATION half — the Operations row with an owner and a deadline. Keyed
  // per deal so a request that stays overdue for days raises one row, not twenty-four.
  let contractsOverdue = 0;
  try {
    const overdue = await prisma.documentRequest.findMany({
      where: { documentType: "SALES_CONTRACT", status: "PENDING", dueAt: { lt: new Date() } },
      select: { id: true, dealId: true, dueAt: true },
      take: 50,
    });

    // WHICH DEALERSHIP EACH OVERDUE REQUEST BELONGS TO.
    //
    // A separate read, because `DocumentRequest.dealId` is a plain column with no relation —
    // Prisma cannot join it. One batched query rather than one per row.
    //
    // It is needed because `listOpen` ANDs its filters and the dealer deal page queries by
    // dealer, so a row raised with only a deal reference is invisible to the one party who
    // can END this by uploading the contract. Found by the second independent review.
    const overdueDealIds = [...new Set(overdue.map((r) => r.dealId).filter((id): id is string => !!id))];
    const dealerByDeal = new Map<string, string | null>();
    if (overdueDealIds.length > 0) {
      const deals = await prisma.deal.findMany({
        where: { id: { in: overdueDealIds } },
        select: { id: true, dealerId: true, offer: { select: { dealerId: true } } },
      });
      for (const d of deals) dealerByDeal.set(d.id, d.dealerId ?? d.offer?.dealerId ?? null);
    }

    for (const request of overdue) {
      if (!request.dealId) continue;
      await raiseException({
        code: "CONTRACT_OVERDUE_FROM_DEALER",
        dealId: request.dealId,
        dealerId: dealerByDeal.get(request.dealId) ?? null,
        detail: `The contract package was due ${request.dueAt?.toISOString() ?? "earlier"} and has not arrived. The buyer cannot sign and the vehicle cannot be released until it does.`,
      }).catch(() => {});
      contractsOverdue += 1;
    }
  } catch (err) {
    logger.error("[contract-shield] overdue sweep failed", err);
  }

  // ── Stage 15: coverage that lapsed between review and release ─────────────
  // "Expiry before pickup blocks release until corrected." Swept rather than checked only
  // at the counter, because the gap between a verification and a pickup is exactly where a
  // policy lapses with nobody watching.
  let insuranceExpired = 0;
  try {
    const { sweepExpiredInsurance } = await import("@/lib/services/deal/insurance-review.service");
    const result = await sweepExpiredInsurance();
    insuranceExpired = result.expired;
  } catch (err) {
    logger.error("[contract-shield] insurance expiry sweep failed", err);
  }

  return { scanned: pendingVersions.length, contractsOverdue, insuranceExpired };
  });
  if (!run.ok) return NextResponse.json({ success: false, error: "contract-shield_failed" }, { status: 500 });

  return NextResponse.json({ success: true, data: { ...run.result, timestamp: new Date().toISOString() } });
}
