// AMIPS Phase 0 — Vehicle Intelligence seed.
//
// Populates the top 20 highest-volume makes/models with real MSRP data
// taken from manufacturer public websites (2025 model year). Fair-market
// pricing is computed deterministically from MSRP so every published page
// can trace its price claims back to a real, sourced number:
//
//   fairMarketLow  = MSRP * 0.97   (3% below MSRP)
//   fairMarketHigh = MSRP * 0.93   (7% below MSRP)
//   aggressiveTarget = MSRP * 0.90 (10% below MSRP)
//
// The seed is idempotent — it upserts on (make, model, trim, year), so it is
// safe to run repeatedly. All MSRP figures are stored in cents.

import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";

export type NegotiationDifficulty = "easy" | "moderate" | "hard";

export interface VehicleSeed {
  make: string;
  model: string;
  trim: string;
  year: number;
  msrpCents: number;
  negotiationDifficulty: NegotiationDifficulty;
}

const SEED_YEAR = 2025;

// Convert a dollar MSRP to integer cents.
const usd = (dollars: number): number => Math.round(dollars * 100);

// Top 20 highest-volume makes/models. MSRP from manufacturer public sites.
export const VEHICLE_SEEDS: VehicleSeed[] = [
  // TRUCKS — high transaction value, seeded first.
  { make: "Ford", model: "F-150", trim: "XL", year: SEED_YEAR, msrpCents: usd(36730), negotiationDifficulty: "hard" },
  { make: "Ford", model: "F-150", trim: "XLT", year: SEED_YEAR, msrpCents: usd(42360), negotiationDifficulty: "hard" },
  { make: "Chevrolet", model: "Silverado 1500", trim: "LT", year: SEED_YEAR, msrpCents: usd(41900), negotiationDifficulty: "moderate" },
  { make: "Ram", model: "1500", trim: "Big Horn", year: SEED_YEAR, msrpCents: usd(41385), negotiationDifficulty: "moderate" },
  { make: "Toyota", model: "Tacoma", trim: "SR5", year: SEED_YEAR, msrpCents: usd(34500), negotiationDifficulty: "hard" },
  { make: "GMC", model: "Sierra 1500", trim: "SLE", year: SEED_YEAR, msrpCents: usd(43700), negotiationDifficulty: "moderate" },

  // SUVs — highest volume.
  { make: "Toyota", model: "RAV4", trim: "LE", year: SEED_YEAR, msrpCents: usd(30975), negotiationDifficulty: "hard" },
  { make: "Honda", model: "CR-V", trim: "LX", year: SEED_YEAR, msrpCents: usd(31895), negotiationDifficulty: "moderate" },
  { make: "Toyota", model: "Highlander", trim: "LE", year: SEED_YEAR, msrpCents: usd(40120), negotiationDifficulty: "moderate" },
  { make: "Ford", model: "Explorer", trim: "Base", year: SEED_YEAR, msrpCents: usd(38855), negotiationDifficulty: "easy" },
  { make: "Chevrolet", model: "Equinox", trim: "LT", year: SEED_YEAR, msrpCents: usd(30995), negotiationDifficulty: "easy" },
  { make: "Kia", model: "Telluride", trim: "LX", year: SEED_YEAR, msrpCents: usd(37290), negotiationDifficulty: "hard" },
  { make: "Hyundai", model: "Palisade", trim: "SE", year: SEED_YEAR, msrpCents: usd(37800), negotiationDifficulty: "moderate" },
  { make: "Jeep", model: "Grand Cherokee L", trim: "Laredo", year: SEED_YEAR, msrpCents: usd(44000), negotiationDifficulty: "moderate" },

  // SEDANS.
  { make: "Toyota", model: "Camry", trim: "LE", year: SEED_YEAR, msrpCents: usd(28400), negotiationDifficulty: "hard" },
  { make: "Honda", model: "Accord", trim: "LX", year: SEED_YEAR, msrpCents: usd(30895), negotiationDifficulty: "moderate" },
  { make: "Honda", model: "Civic", trim: "LX", year: SEED_YEAR, msrpCents: usd(24350), negotiationDifficulty: "moderate" },
  { make: "Toyota", model: "Corolla", trim: "LE", year: SEED_YEAR, msrpCents: usd(22825), negotiationDifficulty: "easy" },

  // ELECTRIC.
  { make: "Tesla", model: "Model Y", trim: "RWD", year: SEED_YEAR, msrpCents: usd(44990), negotiationDifficulty: "hard" },

  // LUXURY.
  { make: "Lexus", model: "RX 350", trim: "Base", year: SEED_YEAR, msrpCents: usd(50900), negotiationDifficulty: "moderate" },
];

// Compute fair-market pricing from MSRP. Pure function — used by the seed and
// available for tests.
export function computeFairMarket(msrpCents: number): {
  fairMarketLowCents: number;
  fairMarketHighCents: number;
  aggressiveTargetCents: number;
} {
  return {
    fairMarketLowCents: Math.round(msrpCents * 0.97), // 3% below MSRP
    fairMarketHighCents: Math.round(msrpCents * 0.93), // 7% below MSRP
    aggressiveTargetCents: Math.round(msrpCents * 0.9), // 10% below MSRP
  };
}

/**
 * Seed Vehicle Intelligence for the top 20 makes/models.
 * Idempotent: upserts on (make, model, trim, year).
 */
export async function seedVehicleIntelligence(): Promise<{
  upserted: number;
}> {
  logger.info(
    `[amips-seed] vehicle-intelligence: seeding ${VEHICLE_SEEDS.length} vehicles (MY ${SEED_YEAR})`,
  );

  let upserted = 0;

  for (const v of VEHICLE_SEEDS) {
    const pricing = computeFairMarket(v.msrpCents);

    await prisma.vehicleIntelligence.upsert({
      where: {
        make_model_trim_year: {
          make: v.make,
          model: v.model,
          trim: v.trim,
          year: v.year,
        },
      },
      create: {
        make: v.make,
        model: v.model,
        trim: v.trim,
        year: v.year,
        msrpCents: v.msrpCents,
        ...pricing,
        negotiationDifficulty: v.negotiationDifficulty,
        dataSource: "manufacturer_msrp_public",
      },
      update: {
        msrpCents: v.msrpCents,
        ...pricing,
        negotiationDifficulty: v.negotiationDifficulty,
        dataSource: "manufacturer_msrp_public",
        lastUpdated: new Date(),
      },
    });

    upserted += 1;
    logger.info(
      `[amips-seed] vehicle-intelligence: upserted ${v.make} ${v.model} ${v.trim} (${v.year}) — MSRP $${(v.msrpCents / 100).toLocaleString()}`,
    );
  }

  logger.info(
    `[amips-seed] vehicle-intelligence: done — ${upserted} vehicles upserted`,
  );

  return { upserted };
}
