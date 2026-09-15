// §25.1 / §13-D38 option C — the two defects a review found in the firewall AFTER Phase 7 merged.
//
// Run with:  npx tsx --test lib/services/deal/__tests__/firewall-revocation-and-consent.test.ts
//
// BOTH ARE PRIVACY DEFECTS AND BOTH LOOKED FINE. The file's own header states the rules each one
// breaks, which is why neither showed up in a read of the diff: the prose was right and the code
// under it was not.
//
//  1. RE-LIFT ERASED THE REVOCATION. `liftIdentityFirewall`'s upsert wrote
//     `update: { state: LIFTED, revokedAt: null, revokedBy: null }`. D38 option C was chosen over
//     option B precisely because B loses the record of what was released and when; a re-lift that
//     nulls the revocation columns loses it just as completely, silently, on the one table that
//     exists to hold §25.2 evidence.
//
//  2. THE TRADE PACKET WAS NOT CONSENT-GATED. `secureHandoffPacket` selected
//     `tradeInSubmissions.shareConsentAt` and never read it, while the co-buyer four lines above
//     WAS gated on its own. A field selected and ignored is worse than an absent one: the query
//     reads as though consent were checked.
//
// These are behaviour tests with an injected `db` rather than scanners — both functions already
// take a `Db` parameter, and the question here is what the code DOES, not which files exist.

import test from "node:test";
import assert from "node:assert/strict";
import {
  liftIdentityFirewall,
  secureHandoffPacket,
  FIREWALL_LIFTED,
} from "../identity-firewall.service";

const AUCTION = "auction-1";
const ROOFTOP = "rooftop-1";
const DEAL = "deal-1";
const DEALER = "dealer-1";

/** The revocation this programme is supposed to be able to prove happened. */
const REVOKED_AT = new Date("2026-09-01T10:00:00.000Z");
const REVOKED_BY = "ops-admin-7";

interface UpsertCall {
  create: Record<string, unknown>;
  update: Record<string, unknown>;
}

/**
 * A `Db` good enough for these two paths. `deal.findUnique` dispatches on the requested selection
 * because `secureHandoffPacket` asks for two different shapes of the same row.
 */
function fakeDb(opts: {
  entry?: Record<string, unknown> | null;
  trade?: Record<string, unknown> | null;
  onUpsert?: (call: UpsertCall) => void;
  onUpdateMany?: (args: Record<string, unknown>) => void;
}) {
  let entry = opts.entry === undefined ? null : opts.entry;
  return {
    deal: {
      findUnique: async (args: { select: Record<string, unknown> }) => {
        if ("buyer" in args.select) {
          return {
            buyer: {
              firstName: "Dana",
              lastName: "Reyes",
              phone: "555-0100",
              address: "1 Main St",
              city: "Austin",
              state: "TX",
              zip: "78701",
              user: { email: "dana@example.com" },
            },
            coBuyer: null,
            tradeInSubmissions: opts.trade === undefined ? [] : opts.trade ? [opts.trade] : [],
          };
        }
        if ("status" in args.select) {
          return {
            status: "DEALER_CONFIRMATION",
            auctionId: AUCTION,
            rooftopId: ROOFTOP,
            dealerId: DEALER,
            offer: { dealerId: DEALER },
          };
        }
        return { auctionId: AUCTION, rooftopId: ROOFTOP, dealerId: DEALER, buyerId: "buyer-1" };
      },
    },
    dealerReaffirmation: {
      findFirst: async () => ({ id: "reaff-1" }),
    },
    identityFirewallEntry: {
      findUnique: async () => entry,
      upsert: async (args: UpsertCall) => {
        opts.onUpsert?.(args);
        entry = { ...(entry ?? {}), ...args.update };
        return entry;
      },
      updateMany: async (args: Record<string, unknown>) => {
        opts.onUpdateMany?.(args);
        entry = { ...(entry ?? {}), ...((args.data as Record<string, unknown>) ?? {}) };
        return { count: 1 };
      },
    },
  } as never;
}

// ─────────────────────────────────────────────────────────────────────────────
// 1 — the revocation survives a re-lift
// ─────────────────────────────────────────────────────────────────────────────

test("a re-lift never nulls revokedAt/revokedBy in the upsert's update branch", async () => {
  const calls: UpsertCall[] = [];
  const db = fakeDb({
    entry: {
      description: "Released at Stage 10 reaffirmation.",
      state: FIREWALL_LIFTED,
      revokedAt: REVOKED_AT,
      revokedBy: REVOKED_BY,
    },
    onUpsert: (c) => calls.push(c),
  });

  await liftIdentityFirewall({ dealId: DEAL, actorId: "dealer-user-9" }, db);

  assert.equal(calls.length, 1, "the lift must still upsert the ledger row");
  const update = calls[0]!.update;
  assert.equal(
    "revokedAt" in update && update.revokedAt === null,
    false,
    "the update branch set revokedAt to null — that is the D38 option C evidence being erased",
  );
  assert.equal(
    "revokedBy" in update && update.revokedBy === null,
    false,
    "the update branch set revokedBy to null — who ended the release is part of the same record",
  );
});

test("a re-lift after a revocation keeps the ended release on the row and re-opens visibility", async () => {
  const seen: Array<Record<string, unknown>> = [];
  const db = fakeDb({
    entry: {
      description: "Released at Stage 10 reaffirmation.",
      state: FIREWALL_LIFTED,
      revokedAt: REVOKED_AT,
      revokedBy: REVOKED_BY,
    },
    onUpdateMany: (args) => seen.push(args),
  });

  await liftIdentityFirewall({ dealId: DEAL, actorId: "dealer-user-9" }, db);

  assert.equal(seen.length, 1, "clearing a revocation must be its own conditional write, not a blind upsert field");
  const data = seen[0]!.data as Record<string, unknown>;
  assert.equal(data.revokedAt, null, "the NEW release is live, so the live revocation pointer clears");
  assert.equal(data.revokedBy, null);
  const description = String(data.description ?? "");
  assert.match(
    description,
    /2026-09-01T10:00:00\.000Z/,
    "the ended release's timestamp must be archived onto the row before the pointer clears",
  );
  assert.match(description, /ops-admin-7/, "and who ended it");
  assert.match(
    description,
    /Released at Stage 10 reaffirmation\./,
    "appending, not overwriting — the original description is the first release's record",
  );

  const where = seen[0]!.where as Record<string, unknown>;
  assert.equal(
    where.revokedAt,
    REVOKED_AT,
    "compare-and-swap on the timestamp read, so a revocation landing in between is not swallowed",
  );
});

test("a lift on a row that was never revoked writes no archive line", async () => {
  const seen: Array<Record<string, unknown>> = [];
  const db = fakeDb({
    entry: { description: "Released at Stage 10 reaffirmation.", state: FIREWALL_LIFTED, revokedAt: null, revokedBy: null },
    onUpdateMany: (args) => seen.push(args),
  });

  await liftIdentityFirewall({ dealId: DEAL, actorId: "dealer-user-9" }, db);

  assert.equal(seen.length, 0, "idempotent re-confirm must not grow the description on every press");
});

// ─────────────────────────────────────────────────────────────────────────────
// 2 — the trade packet is gated on the buyer's consent
// ─────────────────────────────────────────────────────────────────────────────

const TRADE = {
  year: 2019,
  make: "Honda",
  model: "Accord",
  trim: "EX-L",
  mileage: 61_000,
  vin: "1HGCV1F30KA000000",
  lienholderName: "Some Credit Union",
  payoffGoodThroughDate: new Date("2026-10-01T00:00:00.000Z"),
  verifiedPayoffCents: 1_450_000,
  titleInHand: true,
  titleState: "TX",
  hasSecondKey: true,
  photoUrls: ["https://example.com/a.jpg"],
};

test("a trade with recorded consent travels with the handoff", async () => {
  const db = fakeDb({
    entry: { state: FIREWALL_LIFTED, revokedAt: null },
    trade: { ...TRADE, shareConsentAt: new Date("2026-08-20T09:00:00.000Z") },
  });
  const packet = await secureHandoffPacket(DEAL, DEALER, db);
  assert.ok(packet, "the firewall is open, so the packet exists");
  assert.ok(packet!.trade, "consent was recorded — withholding here would remove a capability");
  assert.equal(packet!.trade!.vin, TRADE.vin);
  assert.equal(packet!.trade!.verifiedPayoffCents, TRADE.verifiedPayoffCents);
});

test("a trade with NO recorded consent is withheld — the defect this file exists for", async () => {
  const db = fakeDb({
    entry: { state: FIREWALL_LIFTED, revokedAt: null },
    trade: { ...TRADE, shareConsentAt: null },
  });
  const packet = await secureHandoffPacket(DEAL, DEALER, db);
  assert.ok(packet, "the buyer's own identity is still released — the firewall is open");
  assert.equal(
    packet!.trade,
    null,
    "the VIN, the lienholder and the verified payoff of a car nobody consented to share must not ship",
  );
});

test("withholding the trade does not withhold the buyer — one missing consent is not a closed firewall", async () => {
  const db = fakeDb({
    entry: { state: FIREWALL_LIFTED, revokedAt: null },
    trade: { ...TRADE, shareConsentAt: null },
  });
  const packet = await secureHandoffPacket(DEAL, DEALER, db);
  assert.equal(packet!.buyer.email, "dana@example.com");
  assert.equal(packet!.trade, null);
});
