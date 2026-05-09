// POST /api/admin/inventory/search-tool/run
// Queries MarketCheck (if key present) or internal DB. Logs to AdminInventorySearchRun.

import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/admin-session";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const schema = z.object({
  make: z.string().optional(),
  model: z.string().optional(),
  yearMin: z.coerce.number().int().min(1990).max(2030).optional(),
  yearMax: z.coerce.number().int().min(1990).max(2030).optional(),
  zip: z.string().optional(),
  maxPrice: z.coerce.number().positive().optional(),
  condition: z.enum(["new", "used", "certified", "all"]).default("all"),
});

interface MarketCheckListing {
  id?: string;
  vin?: string;
  price?: number;
  miles?: number;
  build?: { year?: number; make?: string; model?: string; trim?: string };
  media?: { photo_links?: string[] };
  exterior_color?: string;
  inventory_type?: string;
}

export async function POST(request: NextRequest) {
  const admin = await requireAdmin();

  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }

  const params = parsed.data;
  const marketCheckKey = process.env.MARKETCHECK_API_KEY;

  interface ResultItem {
    vin: string; make: string; model: string; year: number; trim?: string;
    priceCents: number; mileage: number; images: string[];
    source: string; alreadyInInventory: boolean; externalId?: string;
  }

  let results: ResultItem[] = [];
  let source = "db";

  if (marketCheckKey) {
    source = "marketcheck";
    try {
      const qp = new URLSearchParams({ api_key: marketCheckKey, rows: "24", start: "0" });
      if (params.make) qp.set("make", params.make);
      if (params.model) qp.set("model", params.model);
      if (params.yearMin) qp.set("year_min", String(params.yearMin));
      if (params.yearMax) qp.set("year_max", String(params.yearMax));
      if (params.zip) qp.set("zip", params.zip);
      if (params.maxPrice) qp.set("price_max", String(params.maxPrice));
      if (params.condition && params.condition !== "all") qp.set("car_type", params.condition);

      const mcRes = await fetch(`https://marketcheck-prod.apigee.net/v2/search/car/active?${qp}`, {
        headers: { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(10000),
      });

      if (mcRes.ok) {
        const mcData = await mcRes.json() as { listings?: MarketCheckListing[] };
        const listings: MarketCheckListing[] = mcData.listings ?? [];
        const vins = listings.map(l => l.vin).filter(Boolean) as string[];
        const existingVins = new Set(
          (await prisma.inventoryItem.findMany({ where: { vin: { in: vins } }, select: { vin: true } }))
            .map(i => i.vin).filter(Boolean) as string[]
        );

        results = listings.map(l => ({
          vin: l.vin ?? `MC-${l.id ?? Math.random().toString(36).slice(2)}`,
          make: l.build?.make ?? "",
          model: l.build?.model ?? "",
          year: l.build?.year ?? 0,
          trim: l.build?.trim,
          priceCents: (l.price ?? 0) * 100,
          mileage: l.miles ?? 0,
          images: l.media?.photo_links?.slice(0, 1) ?? [],
          source: "marketcheck",
          alreadyInInventory: existingVins.has(l.vin ?? ""),
          externalId: l.id,
        }));
      }
    } catch (err) {
      console.error("[search-tool/run] MarketCheck error:", err);
      source = "db_fallback";
    }
  }

  // Fallback to internal DB
  if (!marketCheckKey || source === "db_fallback") {
    source = "db";
    // Build a raw where clause to avoid complex Prisma typing
    const conditions: string[] = ["is_active = true"];
    const values: unknown[] = [];
    let idx = 1;
    if (params.make) { conditions.push(`LOWER(make) LIKE LOWER($${idx++})`); values.push(`%${params.make}%`); }
    if (params.model) { conditions.push(`LOWER(model) LIKE LOWER($${idx++})`); values.push(`%${params.model}%`); }
    if (params.yearMin) { conditions.push(`year >= $${idx++}`); values.push(params.yearMin); }
    if (params.yearMax) { conditions.push(`year <= $${idx++}`); values.push(params.yearMax); }
    if (params.maxPrice) { conditions.push(`price_cents <= $${idx++}`); values.push(params.maxPrice * 100); }

    type DbItem = { id: string; vin: string | null; make: string; model: string; year: number; trim: string | null; mileage: number | null; price_cents: number; images: string[] };
    const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const dbItems = await prisma.$queryRawUnsafe<DbItem[]>(
      `SELECT id, vin, make, model, year, trim, mileage, price_cents, images FROM inventory_items ${whereClause} LIMIT 24`,
      ...values
    );

    results = dbItems.map(item => ({
      vin: item.vin ?? item.id,
      make: item.make,
      model: item.model,
      year: item.year,
      trim: item.trim ?? undefined,
      priceCents: item.price_cents,
      mileage: item.mileage ?? 0,
      images: item.images?.slice(0, 1) ?? [],
      source: "db",
      alreadyInInventory: true,
    }));
  }

  // Log the search run
  await prisma.adminInventorySearchRun.create({
    data: {
      triggeredBy: admin.adminId,
      params: params as unknown as Parameters<typeof prisma.adminInventorySearchRun.create>[0]["data"]["params"],
      status: "COMPLETED",
      vehiclesFetched: results.length,
    },
  }).catch(() => {});

  // Serialize for response (price in dollars for UI)
  const serialized = results.map(r => ({
    ...r,
    price: r.priceCents / 100,
    imageUrl: r.images[0] ?? null,
  }));

  return NextResponse.json({ success: true, data: serialized, source, total: results.length });
}
