import { NextRequest, NextResponse } from "next/server";
import { runInventorySync } from "@/lib/services/inventory/orchestrator";
import { CRON_AUTH_HEADER, CRON_AUTH_PREFIX } from "@/lib/constants";

// Cron: /api/cron/inventory-sync-priority — Schedule: 0 * * * * (every hour)
// Registered in vercel.json ✓

export async function GET(request: NextRequest) {
  const auth = request.headers.get(CRON_AUTH_HEADER);
  const isVercelCron = request.headers.get("x-vercel-cron") === "1";
  const isValidSecret = auth === `${CRON_AUTH_PREFIX}${process.env.CRON_SECRET}`;
  if (!isVercelCron && !isValidSecret) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  try {
    const result = await runInventorySync({}, "priority");
    return NextResponse.json({ success: true, data: { upserted: result.upserted, healthScore: result.healthScore } });
  } catch (err) {
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
  }
}
