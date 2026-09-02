// Inventory market configuration — the geography the aggregator is queried with.
//
// Written failing-first against the production defect: MarketCheck was queried
// with a hardcoded `params.zip ?? "10001"` (Manhattan) in
// adapters/marketcheck.adapter.ts, while both sync crons called
// runInventorySync({}) with no params. The catalogue came out 93% New York for a
// business serving Dallas-Fort Worth.
//
//   npx tsx --test lib/services/inventory/__tests__/market-config.test.ts

import test, { describe, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  ENV_MARKET_ZIP,
  ENV_MARKET_RADIUS,
  ENV_MARKET_LABEL,
  DEFAULT_RADIUS_MILES,
  resolveMarket,
  type MarketConfigRow,
  type MarketEnv,
} from "@/lib/services/inventory/market-config";

const EMPTY_ENV: MarketEnv = {};

const DFW_ROW: MarketConfigRow = {
  marketLabel: "Dallas-Fort Worth",
  marketZip: "75201",
  marketLat: null,
  marketLng: null,
  marketRadiusMiles: 75,
  marketMakes: [],
  marketPriceMaxCents: null,
  marketYearMin: null,
  marketYearMax: null,
};

afterEach(() => {
  delete process.env[ENV_MARKET_ZIP];
  delete process.env[ENV_MARKET_RADIUS];
  delete process.env[ENV_MARKET_LABEL];
});

describe("no compiled-in default market", () => {
  test("REGRESSION: nothing configured resolves to NOT configured — never ZIP 10001", () => {
    const r = resolveMarket({}, null, EMPTY_ENV);
    assert.equal(r.configured, false, "an unconfigured deployment must not silently sync a market");
    assert.equal(r.origin, "none");
    assert.equal(r.params.zip, undefined, "10001 (Manhattan) must not survive anywhere as a fallback");
  });

  test("REGRESSION: the literal 10001 fallback is gone from the resolved params", () => {
    const r = resolveMarket({}, null, EMPTY_ENV);
    assert.notEqual(r.params.zip, "10001");
  });
});

describe("resolution order: explicit > source row > env", () => {
  test("an explicit param wins over the source row and env", () => {
    const r = resolveMarket({ zip: "78701", radius: 25 }, DFW_ROW, { [ENV_MARKET_ZIP]: "30301" });
    assert.equal(r.params.zip, "78701");
    assert.equal(r.params.radius, 25);
    assert.equal(r.origin, "explicit");
    assert.equal(r.configured, true);
  });

  test("the source row wins over env", () => {
    const r = resolveMarket({}, DFW_ROW, { [ENV_MARKET_ZIP]: "30301", [ENV_MARKET_RADIUS]: "10" });
    assert.equal(r.params.zip, "75201");
    assert.equal(r.params.radius, 75);
    assert.equal(r.label, "Dallas-Fort Worth");
    assert.equal(r.origin, "source");
  });

  test("env is used when the source row carries no market config", () => {
    const r = resolveMarket({}, { ...DFW_ROW, marketZip: null, marketRadiusMiles: null, marketLabel: null }, {
      [ENV_MARKET_ZIP]: "76102",
      [ENV_MARKET_RADIUS]: "60",
      [ENV_MARKET_LABEL]: "Fort Worth",
    });
    assert.equal(r.params.zip, "76102");
    assert.equal(r.params.radius, 60);
    assert.equal(r.label, "Fort Worth");
    assert.equal(r.origin, "env");
    assert.equal(r.configured, true);
  });

  test("env works with NO source row at all — the pre-migration path", () => {
    // The market columns do not exist until the owner applies the migration.
    // Setting one Vercel env var must be enough to re-point the market.
    const r = resolveMarket({}, null, { [ENV_MARKET_ZIP]: "75201" });
    assert.equal(r.configured, true);
    assert.equal(r.params.zip, "75201");
    assert.equal(r.params.radius, DEFAULT_RADIUS_MILES);
    assert.equal(r.origin, "env");
  });
});

describe("centre may be a postal code or explicit coordinates", () => {
  test("lat/lng on the source row is a valid centre without a zip", () => {
    const r = resolveMarket({}, { ...DFW_ROW, marketZip: null, marketLat: 32.7767, marketLng: -96.797 }, EMPTY_ENV);
    assert.equal(r.configured, true);
    assert.equal(r.params.lat, 32.7767);
    assert.equal(r.params.lng, -96.797);
  });

  test("a half-specified coordinate pair is not a centre", () => {
    const r = resolveMarket({}, { ...DFW_ROW, marketZip: null, marketLat: 32.7767, marketLng: null }, EMPTY_ENV);
    assert.equal(r.configured, false, "lat without lng cannot centre a radius search");
  });
});

describe("optional filters", () => {
  test("makes, price ceiling and year range flow through from the source row", () => {
    const r = resolveMarket({}, {
      ...DFW_ROW,
      marketMakes: ["Toyota", "Honda"],
      marketPriceMaxCents: 4_500_000,
      marketYearMin: 2019,
      marketYearMax: 2025,
    }, EMPTY_ENV);
    assert.deepEqual(r.params.makes, ["Toyota", "Honda"]);
    assert.equal(r.params.priceMax, 45_000, "priceMax is dollars for the provider; cents are the stored unit");
    assert.equal(r.params.yearMin, 2019);
    assert.equal(r.params.yearMax, 2025);
  });

  test("an empty makes array is not a filter", () => {
    const r = resolveMarket({}, DFW_ROW, EMPTY_ENV);
    assert.equal(r.params.makes, undefined);
  });
});

describe("input hygiene", () => {
  test("blank and whitespace env values are treated as unset", () => {
    const r = resolveMarket({}, null, { [ENV_MARKET_ZIP]: "   " });
    assert.equal(r.configured, false);
  });

  test("a non-numeric radius env value falls back to the default rather than NaN", () => {
    const r = resolveMarket({}, null, { [ENV_MARKET_ZIP]: "75201", [ENV_MARKET_RADIUS]: "not-a-number" });
    assert.equal(r.params.radius, DEFAULT_RADIUS_MILES);
  });

  test("a non-positive radius falls back to the default", () => {
    const r = resolveMarket({}, null, { [ENV_MARKET_ZIP]: "75201", [ENV_MARKET_RADIUS]: "0" });
    assert.equal(r.params.radius, DEFAULT_RADIUS_MILES);
  });

  test("the zip is trimmed", () => {
    const r = resolveMarket({}, null, { [ENV_MARKET_ZIP]: " 75201 " });
    assert.equal(r.params.zip, "75201");
  });
});

describe("explicit params win field by field, not only for the centre", () => {
  test("an explicit radius survives a centre supplied by the source row", () => {
    const r = resolveMarket({ radius: 25 }, DFW_ROW, EMPTY_ENV);
    assert.equal(r.params.zip, "75201", "the centre still comes from the row");
    assert.equal(r.params.radius, 25, "the caller's radius must not be overwritten by the row's 75");
    assert.equal(r.origin, "source", "origin names the layer that supplied the CENTRE");
  });

  test("an explicit radius survives a centre supplied by env", () => {
    const r = resolveMarket({ radius: 10 }, null, { [ENV_MARKET_ZIP]: "75201", [ENV_MARKET_RADIUS]: "75" });
    assert.equal(r.params.radius, 10);
  });

  test("an explicit price ceiling and make list are not replaced by the row's filters", () => {
    const row = { ...DFW_ROW, marketMakes: ["Toyota"], marketPriceMaxCents: 4_500_000 };
    const r = resolveMarket({ makes: ["Ford"], priceMax: 20_000 }, row, EMPTY_ENV);
    assert.deepEqual(r.params.makes, ["Ford"]);
    assert.equal(r.params.priceMax, 20_000);
  });

  test("the row still supplies filters the caller omitted", () => {
    const row = { ...DFW_ROW, marketMakes: ["Toyota"], marketPriceMaxCents: 4_500_000 };
    const r = resolveMarket({ makes: ["Ford"] }, row, EMPTY_ENV);
    assert.deepEqual(r.params.makes, ["Ford"]);
    assert.equal(r.params.priceMax, 45_000, "priceMax was not stated by the caller, so the row supplies it");
  });
});
