// Backfill remaining inventory items missing city/state with realistic locations
// (round-robin through major US metros), then derive lat/lon. Also assign
// realistic features per body-type for items that have no features.

import { PrismaClient } from "@prisma/client";
import { lookupCity, lookupZip } from "../lib/utils/zip-coords";

const prisma = new PrismaClient();

// 26 anchor metros — items missing city/state get distributed across these
const ANCHORS: Array<{ city: string; state: string; zip: string }> = [
  { city: "Atlanta", state: "GA", zip: "30309" },
  { city: "Dallas", state: "TX", zip: "75201" },
  { city: "Houston", state: "TX", zip: "77002" },
  { city: "Austin", state: "TX", zip: "78701" },
  { city: "Miami", state: "FL", zip: "33101" },
  { city: "Orlando", state: "FL", zip: "32801" },
  { city: "Tampa", state: "FL", zip: "33602" },
  { city: "Nashville", state: "TN", zip: "37203" },
  { city: "Charlotte", state: "NC", zip: "28202" },
  { city: "Raleigh", state: "NC", zip: "27601" },
  { city: "Columbus", state: "OH", zip: "43215" },
  { city: "Indianapolis", state: "IN", zip: "46204" },
  { city: "Chicago", state: "IL", zip: "60611" },
  { city: "Minneapolis", state: "MN", zip: "55401" },
  { city: "Denver", state: "CO", zip: "80202" },
  { city: "Phoenix", state: "AZ", zip: "85003" },
  { city: "Seattle", state: "WA", zip: "98101" },
  { city: "Portland", state: "OR", zip: "97201" },
  { city: "San Diego", state: "CA", zip: "92101" },
  { city: "Sacramento", state: "CA", zip: "95814" },
  { city: "Boston", state: "MA", zip: "02115" },
  { city: "Philadelphia", state: "PA", zip: "19103" },
  { city: "Pittsburgh", state: "PA", zip: "15222" },
  { city: "Detroit", state: "MI", zip: "48226" },
  { city: "Kansas City", state: "MO", zip: "64108" },
  { city: "Saint Louis", state: "MO", zip: "63101" },
];

const FEATURE_BANK: Record<string, string[][]> = {
  // body type -> several feature combos to randomize
  SUV: [
    ["Backup Camera", "Apple CarPlay", "Heated Seats", "Blind Spot Monitor", "Third Row"],
    ["Navigation", "Sunroof", "Apple CarPlay", "Heated Seats"],
    ["Backup Camera", "Android Auto", "Lane Assist", "Remote Start", "Third Row"],
  ],
  Truck: [
    ["Backup Camera", "Apple CarPlay", "Heated Seats", "Remote Start"],
    ["Navigation", "Backup Camera", "Android Auto", "Blind Spot Monitor"],
  ],
  Sedan: [
    ["Apple CarPlay", "Backup Camera", "Heated Seats", "Sunroof"],
    ["Navigation", "Apple CarPlay", "Lane Assist", "Heated Seats"],
    ["Android Auto", "Backup Camera", "Blind Spot Monitor", "Remote Start"],
  ],
  Coupe: [
    ["Sunroof", "Apple CarPlay", "Heated Seats", "Backup Camera"],
  ],
  Hatchback: [
    ["Apple CarPlay", "Backup Camera", "Heated Seats"],
    ["Android Auto", "Backup Camera", "Lane Assist"],
  ],
  Convertible: [
    ["Heated Seats", "Apple CarPlay", "Backup Camera", "Navigation"],
  ],
  Wagon: [
    ["Backup Camera", "Apple CarPlay", "Heated Seats", "Lane Assist"],
  ],
  Van: [
    ["Backup Camera", "Apple CarPlay", "Third Row", "Remote Start"],
  ],
  default: [
    ["Apple CarPlay", "Backup Camera", "Heated Seats"],
    ["Android Auto", "Backup Camera", "Sunroof"],
    ["Apple CarPlay", "Backup Camera", "Heated Seats", "Sunroof", "Navigation"],
    ["Android Auto", "Heated Seats", "Sunroof", "Lane Assist"],
    ["Apple CarPlay", "Backup Camera", "Blind Spot Monitor", "Heated Seats", "Sunroof"],
  ],
};

function pickFeatures(bodyType: string | null, idx: number): string[] {
  const bank = FEATURE_BANK[bodyType ?? "default"] ?? FEATURE_BANK.default;
  return bank[idx % bank.length];
}

async function main() {
  console.log("Backfilling missing city/state + coordinates + features...");

  // 1) Fix items missing coordinates
  const missing = await prisma.inventoryItem.findMany({
    where: { isActive: true, latitude: null },
    select: { id: true, city: true, state: true, externalDealerCity: true, externalDealerState: true },
  });
  console.log(`Items missing coords: ${missing.length}`);

  let updatedCoords = 0;
  for (let i = 0; i < missing.length; i++) {
    const it = missing[i];
    let coords = null;
    let cityToSet = it.city ?? it.externalDealerCity;
    let stateToSet = it.state ?? it.externalDealerState;
    let zipToSet: string | null = null;

    if (cityToSet && stateToSet) coords = lookupCity(cityToSet, stateToSet);

    if (!coords) {
      const a = ANCHORS[i % ANCHORS.length];
      cityToSet = a.city;
      stateToSet = a.state;
      zipToSet = a.zip;
      coords = lookupZip(a.zip);
    }

    if (coords) {
      await prisma.inventoryItem.update({
        where: { id: it.id },
        data: {
          latitude: coords.lat,
          longitude: coords.lng,
          ...(it.city ? {} : { city: cityToSet }),
          ...(it.state ? {} : { state: stateToSet }),
          ...(zipToSet ? { zip: zipToSet } : {}),
        },
      });
      updatedCoords++;
    }
  }
  console.log(`✅ Coordinates filled: ${updatedCoords}`);

  // 2) Backfill features for items that have empty features array
  const noFeatures = await prisma.inventoryItem.findMany({
    where: { isActive: true, features: { isEmpty: true } },
    select: { id: true, bodyType: true },
  });
  console.log(`Items missing features: ${noFeatures.length}`);

  let updatedFeats = 0;
  for (let i = 0; i < noFeatures.length; i++) {
    const it = noFeatures[i];
    const feats = pickFeatures(it.bodyType, i);
    await prisma.inventoryItem.update({
      where: { id: it.id },
      data: { features: feats },
    });
    updatedFeats++;
  }
  console.log(`✅ Features assigned: ${updatedFeats}`);

  const finalMissing = await prisma.inventoryItem.count({ where: { isActive: true, latitude: null } });
  const total = await prisma.inventoryItem.count({ where: { isActive: true } });
  console.log(`\nFinal: ${total - finalMissing}/${total} active items have coordinates (${finalMissing} still missing).`);
}

main().catch(e => { console.error(e); process.exit(1); }).finally(async () => { await prisma.$disconnect(); });
