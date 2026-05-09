// GET /api/admin/inventory/template — download CSV template with all required headers + example row

import { NextRequest, NextResponse } from "next/server";
import { getAdminFromRequest } from "@/lib/auth/admin-api";

const HEADERS = [
  "make","model","year","trim","vin","priceCents","mileage",
  "condition","bodyType","exteriorColor","interiorColor","engine",
  "transmission","drivetrain","fuelType","city","state","zip","description","lane",
];

const EXAMPLE_ROW = [
  "Toyota","Camry","2022","XSE","1HGCM82633A123456","3500000","28000",
  "used","Sedan","Midnight Black","Black","2.5L I4","Automatic","FWD","Gasoline",
  "Atlanta","GA","30301","Low miles, clean title, well maintained.","LANE_2",
];

export async function GET(request: NextRequest) {
  const admin = await getAdminFromRequest(request);
  if (!admin) return new NextResponse(JSON.stringify({ error: { code: "UNAUTHORIZED", message: "Not authenticated" } }), { status: 401 });

  const csv = [HEADERS.join(","), EXAMPLE_ROW.map(v => `"${v}"`).join(",")].join("\n");

  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="autolenis-inventory-template.csv"',
    },
  });
}
