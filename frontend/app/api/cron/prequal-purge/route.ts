import { NextRequest, NextResponse } from "next/server";
import { CRON_AUTH_HEADER, CRON_AUTH_PREFIX } from "@/lib/constants";
import { prisma } from "@/lib/prisma";

// Prequal purge — hard-delete genuinely terminal, never-approved records.
//
// INVARIANT: this cron must NEVER delete a record that was ever APPROVED.
// Expired APPROVED rows are the buyer's renewable approval history — they
// drive the "renew" surface on /buyer/prequal and must be preserved.
//
// We rely on two upstream guarantees to make `decision in [DECLINED,
// MANUAL_REVIEW]` a safe terminal filter:
//   1. prequal-stale-cleanup no longer overwrites `decision` on expiry.
//   2. The only writers of `DECLINED` are the iPredict orchestrators
//      (microbilt + admin) and the manual-override endpoints. None of them
//      flip an existing APPROVED row to DECLINED — they either upsert from
//      a fresh provider response or are explicit admin actions logged in
//      AdminAuditLog. There is no code path that silently converts an
//      APPROVED row to DECLINED.
//
// If a new code path is ever introduced that does flip APPROVED → DECLINED,
// this filter must be tightened (e.g. add a `wasEverApproved` flag) before
// that change ships.
export async function GET(request: NextRequest) {
  const auth = request.headers.get(CRON_AUTH_HEADER);
  const isVercelCron = request.headers.get("x-vercel-cron") === "1";
  const isValidSecret = auth === `${CRON_AUTH_PREFIX}${process.env.CRON_SECRET}`;
  if (!isVercelCron && !isValidSecret) return new NextResponse("Unauthorized", { status: 401 });
  // Purge terminal, never-approved pre-qualifications older than 30 days past expiry.
  const cutoff = new Date(Date.now() - 30 * 24 * 3600000);
  const { count } = await prisma.preQualification.deleteMany({
    where: {
      expiresAt: { lt: cutoff },
      decision: { in: ["DECLINED", "MANUAL_REVIEW"] },
    },
  });
  return NextResponse.json({ success: true, data: { purged: count } });
}
