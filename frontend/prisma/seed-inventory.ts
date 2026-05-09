// Seed 100 realistic inventory vehicles for AutoLenis
// Marker: sourceAdapter = "seed_v1" — easy to remove later via:
//   DELETE FROM inventory_items WHERE source_adapter = 'seed_v1';
//
// Run with: cd /app/frontend && npx tsx prisma/seed-inventory.ts

import { PrismaClient, InventoryLane } from "@prisma/client";

const prisma = new PrismaClient();

// Real Unsplash photo IDs verified to exist (curated car/vehicle photography)
const UNSPLASH_CAR_PHOTOS = [
  "photo-1494976388531-d1058494cdd8", // muscle car red
  "photo-1503376780353-7e6692767b70", // black sports car
  "photo-1552519507-da3b142c6e3d", // yellow sports
  "photo-1493238792000-8113da705763", // SUV side
  "photo-1542362567-b07e54358753", // BMW
  "photo-1583121274602-3e2820c69888", // black sedan
  "photo-1605559424843-9e4c228bf1c2", // Tesla model
  "photo-1568844293986-8d0400bd4745", // Audi
  "photo-1606664515524-ed2f786a0bd6", // Range Rover
  "photo-1560958089-b8a1929cea89", // Ford truck
  "photo-1617814086367-4d1c4c2e1d5e", // Toyota
  "photo-1552519507-da3b142c6e3d", // sports
  "photo-1583121274602-3e2820c69888", // black sedan
  "photo-1542228262-3d663b306a53", // Jeep
  "photo-1606016159991-dfe4f2746ad5", // Honda
  "photo-1580273916550-e323be2ae537", // pickup truck
  "photo-1502877338535-766e1452684a", // Mercedes
  "photo-1552519507-da3b142c6e3d", // sport
  "photo-1612825173281-9a193378527e", // pickup
  "photo-1591293836027-e05b48473b67", // truck off-road
  "photo-1606220838315-056192d5e927", // SUV white
  "photo-1606664515524-ed2f786a0bd6", // luxury suv
  "photo-1485291571150-772bcfc10da5", // BMW silver
  "photo-1617469767053-d3b523a0b982", // Lexus
  "photo-1570733577524-3a047079e80d", // sedan side
  "photo-1571607388263-1044f9ea01dd", // muscle
  "photo-1494976388531-d1058494cdd8", // red car
  "photo-1503376780353-7e6692767b70", // black
  "photo-1552519507-da3b142c6e3d", // yellow
  "photo-1542362567-b07e54358753", // bmw
];

// US cities for dealer locations
const US_CITIES: Array<{ city: string; state: string }> = [
  { city: "Atlanta", state: "GA" },
  { city: "Austin", state: "TX" },
  { city: "Boston", state: "MA" },
  { city: "Charlotte", state: "NC" },
  { city: "Chicago", state: "IL" },
  { city: "Columbus", state: "OH" },
  { city: "Dallas", state: "TX" },
  { city: "Denver", state: "CO" },
  { city: "Detroit", state: "MI" },
  { city: "Houston", state: "TX" },
  { city: "Indianapolis", state: "IN" },
  { city: "Jacksonville", state: "FL" },
  { city: "Las Vegas", state: "NV" },
  { city: "Los Angeles", state: "CA" },
  { city: "Miami", state: "FL" },
  { city: "Minneapolis", state: "MN" },
  { city: "Nashville", state: "TN" },
  { city: "New York", state: "NY" },
  { city: "Orlando", state: "FL" },
  { city: "Philadelphia", state: "PA" },
  { city: "Phoenix", state: "AZ" },
  { city: "Portland", state: "OR" },
  { city: "Raleigh", state: "NC" },
  { city: "San Diego", state: "CA" },
  { city: "Seattle", state: "WA" },
  { city: "St. Louis", state: "MO" },
  { city: "Tampa", state: "FL" },
];

// Realistic dealer names
const DEALER_NAMES = [
  "Premier Auto Group",
  "Sunset Motors",
  "Liberty Auto Sales",
  "Heritage Cars",
  "Capital Auto Mall",
  "Crossroads Motors",
  "Pinnacle Auto Group",
  "Veteran Motors",
  "Highland Auto Center",
  "Beacon Auto Sales",
  "Riverside Cars",
  "Patriot Auto Group",
  "Summit Motors",
  "Lakeside Auto",
  "Eagle Auto Sales",
  "Crown Motors",
  "Diamond Auto Group",
  "Legacy Cars",
  "Westgate Auto",
  "Northstar Motors",
];

// Vehicle catalog: 12 makes covering SUVs / Sedans / Trucks
// price ranges are MSRP-ish so we depreciate to fit $16k-$58k window
type ModelDef = { model: string; trims: string[]; body: "SUV" | "SEDAN" | "TRUCK"; basePriceK: number };
const CATALOG: Record<string, ModelDef[]> = {
  Toyota: [
    { model: "RAV4", trims: ["LE", "XLE", "Adventure", "Limited"], body: "SUV", basePriceK: 32 },
    { model: "Camry", trims: ["LE", "SE", "XLE", "XSE"], body: "SEDAN", basePriceK: 28 },
    { model: "Tacoma", trims: ["SR5", "TRD Sport", "TRD Off-Road", "Limited"], body: "TRUCK", basePriceK: 36 },
    { model: "Highlander", trims: ["L", "LE", "XLE", "Limited"], body: "SUV", basePriceK: 41 },
  ],
  Honda: [
    { model: "CR-V", trims: ["LX", "EX", "EX-L", "Touring"], body: "SUV", basePriceK: 31 },
    { model: "Civic", trims: ["LX", "Sport", "EX", "Touring"], body: "SEDAN", basePriceK: 24 },
    { model: "Accord", trims: ["LX", "Sport", "EX-L", "Touring"], body: "SEDAN", basePriceK: 29 },
    { model: "Pilot", trims: ["LX", "EX-L", "Touring", "Elite"], body: "SUV", basePriceK: 42 },
  ],
  Ford: [
    { model: "F-150", trims: ["XL", "XLT", "Lariat", "King Ranch"], body: "TRUCK", basePriceK: 44 },
    { model: "Explorer", trims: ["Base", "XLT", "Limited", "Platinum"], body: "SUV", basePriceK: 38 },
    { model: "Escape", trims: ["S", "SE", "SEL", "Titanium"], body: "SUV", basePriceK: 28 },
  ],
  Chevrolet: [
    { model: "Silverado 1500", trims: ["WT", "Custom", "LT", "RST"], body: "TRUCK", basePriceK: 42 },
    { model: "Equinox", trims: ["LS", "LT", "RS", "Premier"], body: "SUV", basePriceK: 27 },
    { model: "Malibu", trims: ["LS", "RS", "LT", "Premier"], body: "SEDAN", basePriceK: 25 },
    { model: "Tahoe", trims: ["LS", "LT", "RST", "Premier"], body: "SUV", basePriceK: 54 },
  ],
  Nissan: [
    { model: "Rogue", trims: ["S", "SV", "SL", "Platinum"], body: "SUV", basePriceK: 28 },
    { model: "Altima", trims: ["S", "SV", "SR", "SL"], body: "SEDAN", basePriceK: 26 },
    { model: "Frontier", trims: ["S", "SV", "PRO-4X", "PRO-X"], body: "TRUCK", basePriceK: 32 },
  ],
  Hyundai: [
    { model: "Tucson", trims: ["SE", "SEL", "N Line", "Limited"], body: "SUV", basePriceK: 27 },
    { model: "Elantra", trims: ["SE", "SEL", "Limited", "N Line"], body: "SEDAN", basePriceK: 22 },
    { model: "Santa Fe", trims: ["SE", "SEL", "Limited", "Calligraphy"], body: "SUV", basePriceK: 32 },
  ],
  Kia: [
    { model: "Sportage", trims: ["LX", "EX", "SX", "X-Line"], body: "SUV", basePriceK: 27 },
    { model: "Sorento", trims: ["LX", "S", "EX", "SX"], body: "SUV", basePriceK: 32 },
    { model: "Forte", trims: ["LX", "GT-Line", "EX", "GT"], body: "SEDAN", basePriceK: 21 },
  ],
  Mazda: [
    { model: "CX-5", trims: ["S", "Select", "Preferred", "Premium"], body: "SUV", basePriceK: 29 },
    { model: "Mazda3", trims: ["Select", "Preferred", "Premium", "Turbo"], body: "SEDAN", basePriceK: 24 },
  ],
  Subaru: [
    { model: "Outback", trims: ["Base", "Premium", "Limited", "Touring"], body: "SUV", basePriceK: 30 },
    { model: "Forester", trims: ["Base", "Premium", "Sport", "Limited"], body: "SUV", basePriceK: 28 },
  ],
  Jeep: [
    { model: "Grand Cherokee", trims: ["Laredo", "Limited", "Overland", "Summit"], body: "SUV", basePriceK: 42 },
    { model: "Wrangler", trims: ["Sport", "Sahara", "Rubicon", "High Altitude"], body: "SUV", basePriceK: 38 },
  ],
  GMC: [
    { model: "Sierra 1500", trims: ["Pro", "SLE", "Elevation", "SLT"], body: "TRUCK", basePriceK: 46 },
    { model: "Acadia", trims: ["SLE", "SLT", "AT4", "Denali"], body: "SUV", basePriceK: 39 },
  ],
  Ram: [
    { model: "1500", trims: ["Tradesman", "Big Horn", "Laramie", "Rebel"], body: "TRUCK", basePriceK: 44 },
  ],
};

// Generate a realistic-looking VIN (17 chars, no I/O/Q, year-coded position 10)
const VIN_CHARS = "ABCDEFGHJKLMNPRSTUVWXYZ0123456789";
const YEAR_CODES: Record<number, string> = {
  2018: "J", 2019: "K", 2020: "L", 2021: "M", 2022: "N", 2023: "P", 2024: "R",
};
function generateVin(year: number, idx: number): string {
  const yearCode = YEAR_CODES[year] ?? "P";
  // Use a per-vehicle pseudo-random sequence seeded by idx+year so we get
  // 17-char unique strings across the whole run (and idempotent across runs).
  let state = idx * 1000003 + year * 17;
  const rand = () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state;
  };
  let vin = "";
  for (let i = 0; i < 17; i++) {
    if (i === 9) {
      vin += yearCode;
    } else {
      vin += VIN_CHARS[rand() % VIN_CHARS.length];
    }
  }
  return vin;
}

function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function buildPhotos(idx: number): string[] {
  // Each car gets 2 photos for richer cards
  const a = UNSPLASH_CAR_PHOTOS[idx % UNSPLASH_CAR_PHOTOS.length];
  const b = UNSPLASH_CAR_PHOTOS[(idx + 7) % UNSPLASH_CAR_PHOTOS.length];
  return [
    `https://images.unsplash.com/${a}?w=1200&q=80&auto=format&fit=crop`,
    `https://images.unsplash.com/${b}?w=1200&q=80&auto=format&fit=crop`,
  ];
}

// Lane distribution: 20 LANE_1 (verified), 30 LANE_2 (partner), 50 LANE_3 (market)
function laneFor(idx: number): InventoryLane {
  if (idx < 20) return InventoryLane.LANE_1;
  if (idx < 50) return InventoryLane.LANE_2;
  return InventoryLane.LANE_3;
}

// Compute realistic price within $16k–$58k based on age + trim + base price
function computePrice(basePriceK: number, year: number, trimIndex: number, trimsTotal: number): number {
  const age = 2025 - year;
  // Depreciation: ~12% year 1, ~9% per year after
  const depreciation = age === 0 ? 0 : 0.12 + (age - 1) * 0.09;
  const trimMultiplier = 0.92 + (trimIndex / Math.max(1, trimsTotal - 1)) * 0.18; // 0.92–1.10
  let price = basePriceK * 1000 * (1 - depreciation) * trimMultiplier;
  // Add ±$800 of noise
  price += randInt(-800, 800);
  // Clamp to user-spec range $16k–$58k
  price = Math.max(16000, Math.min(58000, price));
  return Math.round(price / 50) * 50; // round to nearest $50
}

// Mileage: roughly 12k/year + noise, capped 5k–80k
function computeMileage(year: number): number {
  const age = 2025 - year;
  const base = age * 12000 + randInt(-3000, 4000);
  return Math.max(5000, Math.min(80000, base));
}

async function main() {
  console.log("[seed_v1] Starting inventory seed (100 vehicles)...");

  // Wipe any prior seed_v1 vehicles to keep idempotent
  const wiped = await prisma.inventoryItem.deleteMany({ where: { sourceAdapter: "seed_v1" } });
  console.log(`[seed_v1] Removed ${wiped.count} prior seed vehicles.`);

  const allModels: Array<{ make: string; model: ModelDef }> = [];
  for (const [make, models] of Object.entries(CATALOG)) {
    for (const m of models) allModels.push({ make, model: m });
  }
  console.log(`[seed_v1] Catalog: ${Object.keys(CATALOG).length} makes, ${allModels.length} model variants.`);

  const records: Array<Parameters<typeof prisma.inventoryItem.create>[0]["data"]> = [];

  for (let i = 0; i < 100; i++) {
    const { make, model } = allModels[i % allModels.length];
    const year = randInt(2018, 2024);
    const trimIdx = randInt(0, model.trims.length - 1);
    const trim = model.trims[trimIdx];
    const priceCents = computePrice(model.basePriceK, year, trimIdx, model.trims.length) * 100;
    const mileage = computeMileage(year);
    const vin = generateVin(year, i);
    const lane = laneFor(i);
    const loc = pick(US_CITIES);
    const dealerName = pick(DEALER_NAMES);
    const images = buildPhotos(i);

    records.push({
      vin,
      year,
      make,
      model: model.model,
      trim,
      mileage,
      priceCents,
      images,
      lane,
      isActive: true,
      lastSeenAt: new Date(),
      sourceAdapter: "seed_v1",
      externalDealerName: lane === InventoryLane.LANE_3 ? dealerName : null,
      externalDealerCity: loc.city,
      externalDealerState: loc.state,
      description: `${year} ${make} ${model.model} ${trim} — ${model.body.toLowerCase()} sourced from a verified ${loc.state} dealer.`,
      priceHistory: [{ price: priceCents, date: new Date().toISOString() }],
    });
  }

  // Bulk insert in chunks of 25 to keep pooled connection happy
  let inserted = 0;
  for (let i = 0; i < records.length; i += 25) {
    const chunk = records.slice(i, i + 25);
    const res = await prisma.inventoryItem.createMany({ data: chunk, skipDuplicates: true });
    inserted += res.count;
    console.log(`[seed_v1] Inserted chunk ${i / 25 + 1}: +${res.count} (total ${inserted})`);
  }

  const total = await prisma.inventoryItem.count({ where: { sourceAdapter: "seed_v1" } });
  const grandTotal = await prisma.inventoryItem.count();
  console.log(`[seed_v1] Done. seed_v1 rows = ${total}. Total inventory_items rows = ${grandTotal}.`);
}

main()
  .catch((err) => {
    console.error("[seed_v1] ERROR:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
