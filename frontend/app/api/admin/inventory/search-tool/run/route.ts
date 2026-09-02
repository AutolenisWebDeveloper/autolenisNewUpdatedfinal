// POST /api/admin/inventory/search-tool/run
// Queries MarketCheck (if key present) or internal DB. Logs to AdminInventorySearchRun.

import { logger } from "@/lib/logger";
import { NextRequest, NextResponse } from "next/server";
import { getAdminFromRequest, createAuditLog } from "@/lib/auth/admin-api";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { InventorySourceType } from "@prisma/client";
import { resolveMarketConfig } from "@/lib/services/inventory/inventory-source-config.service";
import { cycleKeyFor, rollCycleForward, tryConsumeCall } from "@/lib/services/inventory/inventory-call-budget.service";

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
  const admin = await getAdminFromRequest(request);
  if (!admin) {
    return NextResponse.json(
      { error: { code: "UNAUTHENTICATED", message: "Admin session required" } },
      { status: 401 },
    );
  }

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

  // This route is the SECOND consumer of MARKETCHECK_API_KEY, on a different host
  // (marketcheck-prod.apigee.net), one call per admin click, and it was outside every
  // budget. Low volume historically (28 in April, 4 in May, 7 in June) so it is not the
  // cause of the 429 storm — but a monthly cap that only counts the orchestrator is not a
  // real cap. It now draws from the same per-credential ledger, and falls back to the
  // internal DB when the ledger refuses.
  let budgetAllowed = false;
  if (marketCheckKey) {
    const resolved = await resolveMarketConfig(InventorySourceType.MARKETCHECK, "MarketCheck");
    if (resolved.ok && resolved.config.sourceId && resolved.config.configSource === "row") {
      const cycleKey = cycleKeyFor(new Date());
      await rollCycleForward(resolved.config.sourceId, cycleKey);
      budgetAllowed = await tryConsumeCall(
        resolved.config.sourceId, cycleKey, resolved.config.monthlyCallBudget,
      );
    } else {
      // No ledger to draw from (source inactive, unconfigured, or the migration is not yet
      // applied). Allow the call only when the source is not explicitly disabled — the
      // is_active kill switch must hold here too.
      budgetAllowed = resolved.ok;
    }
  }

  if (marketCheckKey && budgetAllowed) {
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

      // `source` is set from the RESPONSE, not before the request. It used to be assigned
      // "marketcheck" before the fetch, so a non-OK response returned an empty result list
      // still labelled as coming from MarketCheck — an empty market and a failed provider
      // call looked identical to the admin reading the screen.
      if (mcRes.ok) {
        source = "marketcheck";
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
      logger.error("[search-tool/run] MarketCheck error:", err);
      source = "db_provider_error";
    }
    if (source !== "marketcheck" && source !== "db_provider_error") {
      // A non-OK HTTP response: the provider answered, but not with listings.
      source = "db_provider_error";
    }
  } else if (marketCheckKey) {
    // The key exists but the ledger refused. Say so rather than silently presenting the
    // internal DB as if it were a live provider search.
    source = "db_budget_exhausted";
  }

  // Fallback to internal DB
  if (source !== "marketcheck") {
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

  await createAuditLog(admin, request, {
    action: "INVENTORY_SEARCH_TOOL_RUN",
    entityType: "AdminInventorySearchRun",
    entityId: admin.adminId,
    metadata: { source, total: results.length, params },
  });

  return NextResponse.json({ success: true, data: serialized, source, total: results.length });
}
