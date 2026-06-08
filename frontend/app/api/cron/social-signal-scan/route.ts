// Social Engine — Cron 1: Daily Topic Signal Scan.
// Scans existing AutoLenis intelligence and materializes fresh TopicSignals.
// Schedule: 0 5 * * * (05:00 UTC ≈ midnight CT).

import { NextRequest, NextResponse } from "next/server";
import { CRON_AUTH_HEADER, CRON_AUTH_PREFIX } from "@/lib/constants";
import { scanForTopicSignals } from "@/lib/social/topic-signal.engine";

export const maxDuration = 120;

export async function GET(request: NextRequest) {
  const auth = request.headers.get(CRON_AUTH_HEADER);
  const isVercelCron = request.headers.get("x-vercel-cron") === "1";
  const isValidSecret = auth === `${CRON_AUTH_PREFIX}${process.env.CRON_SECRET}`;
  if (!isVercelCron && !isValidSecret) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const signals = await scanForTopicSignals();
  const summary = {
    signalsCreated: signals.length,
    byType: signals.reduce<Record<string, number>>((acc, s) => {
      acc[s.signalType] = (acc[s.signalType] ?? 0) + 1;
      return acc;
    }, {}),
    timestamp: new Date().toISOString(),
  };
  console.log("[social-signal-scan]", JSON.stringify(summary));
  return NextResponse.json({ success: true, data: summary });
}
