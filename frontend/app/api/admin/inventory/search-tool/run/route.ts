// POST /api/admin/inventory/search-tool/run
// Queries MarketCheck through the ADAPTER (if key present) or the internal DB.
// Logs to AdminInventorySearchRun.
//
// PHASE 4 (§10 inventory/R57, §8.4): THE SECOND PROVIDER CLIENT IS RETIRED.
//
// This route used to build its own URL and fetch `https://marketcheck-prod.apigee.net`
// directly — a different HOST from the adapter's `api.marketcheck.com`, with:
//
//   * no radius parameter at all, so the provider's own default applied and AutoLenis's
//     100-mile policy did not;
//   * none of the three `include_*` flags, while reading `l.build?.*` — the same latent
//     shape defect the adapter had, which returns nothing when the flags are absent;
//   * its own narrower listing type, so no dealer object was captured and nothing this
//     tool surfaced could ever resolve to a rooftop;
//   * `year_min`/`year_max`, which are not the provider's documented parameter names.
//
// Every one of those is fixed in `MarketCheckAdapter`. Keeping a second client meant
// fixing each defect twice, and the record shows that is not what happens. One client.
//
// The budget draw is UNCHANGED and still happens here: the adapter takes a `budget` and
// draws immediately before dispatch, so the ledger sees this consumer exactly as before.

import { logger } from "@/lib/logger";
import { NextRequest, NextResponse } from "next/server";
import { getAdminFromRequest, createAuditLog } from "@/lib/auth/admin-api";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { InventorySourceType } from "@prisma/client";
import { resolveMarketConfig } from "@/lib/services/inventory/inventory-source-config.service";
import { cycleKeyFor, rollCycleForward, makeCallBudget, makeStaticBudget } from "@/lib/services/inventory/inventory-call-budget.service";
import { MarketCheckAdapter } from "@/lib/services/inventory/adapters/marketcheck.adapter";

const schema = z.object({
  make: z.string().optional(),
  model: z.string().optional(),
  yearMin: z.coerce.number().int().min(1990).max(2030).optional(),
  yearMax: z.coerce.number().int().min(1990).max(2030).optional(),
  zip: z.string().optional(),
  maxPrice: z.coerce.number().positive().optional(),
  condition: z.enum(["new", "used", "certified", "all"]).default("all"),
});

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
  // Recorded on the run row so an operator can tell a failed provider call from an empty
  // market without re-running the search.
  let providerOutcome: string | undefined;
  let providerError: string | undefined;

  // One call per admin click, drawn from the SAME per-credential ledger the daily sweep
  // spends from. Low volume historically (28 in April, 4 in May, 7 in June) so it is not
  // the cause of the 429 storm — but a monthly cap that only counts the orchestrator is not
  // a real cap.
  let budget: { acquire(): Promise<boolean>; spent(): number } | null = null;
  let sourceConfigured = false;
  let marketZip: string | undefined;
  let marketRadius: number | undefined;

  if (marketCheckKey) {
    const resolved = await resolveMarketConfig(InventorySourceType.MARKETCHECK, "MarketCheck");
    sourceConfigured = resolved.ok;
    if (resolved.ok) {
      marketZip = params.zip?.trim() || resolved.config.zip;
      marketRadius = resolved.config.radiusMiles;
      if (resolved.config.sourceId && resolved.config.configSource === "row") {
        const cycleKey = cycleKeyFor(new Date());
        await rollCycleForward(resolved.config.sourceId, cycleKey);
        budget = makeCallBudget(resolved.config.sourceId, cycleKey, resolved.config.monthlyCallBudget, 1);
      } else {
        // No ledger to draw from (env-tier config). The `is_active` kill switch still held
        // above via `resolved.ok`; the per-click grant of 1 is the remaining bound.
        budget = makeStaticBudget(1);
      }
    }
  }

  if (marketCheckKey && sourceConfigured && marketZip) {
    // THROUGH THE ADAPTER. Radius clamped, the three include flags sent, the dealer object
    // captured, one host, and the documented parameter names.
    const run = await new MarketCheckAdapter().search({
      zip: marketZip,
      radius: marketRadius,
      rowsPerCall: 24,
      maxCalls: 1,
      budget: budget ?? undefined,
      make: params.make,
      model: params.model,
      yearMin: params.yearMin,
      yearMax: params.yearMax,
      priceMaxCents: params.maxPrice ? Math.round(params.maxPrice * 100) : undefined,
      carType: params.condition === "all" ? undefined : params.condition,
    });

    // `source` is set from the OUTCOME, not before the request. It used to be assigned
    // "marketcheck" before the fetch, so a non-OK response returned an empty result list
    // still labelled as coming from MarketCheck — an empty market and a failed provider
    // call looked identical to the admin reading the screen. The adapter's outcome
    // vocabulary makes that distinction first-class.
    if (run.outcome === "SUCCESS" || run.outcome === "ZERO_RESULTS") {
      source = "marketcheck";
      const vins = run.vehicles.map((v) => v.vin).filter(Boolean) as string[];
      const existingVins = new Set(
        (await prisma.inventoryItem.findMany({ where: { vin: { in: vins } }, select: { vin: true } }))
          .map((i) => i.vin).filter(Boolean) as string[]
      );
      results = run.vehicles.map((v) => ({
        vin: v.vin ?? `MC-${v.sourceKey}`,
        make: v.make,
        model: v.model,
        year: v.year,
        trim: v.trim,
        priceCents: v.priceCents,
        mileage: v.mileage ?? 0,
        images: v.images.slice(0, 1),
        source: "marketcheck",
        alreadyInInventory: existingVins.has(v.vin ?? ""),
        externalId: v.listingId,
      }));
    } else if (run.outcome === "BUDGET_EXHAUSTED") {
      // The key exists but the ledger refused. Say so rather than silently presenting the
      // internal DB as if it were a live provider search.
      source = "db_budget_exhausted";
    } else {
      // FAILED / DEFERRED / PARTIAL / NOT_CONFIGURED. A provider failure is never rendered
      // as an empty market (§22a L1079) — the admin sees that the provider did not answer.
      source = "db_provider_error";
      if (run.error) logger.error("[search-tool/run] MarketCheck:", run.error);
    }
    providerOutcome = run.outcome;
    providerError = run.error;
  } else if (marketCheckKey && !sourceConfigured) {
    source = "db_source_inactive";
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
  // The run row said COMPLETED unconditionally, including when the provider errored —
  // the same "a resolved call is a successful call" shape as the cron log. It now records
  // what actually happened.
  await prisma.adminInventorySearchRun.create({
    data: {
      triggeredBy: admin.adminId,
      params: params as unknown as Parameters<typeof prisma.adminInventorySearchRun.create>[0]["data"]["params"],
      status: source === "db_provider_error" ? "FAILED" : "COMPLETED",
      vehiclesFetched: results.length,
      completedAt: new Date(),
      ...(providerError ? { error: providerError } : {}),
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
    // `source` says what the ADMIN saw; `providerOutcome` says what the provider actually
    // answered. They differ in exactly the case that matters — a failed call and an empty
    // market both degrade to internal results — so the audit trail carries both.
    metadata: { source, providerOutcome, total: results.length, params },
  });

  return NextResponse.json({ success: true, data: serialized, source, total: results.length });
}
