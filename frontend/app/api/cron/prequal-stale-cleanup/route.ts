import { NextRequest, NextResponse } from "next/server";
import { authorizeCronRequest } from "@/lib/security/cron-auth";
import { prisma } from "@/lib/prisma";
import { withCronRun } from "@/lib/services/monitoring/cron-monitor.service";
import { logger } from "@/lib/logger";

// Prequal stale-cleanup
//
// Expiry is modelled by `expiresAt` — it is NOT adverse action. Previous
// versions of this cron rewrote every expired record (including formerly
// APPROVED rows) to `DECLINED`, which routed buyers to the FCRA adverse-action
// page and made prequal-purge delete them. That was incorrect on every axis.
//
// Buyer gating (`app/buyer/layout.tsx`, `journey-status`, `isPrequalValid`)
// already reads `decision === "APPROVED" && expiresAt > now`, so an expired
// APPROVED record naturally surfaces the renew flow without any mutation here.
//
// This cron is now observability only — it counts expired records so we can
// alert on backlog, and never writes a `decision` value.
//
// PHASE 10 adds ONE effect, and it is deliberately not a decision write: §27.1's
// "Prequalification expiring → Buyer" notice. The rule above stands — no `decision` is
// touched, no record is mutated — and the expiring warning is the one thing this cron is
// uniquely placed to send, because a warning is BEFORE the fact and no request-path gate
// can see it. The expired half already has a home (`approval-recheck.ts`, at the gates
// that catch it); this is the half that has nowhere else to live.
//
// REUSED rather than given its own cron: this one already runs daily and already reads
// `expiresAt`, and a second cron over the same column is a second answer waiting to
// disagree with the first.

/** §27.1 — how far ahead of expiry the buyer is warned. */
const EXPIRING_WITHIN_DAYS = 7;

export async function GET(request: NextRequest) {
  const cronAuth = authorizeCronRequest(request);
  if (cronAuth) return cronAuth;

  const run = await withCronRun("prequal-stale-cleanup", async () => {
  const now = new Date();
  const expiredCount = await prisma.preQualification.count({
    where: { expiresAt: { lt: now } },
  });

  // Only APPROVED records: a DECLINED or under-review application has no approval to
  // expire, and warning someone that a decision they never got is about to lapse would be
  // both false and a disclosure §Stage 3 does not make.
  const horizon = new Date(now.getTime() + EXPIRING_WITHIN_DAYS * 24 * 60 * 60 * 1000);
  const expiring = await prisma.preQualification.findMany({
    where: { decision: "APPROVED", expiresAt: { gt: now, lte: horizon } },
    select: {
      id: true,
      expiresAt: true,
      buyerId: true,
      buyer: { select: { firstName: true, user: { select: { email: true } } } },
    },
  });

  let expiringNotified = 0;
  if (expiring.length > 0) {
    const { renderPrequalExpiry } = await import("@/lib/services/comms/phase2-email-content");
    const { enqueueTransactional } = await import("@/lib/services/comms/transactional-dispatcher.service");
    const { PHASE_2_TEMPLATES } = await import("@/lib/services/comms/state-recheck-registry");
    const renewUrl = `${(process.env.NEXT_PUBLIC_APP_URL ?? "").trim()}/buyer/prequal`;

    for (const row of expiring) {
      const email = row.buyer?.user?.email;
      if (!email || !row.expiresAt) continue;
      const content = renderPrequalExpiry("expiring", {
        firstName: row.buyer?.firstName ?? null,
        expiresAt: row.expiresAt,
        renewUrl,
      });
      try {
        await enqueueTransactional({
          triggerEvent: "prequal.expiring",
          templateKey: PHASE_2_TEMPLATES.PREQUAL_EXPIRING,
          channel: "email",
          recipientKind: "buyer",
          recipientId: row.buyerId,
          to: email,
          // ONCE PER APPLICATION, not once per run. This cron is daily and the window is
          // seven days wide, so a key without the application id would send the same
          // warning seven times; `skipIfPrequalRenewed` would not stop it, because
          // renewing is exactly what the buyer has NOT done.
          idempotencyKey: `${PHASE_2_TEMPLATES.PREQUAL_EXPIRING}:${row.id}`,
          payload: { email, subject: content.subject, html: content.html, text: content.text },
        });
        expiringNotified++;
      } catch (err) {
        // One buyer's notice must not stop the rest, and none of them may fail the cron —
        // this run's other job is the expired count, which is already computed.
        logger.error("[prequal-stale-cleanup] expiring notice not enqueued:", err);
      }
    }
  }

  return { expiredCount, expiringFound: expiring.length, expiringNotified };
  });
  if (!run.ok) return NextResponse.json({ success: false, error: "prequal-stale-cleanup_failed" }, { status: 500 });

  return NextResponse.json({ success: true, data: run.result });
}
