// AMIPS — bulk dealer-discovery runner.
//
// Drives the existing Gemini Maps dealer-discovery pipeline across the top 25
// US metros × the top 10 vehicle brands (250 combinations) and upserts every
// discovered dealer into the DealerProspect table with buyerOppId = null.
//
// No buyer required:
//   DealerProspect.buyerOppId is now optional. Bulk market discovery has no
//   originating buyer request, so every prospect created here is unscoped
//   (buyerOppId = null). Buyer-intake prospects still carry a real buyerOppId.
//
// Dedup:
//   The table has no compound unique constraint, so createMany({skipDuplicates})
//   cannot dedup by dealer identity. We match each discovered dealer on its
//   natural identity (website URL when present, else name + city + state) and
//   update in place rather than inserting a duplicate.
//
// Requires DATABASE_URL and GEMINI_API_KEY in the environment.
//
// Usage (from frontend/):
//   pnpm amips:discover

import { prisma } from "@/lib/prisma";
import {
  discoverDealers,
  type DiscoveredDealer,
} from "@/lib/services/acquisition/compound-search.service";

// ───────────────────────────────────────────────────
// TARGETS
// ───────────────────────────────────────────────────

interface MetroTarget {
  metro: string;
  // A central ZIP for the metro — the seed point for the 30-mile Gemini Maps
  // radius search.
  zip: string;
}

// Top 25 US metros with a representative center ZIP each.
const METROS: MetroTarget[] = [
  { metro: "Dallas-Fort Worth", zip: "75201" },
  { metro: "Houston", zip: "77001" },
  { metro: "Los Angeles", zip: "90001" },
  { metro: "Chicago", zip: "60601" },
  { metro: "Miami", zip: "33101" },
  { metro: "Atlanta", zip: "30301" },
  { metro: "Washington DC", zip: "20001" },
  { metro: "Phoenix", zip: "85001" },
  { metro: "Philadelphia", zip: "19101" },
  { metro: "Detroit", zip: "48201" },
  { metro: "Boston", zip: "02101" },
  { metro: "San Antonio", zip: "78201" },
  { metro: "Austin", zip: "78701" },
  { metro: "Seattle", zip: "98101" },
  { metro: "Denver", zip: "80201" },
  { metro: "Minneapolis", zip: "55401" },
  { metro: "Tampa", zip: "33601" },
  { metro: "Charlotte", zip: "28201" },
  { metro: "San Diego", zip: "92101" },
  { metro: "Portland", zip: "97201" },
  { metro: "Las Vegas", zip: "89101" },
  { metro: "Nashville", zip: "37201" },
  { metro: "Baltimore", zip: "21201" },
  { metro: "Sacramento", zip: "95801" },
  { metro: "New York", zip: "10001" },
];

// Top 10 vehicle brands.
const BRANDS: string[] = [
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
const DELAY_BETWEEN_CALLS_MS = 2000;
const SEARCH_RADIUS_MILES = 30;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// ───────────────────────────────────────────────────
// UPSERT
// ───────────────────────────────────────────────────

type UpsertOutcome = "inserted" | "updated";

// Upsert a single discovered dealer, deduping on natural identity. We store the
// queried brand (not the model-returned one) so the per-brand rollup stays
// clean. Bulk-discovery prospects are unscoped — buyerOppId = null.
async function upsertDealer(
  brand: string,
  d: DiscoveredDealer,
): Promise<UpsertOutcome> {
  // Prefer the dealer website URL as the dedup key; fall back to
  // name + city + state when no website was returned.
  const existing = await prisma.dealerProspect.findFirst({
    where: d.website
      ? { website: d.website }
      : {
          name: d.name,
          city: d.city ?? undefined,
          state: d.state ?? undefined,
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
    data: { ...data, buyerOppId: null, status: "DISCOVERED" },
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

  const combos = METROS.length * BRANDS.length;
  console.log(
    `[amips-discover] starting — ${METROS.length} metros × ${BRANDS.length} brands = ${combos} combinations`,
  );

  let comboIdx = 0;
  let totalFound = 0;
  let totalInserted = 0;
  let totalUpdated = 0;
  let totalErrors = 0;

  for (const m of METROS) {
    for (const brand of BRANDS) {
      comboIdx++;
      try {
        const dealers = await discoverDealers({
          make: brand,
          zip: m.zip,
          radiusMiles: SEARCH_RADIUS_MILES,
        });

        let inserted = 0;
        let updated = 0;
        for (const d of dealers) {
          const outcome = await upsertDealer(brand, d);
          if (outcome === "inserted") inserted++;
          else updated++;
        }

        totalFound += dealers.length;
        totalInserted += inserted;
        totalUpdated += updated;

        console.log(
          `[amips-discover] ${m.metro} + ${brand}: ${dealers.length} found ` +
            `(${inserted} new, ${updated} updated) [${comboIdx}/${combos}]`,
        );
      } catch (err) {
        totalErrors++;
        console.error(
          `[amips-discover] ${m.metro} + ${brand} FAILED [${comboIdx}/${combos}]:`,
          err instanceof Error ? err.message : err,
        );
      }

      // Rate-limit: pause between Gemini calls, but not after the last combo.
      if (comboIdx < combos) {
        await sleep(DELAY_BETWEEN_CALLS_MS);
      }
    }
  }

  console.log("");
  console.log("[amips-discover] Complete");
  console.log(`Total combinations: ${combos}`);
  console.log(`Total dealers found: ${totalFound}`);
  console.log(`New records created: ${totalInserted}`);
  console.log(`Existing records updated: ${totalUpdated}`);
  if (totalErrors > 0) {
    console.log(`Errors: ${totalErrors}`);
  }
  console.log("Run pnpm amips:sync-dealers to sync to dealer_intelligence");
}

main()
  .catch((err) => {
    console.error("[amips-discover] FATAL", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
