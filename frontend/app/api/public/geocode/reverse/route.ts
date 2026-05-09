import { NextRequest, NextResponse } from "next/server";
import { ZIP_COORDS } from "@/lib/utils/zip-coords";

export const dynamic = "force-dynamic";

// Reverse geocode lat/lng to nearest known ZIP from our local table.
// No external API.
export async function GET(request: NextRequest) {
  const lat = parseFloat(request.nextUrl.searchParams.get("lat") ?? "");
  const lng = parseFloat(request.nextUrl.searchParams.get("lng") ?? "");
  if (isNaN(lat) || isNaN(lng)) {
    return NextResponse.json({ error: { code: "INVALID_COORDS" } }, { status: 400 });
  }

  let nearestZip = "";
  let nearestDist = Infinity;
  for (const [zip, c] of Object.entries(ZIP_COORDS)) {
    const dLat = (lat - c.lat);
    const dLng = (lng - c.lng);
    const d = dLat * dLat + dLng * dLng;
    if (d < nearestDist) { nearestDist = d; nearestZip = zip; }
  }

  return NextResponse.json({ zip: nearestZip || null });
}
