import { logger } from "@/lib/logger";
import { NextRequest, NextResponse } from "next/server";
import { CRON_AUTH_HEADER, CRON_AUTH_PREFIX } from "@/lib/constants";
import { prisma } from "@/lib/prisma";

// OFAC SLA escalation — flag OFAC-marked prequals that have been waiting on
// compliance for longer than the SLA window.
//
// History: previously this cron queried `decision: "OFAC_ESCALATED"`, but all
// services write OFAC cases as `OFAC_REVIEW`, so the query never matched and
// no alerts were ever produced. We accept both decision values to cover the
// historical enum + only escalate rows older than the SLA window so freshly
// flagged cases aren't immediately paged.
//
// Cases are also visible in /admin/manual-reviews; this cron is the proactive
// "aged past SLA" alert and does not replace the standing queue surface.
const OFAC_SLA_HOURS = 24;

export async function GET(request: NextRequest) {
  const auth = request.headers.get(CRON_AUTH_HEADER);
  const isVercelCron = request.headers.get("x-vercel-cron") === "1";
  const isValidSecret = auth === `${CRON_AUTH_PREFIX}${process.env.CRON_SECRET}`;
  if (!isVercelCron && !isValidSecret) return new NextResponse("Unauthorized", { status: 401 });

  const slaCutoff = new Date(Date.now() - OFAC_SLA_HOURS * 60 * 60 * 1000);
  const aged = await prisma.preQualification.count({
    where: {
      checkOfacAlert: true,
      decision: { in: ["OFAC_REVIEW", "OFAC_ESCALATED"] },
      updatedAt: { lt: slaCutoff },
    },
  });

  let paged = false;
  if (aged > 0) {
    // Idempotent: don't re-page every daily run while the queue stays aged.
    // Only raise a fresh alert if none was raised in the last SLA window.
    const recentAlert = await prisma.notification.findFirst({
      where: {
        title: "OFAC Escalation SLA",
        type: "SYSTEM_ALERT",
        createdAt: { gte: slaCutoff },
      },
      select: { id: true },
    });
    if (!recentAlert) {
      await prisma.notification
        .create({
          data: {
            title: "OFAC Escalation SLA",
            body: `${aged} OFAC review case(s) have exceeded the ${OFAC_SLA_HOURS}h SLA. Review now via /admin/manual-reviews.`,
            type: "SYSTEM_ALERT",
            actionUrl: "/admin/manual-reviews",
          },
        })
        .then(() => { paged = true; })
        .catch((err) => logger.error("[prequal-sla-escalation] alert notification failed:", err));
    }
  }

  return NextResponse.json({ success: true, data: { escalated: aged, paged } });
}
