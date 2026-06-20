// GET /api/admin/vehicle-offers/vin-decode?vin=XXXXXX
// Decodes a VIN using the NHTSA free public API — no API key required.
// Admin-gated counterpart of the dealer VIN decoder, used to auto-populate
// the Create Dealer Offer Link form so admins don't hand-key vehicle details.
import { NextRequest } from "next/server";
import { getAdminFromRequest, adminError, adminSuccess } from "@/lib/auth/admin-api";

interface NHTSAResult {
  Variable: string;
  Value: string | null;
}

export async function GET(request: NextRequest) {
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Admin session required", 401);

  const vin = request.nextUrl.searchParams.get("vin")?.trim().toUpperCase();
  if (!vin || vin.length < 11 || vin.length > 17) {
    return adminError("VALIDATION_ERROR", "VIN must be 11–17 characters", 400);
  }
  // Reject characters outside the VIN alphabet to avoid passing arbitrary
  // user input into the upstream URL path.
  if (!/^[A-HJ-NPR-Z0-9]+$/.test(vin)) {
    return adminError("VALIDATION_ERROR", "VIN contains invalid characters", 400);
  }

  try {
    const res = await fetch(
      `https://vpic.nhtsa.dot.gov/api/vehicles/decodevin/${encodeURIComponent(vin)}?format=json`,
      { signal: AbortSignal.timeout(8000) }
    );
    if (!res.ok) return adminError("DECODE_FAILED", "VIN decode service unavailable", 502);

    const data = await res.json() as { Results?: NHTSAResult[] };
    const results = data.Results ?? [];

    const get = (variable: string) =>
      results.find(r => r.Variable === variable)?.Value ?? null;

    const decoded = {
      year:  get("Model Year"),
      make:  get("Make"),
      model: get("Model"),
      trim:  get("Trim") || get("Series"),
      bodyStyle:    get("Body Class"),
      driveType:    get("Drive Type"),
      fuelType:     get("Fuel Type - Primary"),
      transmission: get("Transmission Style"),
    };

    if (!decoded.year || !decoded.make || !decoded.model) {
      return adminError("INVALID_VIN", "Could not decode this VIN — verify it is correct", 400);
    }

    return adminSuccess({ vin, decoded });
  } catch {
    return adminError("DECODE_ERROR", "VIN decode failed. Please enter details manually.", 500);
  }
}
