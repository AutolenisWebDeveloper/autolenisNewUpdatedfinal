import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// Public, sanitized health endpoint for the /status page.
// Never exposes admin-sensitive metrics (OFAC alerts, contract failures,
// queue counts, etc.) — those remain in /api/admin/health.

export const dynamic = "force-dynamic";

interface PublicHealthData {
  status: "healthy" | "degraded" | "down";
  database: boolean;
  inventoryHealth: number; // 0-100, derived from active inventory volume
  activeAuctions: number;
  alerts: string[];
  timestamp: string;
}

export async function GET() {
  try {
    // Lightweight DB reachability probe.
    await prisma.$queryRaw`SELECT 1`;

    const [inventoryCount, activeAuctions] = await Promise.all([
      prisma.inventoryItem.count({ where: { isActive: true } }),
      prisma.auction.count({ where: { status: "ACTIVE" } }),
    ]);

    // Map inventory volume to a coarse 0-100 health score. 10+ active vehicles
    // is considered fully healthy; below that the score scales linearly.
    const inventoryHealth = Math.min(100, Math.round((inventoryCount / 10) * 100));

    const data: PublicHealthData = {
      status: "healthy",
      database: true,
      inventoryHealth,
      activeAuctions,
      alerts: [],
      timestamp: new Date().toISOString(),
    };

    return NextResponse.json(
      { success: true, data },
      { headers: { "Cache-Control": "public, max-age=60, stale-while-revalidate=30" } }
    );
  } catch {
    // Return 200 (not 5xx) so the public status page always renders. The page
    // will surface the degraded state to visitors.
    const data: PublicHealthData = {
      status: "degraded",
      database: false,
      inventoryHealth: 0,
      activeAuctions: 0,
      alerts: ["Platform health check temporarily unavailable."],
      timestamp: new Date().toISOString(),
    };
    return NextResponse.json({ success: false, data }, { status: 200 });
  }
}
