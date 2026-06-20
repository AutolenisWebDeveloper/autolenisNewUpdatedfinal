import { NextRequest, NextResponse } from "next/server";
import { CRON_AUTH_HEADER, CRON_AUTH_PREFIX } from "@/lib/constants";
import { captureIntelligenceSnapshot } from "@/lib/amips/intelligence/executive-intelligence";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

// Daily — capture a point-in-time snapshot of the executive-intelligence rollup
// so the Market Intelligence Center can show genuine day/week trend deltas.
export async function GET(request: NextRequest) {
  const auth = request.headers.get(CRON_AUTH_HEADER);
  const isVercelCron = request.headers.get("x-vercel-cron") === "1";
  const isValidSecret = auth === `${CRON_AUTH_PREFIX}${process.env.CRON_SECRET}`;
  if (!isVercelCron && !isValidSecret) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  try {
    const snapshot = await captureIntelligenceSnapshot();
    return NextResponse.json({
      success: true,
      data: { id: snapshot.id, healthScore: snapshot.healthScore },
    });
  } catch (err) {
    logger.error("[amips-snapshot] capture failed:", err);
    return NextResponse.json(
      { success: false, error: (err as Error).message },
      { status: 200 },
    );
  }
}
