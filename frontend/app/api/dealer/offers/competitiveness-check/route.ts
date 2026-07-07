import { NextRequest } from "next/server";
import { getRequestDealer, successResponse, errorResponse } from "@/lib/auth/dealer-api";
import { prisma } from "@/lib/prisma";

// F10 — GET /api/dealer/offers/competitiveness-check
// Checks if a proposed price is competitive vs. anonymized segment medians
export async function GET(request: NextRequest) {
  const dealer = await getRequestDealer(request);
  if (!dealer) return errorResponse("UNAUTHORIZED", "Not authenticated", 401);

  const { searchParams } = new URL(request.url);
  const otdCents = parseInt(searchParams.get("otdCents") ?? "0");

  if (!otdCents || otdCents <= 0) return errorResponse("VALIDATION_ERROR", "otdCents is required", 400);

  // Compute anonymized segment median from recent offers in a COMPARABLE price
  // band. Benchmarking against the whole platform mislabels the result — an
  // $80k truck compared to a pool dominated by $20k sedans reads "WEAK" against
  // an irrelevant median. Scope to offers within ±35% of the proposed OTD so
  // the "segment" median is actually a like-for-like comparison.
  const bandLow = Math.round(otdCents * 0.65);
  const bandHigh = Math.round(otdCents * 1.35);
  const recentOffers = await prisma.offer.findMany({
    where: {
      createdAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
      status: "SUBMITTED",
      otdPriceCents: { gte: bandLow, lte: bandHigh },
    },
    select: { otdPriceCents: true },
    take: 100,
  });

  // Require a minimum sample before returning a comparative ranking.
  // When sample is insufficient, return an honest "unknown" signal rather than
  // fabricating a median benchmark.
  const hasData = recentOffers.length >= 5;
  if (!hasData) {
    return successResponse({
      competitiveness: "unknown",
      pctVsMedian: null,
      segmentMedianCents: null,
      lowConfidence: true,
      message: "Insufficient market data for comparison.",
    });
  }

  const medianOtd = recentOffers.map(o => o.otdPriceCents).sort((a, b) => a - b)[Math.floor(recentOffers.length / 2)];

  if (!medianOtd || medianOtd <= 0) {
    return successResponse({
      competitiveness: "unknown",
      pctVsMedian: null,
      segmentMedianCents: null,
      lowConfidence: true,
      message: "Insufficient market data for comparison.",
    });
  }

  // pct is positive when offer is BELOW the median (cheaper = more competitive).
  // STRONG: offer is ≥5% below median; MODERATE: offer is 0-5% below median; WEAK: offer is above median.
  const pct = ((medianOtd - otdCents) / medianOtd) * 100;
  const competitiveness =
    pct >= 5  ? "STRONG"
    : pct >= 0 ? "MODERATE"
    : "WEAK";

  return successResponse({
    competitiveness,
    pctVsMedian: Math.round(pct * 10) / 10,
    segmentMedianCents: medianOtd,
    // Never return individual competitor prices — anonymized median only
  });
}
