// AMIPS — Wave 1 bulk dealer-discovery enrichment runner.
//
// Triggers the existing Gemini Maps dealer-discovery pipeline across the top 25
// US metros × the top 10 vehicle brands (250 combinations) and upserts every
// discovered dealer into the DealerProspect table.
//
// Why a sentinel buyer opportunity:
//   DealerProspect.buyerOppId is a required FK to BuyerOpportunity (every
//   prospect is normally scoped to the buyer request that surfaced it). Bulk
//   market enrichment has no originating buyer, so we attach all enrichment
//   prospects to a single, stable system opportunity keyed by a fixed
//   sessionId. Re-runs reuse it, so the script stays idempotent.
//
// Dedup:
//   The table has no compound unique constraint, so createMany({skipDuplicates})
//   cannot dedup by dealer identity. We match each discovered dealer on its
//   natural identity (Google Maps source URL when present, else
//   name + city + state) and update in place rather than inserting a duplicate.
//
// Requires DATABASE_URL and GEMINI_API_KEY in the environment.
//
// Usage (from frontend/):
//   pnpm amips:enrich-dealers

import { prisma } from "@/lib/prisma";
import {
  discoverDealers,
  type DiscoveredDealer,
} from "@/lib/services/acquisition/compound-search.service";

// ───────────────────────────────────────────────────
// WAVE 1 TARGETS
// ───────────────────────────────────────────────────

interface MetroTarget {
  metro: string;
  state: string;
  // A central ZIP for the metro — the seed point for the 25-mile Gemini Maps
  // radius search. Mirrors the metro list in lib/amips/seed/content-queue.seed.ts.
  zip: string;
}

// Top 25 US metros (Wave 1) with a representative downtown ZIP each.
const WAVE_1_METROS: MetroTarget[] = [
  { metro: "Dallas-Fort Worth", state: "TX", zip: "75201" },
  { metro: "Houston", state: "TX", zip: "77002" },
  { metro: "Los Angeles", state: "CA", zip: "90012" },
  { metro: "Chicago", state: "IL", zip: "60601" },
  { metro: "Miami", state: "FL", zip: "33130" },
  { metro: "Atlanta", state: "GA", zip: "30303" },
  { metro: "Washington DC", state: "DC", zip: "20001" },
  { metro: "Phoenix", state: "AZ", zip: "85003" },
  { metro: "Philadelphia", state: "PA", zip: "19103" },
  { metro: "Detroit", state: "MI", zip: "48226" },
  { metro: "Boston", state: "MA", zip: "02108" },
  { metro: "San Antonio", state: "TX", zip: "78205" },
  { metro: "Austin", state: "TX", zip: "78701" },
  { metro: "Seattle", state: "WA", zip: "98101" },
  { metro: "Denver", state: "CO", zip: "80202" },
  { metro: "Minneapolis", state: "MN", zip: "55401" },
  { metro: "Tampa", state: "FL", zip: "33602" },
  { metro: "Charlotte", state: "NC", zip: "28202" },
  { metro: "San Diego", state: "CA", zip: "92101" },
  { metro: "Portland", state: "OR", zip: "97204" },
  { metro: "Las Vegas", state: "NV", zip: "89101" },
  { metro: "Nashville", state: "TN", zip: "37203" },
  { metro: "Baltimore", state: "MD", zip: "21202" },
  { metro: "Sacramento", state: "CA", zip: "95814" },
  { metro: "New York", state: "NY", zip: "10007" },
];

// Top 10 vehicle brands.
const WAVE_1_BRANDS: string[] = [
  "Toyota",
  "Ford",
  "Chevrolet",
  "Honda",
  "Ram",
  "GMC",
  "Kia",
  "Hyundai",
  "Jeep",
  "Lexus",
];

// Knobs.
const MAX_DEALERS_PER_COMBO = 10;
const DELAY_BETWEEN_CALLS_MS = 2000;
const SEARCH_RADIUS_MILES = 25;

// Stable identity for the system opportunity that owns all enrichment prospects.
const SYSTEM_SESSION_ID = "amips-enrich-dealers-system";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// ───────────────────────────────────────────────────
// SYSTEM OPPORTUNITY
// ───────────────────────────────────────────────────

// Ensure the sentinel BuyerOpportunity exists and return its id. Idempotent —
// re-runs reuse the same row (sessionId is unique).
async function ensureSystemOpportunity(): Promise<string> {
  const opp = await prisma.buyerOpportunity.upsert({
    where: { sessionId: SYSTEM_SESSION_ID },
    update: {},
    create: {
      sessionId: SYSTEM_SESSION_ID,
      source: "amips_enrich_dealers",
      firstName: "AMIPS Enrichment",
      completed: true,
    },
    select: { id: true },
  });
  return opp.id;
}

// ───────────────────────────────────────────────────
// UPSERT
// ───────────────────────────────────────────────────

type UpsertOutcome = "inserted" | "updated";

// Upsert a single discovered dealer, deduping on natural identity. We store the
// queried brand (not the model-returned one) so the per-brand verification
// rollup stays clean.
async function upsertDealer(
  buyerOppId: string,
  brand: string,
  d: DiscoveredDealer,
): Promise<UpsertOutcome> {
  // Prefer the Google Maps source URL (CID-based, one per place) as the dedup
  // key; fall back to name + city + state when no URL was returned.
  const existing = await prisma.dealerProspect.findFirst({
    where: d.sourceUrl
      ? { sourceUrl: d.sourceUrl }
      : {
          name: d.name,
          city: d.city ?? undefined,
          state: d.state ?? undefined,
          brand,
        },
    select: { id: true },
  });

  const data = {
    name: d.name,
    address: d.address,
    city: d.city,
    state: d.state,
    zip: d.zip,
    phone: d.phone,
    email: d.email,
    website: d.website,
    brand,
    sourceUrl: d.sourceUrl,
    searchScore: d.searchScore,
  };

  if (existing) {
    await prisma.dealerProspect.update({
      where: { id: existing.id },
      data,
    });
    return "updated";
  }

  await prisma.dealerProspect.create({
    data: { ...data, buyerOppId, status: "DISCOVERED" },
  });
  return "inserted";
}

// ───────────────────────────────────────────────────
// MAIN
// ───────────────────────────────────────────────────

async function main(): Promise<void> {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY not configured — cannot run dealer discovery");
  }

  const combos = WAVE_1_METROS.length * WAVE_1_BRANDS.length;
  console.log(
    `[amips-enrich] starting — ${WAVE_1_METROS.length} metros × ${WAVE_1_BRANDS.length} brands = ${combos} combinations`,
  );

  const buyerOppId = await ensureSystemOpportunity();
  console.log(`[amips-enrich] system opportunity: ${buyerOppId}`);

  let comboIdx = 0;
  let totalFound = 0;
  let totalInserted = 0;
  let totalUpdated = 0;
  let totalErrors = 0;

  for (const m of WAVE_1_METROS) {
    for (const brand of WAVE_1_BRANDS) {
      comboIdx++;
      const label = `${m.metro}, ${m.state} + ${brand}`;
      try {
        const dealers = await discoverDealers({
          make: brand,
          zip: m.zip,
          radiusMiles: SEARCH_RADIUS_MILES,
        });

        const slice = dealers.slice(0, MAX_DEALERS_PER_COMBO);
        let inserted = 0;
        let updated = 0;
        for (const d of slice) {
          const outcome = await upsertDealer(buyerOppId, brand, d);
          if (outcome === "inserted") inserted++;
          else updated++;
        }

        totalFound += slice.length;
        totalInserted += inserted;
        totalUpdated += updated;

        console.log(
          `[amips-enrich] ${m.metro} + ${brand} — found ${slice.length} ` +
            `(${inserted} new, ${updated} updated) [${comboIdx}/${combos}]`,
        );
      } catch (err) {
        totalErrors++;
        console.error(
          `[amips-enrich] ${label} FAILED [${comboIdx}/${combos}]:`,
          err instanceof Error ? err.message : err,
        );
      }

      // Rate-limit: pause between Gemini calls, but not after the last combo.
      if (comboIdx < combos) {
        await sleep(DELAY_BETWEEN_CALLS_MS);
      }
    }
  }

  const totalProspects = await prisma.dealerProspect.count();

  console.log("");
  console.log("[amips-enrich] ===== SUMMARY =====");
  console.log(`[amips-enrich] combinations processed: ${comboIdx}/${combos}`);
  console.log(`[amips-enrich] dealers found:          ${totalFound}`);
  console.log(`[amips-enrich] inserted (new):         ${totalInserted}`);
  console.log(`[amips-enrich] updated (existing):     ${totalUpdated}`);
  console.log(`[amips-enrich] errors:                 ${totalErrors}`);
  console.log(`[amips-enrich] dealer_prospects total: ${totalProspects}`);
  console.log("[amips-enrich] done");
}

main()
  .catch((err) => {
    console.error("[amips-enrich] FATAL", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
