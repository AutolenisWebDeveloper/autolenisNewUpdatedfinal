// Fixes mismatched photos for all sourceAdapter='seed_v1' vehicles.
// Loops every seed_v1 row and rewrites `images` based on make + body type
// using the curated, verified Unsplash photo map.
//
// Run with: cd /app/frontend && npx tsx prisma/fix-seed-photos.ts

import { PrismaClient } from "@prisma/client";
import { pickPhotoIds, buildPhotoUrls, type BodyType } from "./lib/seed-photos";

const prisma = new PrismaClient();

// Body-type lookup for every model we seeded. Keep in sync with seed-inventory.ts.
const MODEL_BODY: Record<string, Record<string, BodyType>> = {
  Toyota:     { "RAV4": "SUV", "Camry": "SEDAN", "Tacoma": "TRUCK", "Highlander": "SUV" },
  Honda:      { "CR-V": "SUV", "Civic": "SEDAN", "Accord": "SEDAN", "Pilot": "SUV" },
  Ford:       { "F-150": "TRUCK", "Explorer": "SUV", "Escape": "SUV" },
  Chevrolet:  { "Silverado 1500": "TRUCK", "Equinox": "SUV", "Malibu": "SEDAN", "Tahoe": "SUV" },
  Nissan:     { "Rogue": "SUV", "Altima": "SEDAN", "Frontier": "TRUCK" },
  Hyundai:    { "Tucson": "SUV", "Elantra": "SEDAN", "Santa Fe": "SUV" },
  Kia:        { "Sportage": "SUV", "Sorento": "SUV", "Forte": "SEDAN" },
  Mazda:      { "CX-5": "SUV", "Mazda3": "SEDAN" },
  Subaru:     { "Outback": "SUV", "Forester": "SUV" },
  Jeep:       { "Grand Cherokee": "SUV", "Wrangler": "SUV" },
  GMC:        { "Sierra 1500": "TRUCK", "Acadia": "SUV" },
  Ram:        { "1500": "TRUCK" },
};

function bodyFor(make: string, model: string): BodyType {
  const b = MODEL_BODY[make]?.[model];
  if (!b) {
    // Conservative fallback: any unknown model is a SEDAN (least likely to look wrong).
    console.warn(`[fix-seed-photos] No body type for ${make} ${model} — defaulting to SEDAN`);
    return "SEDAN";
  }
  return b;
}

async function main() {
  console.log("[fix-seed-photos] Starting…");
  const rows = await prisma.inventoryItem.findMany({
    where: { sourceAdapter: "seed_v1" },
    select: { id: true, make: true, model: true },
    orderBy: { createdAt: "asc" },
  });
  console.log(`[fix-seed-photos] Found ${rows.length} seed_v1 vehicles.`);

  // Per-make seeds so vehicles of the same make/body don't all get the same photo.
  const makeCounter: Record<string, number> = {};
  let updated = 0;
  for (const row of rows) {
    const body = bodyFor(row.make, row.model);
    const seed = (makeCounter[row.make] ?? 0);
    makeCounter[row.make] = seed + 1;

    const ids = pickPhotoIds(row.make, body, seed);
    const urls = buildPhotoUrls(ids);

    await prisma.inventoryItem.update({
      where: { id: row.id },
      data: { images: urls },
    });
    updated++;
    if (updated % 25 === 0) console.log(`  …${updated}/${rows.length}`);
  }
  console.log(`[fix-seed-photos] Updated ${updated} vehicles.`);

  // Sanity sample: print 5 random rows so the user can eyeball the result.
  const sample = await prisma.inventoryItem.findMany({
    where: { sourceAdapter: "seed_v1" },
    select: { make: true, model: true, year: true, images: true },
    take: 5,
    orderBy: { createdAt: "desc" },
  });
  console.log("[fix-seed-photos] Sample:");
  for (const s of sample) {
    console.log(`  ${s.year} ${s.make} ${s.model} → ${s.images[0]}`);
  }
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
