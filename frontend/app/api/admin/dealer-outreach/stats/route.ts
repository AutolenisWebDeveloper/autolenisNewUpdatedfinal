// GET /api/admin/dealer-outreach/stats — pipeline counts grouped by status.
// Optional filters: from / to (ISO date strings) on created_at.
import { NextRequest } from "next/server";
import { getAdminFromRequest, adminSuccess, adminError } from "@/lib/auth/admin-api";
import { prisma } from "@/lib/prisma";
import { type Prisma } from "@prisma/client";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);

  const { searchParams } = new URL(request.url);
  const from = searchParams.get("from");
  const to = searchParams.get("to");

  const where: Prisma.DealerProspectWhereInput = {};
  const createdAt: Prisma.DateTimeFilter = {};
  if (from && !Number.isNaN(Date.parse(from))) createdAt.gte = new Date(from);
  if (to && !Number.isNaN(Date.parse(to))) createdAt.lte = new Date(to);
  if (createdAt.gte || createdAt.lte) where.createdAt = createdAt;

  try {
    const grouped = await prisma.dealerProspect.groupBy({
      by: ["status"],
      where,
      _count: { _all: true },
    });

    const counts = {
      discovered: 0,
      scripted: 0,
      contacted: 0,
      replied: 0,
      onboarded: 0,
      dead: 0,
      total: 0,
    };

    for (const g of grouped) {
      const n = g._count._all;
      counts.total += n;
      switch (g.status) {
        case "DISCOVERED":
          counts.discovered += n;
          break;
        case "SCRIPTED":
          counts.scripted += n;
          break;
        case "CONTACTED":
          counts.contacted += n;
          break;
        case "REPLIED":
          counts.replied += n;
          break;
        case "ONBOARDED":
          counts.onboarded += n;
          break;
        case "DEAD":
          counts.dead += n;
          break;
        // DRAFTED (email-phase forward-compat) is counted in total only.
      }
    }

    return adminSuccess(counts);
  } catch (err) {
    return adminError(
      "FETCH_FAILED",
      err instanceof Error ? err.message : "Failed to fetch stats",
      500,
    );
  }
}
