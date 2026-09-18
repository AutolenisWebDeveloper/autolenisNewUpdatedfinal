// §22a / §26 "Shortlisted candidate goes stale or sells mid-auction" — the missing trigger.
//
// The register row had no raise site and `revalidateRequestCandidates` — written in Phase 4
// for exactly this — had no caller, the same shape as `flagSuspectedNoShows` before it. These
// pin the scoping, which is where this can go wrong in both directions: too narrow and a
// buyer bids on a car that is gone, too wide and every closed auction reopens as a queue row.
//
//   npx tsx --test --experimental-test-module-mocks \
//     lib/services/shortlist/__tests__/stale-candidate-mid-auction.test.ts

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

type Rec = Record<string, unknown>;

interface CandidateRow {
  id: string;
  auctionId: string;
  vehicleRequestId: string | null;
  inventoryItemId: string;
  candidateStatus: string;
  auctionStatus: string;
  buyerId: string;
}

let candidates: CandidateRow[];
let raised: Rec[];
/** Candidate ids the REAL `revalidateCandidate` wrote a verdict for. */
let updated: string[];
let findManyWhere: Rec | null;

mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      auctionVehicle: {
        findMany: async ({ where }: { where: Rec }) => {
          findManyWhere = where;
          const ids = ((where.inventoryItemId as Rec)?.in ?? []) as string[];
          const statuses = (((where.auction as Rec)?.status as Rec)?.in ?? []) as string[];
          return candidates
            .filter(
              (c) =>
                ids.includes(c.inventoryItemId) &&
                c.candidateStatus === where.candidateStatus &&
                statuses.includes(c.auctionStatus),
            )
            .map((c) => ({
              id: c.id,
              auctionId: c.auctionId,
              vehicleRequestId: c.vehicleRequestId,
              auction: { buyerId: c.buyerId },
            }));
        },
        // The REAL `revalidateCandidate` reads the candidate here, then its listing below.
        findUnique: async ({ where }: { where: { id: string } }) => {
          const c = candidates.find((row) => row.id === where.id);
          if (!c) return null;
          return {
            id: c.id,
            inventoryItemId: c.inventoryItemId,
            candidateStatus: c.candidateStatus,
            listingSnapshot: {},
            distanceMiles: null,
            auction: { buyerId: c.buyerId },
            vehicleRequest: { buyerId: c.buyerId },
          };
        },
        update: async ({ where, data }: { where: { id: string }; data: Rec }) => {
          updated.push(where.id);
          const c = candidates.find((row) => row.id === where.id);
          if (c && typeof data.candidateStatus === "string") c.candidateStatus = data.candidateStatus;
          return {};
        },
      },
      // The listing is GONE — which is exactly what the stale sweep has just made true for
      // every id it hands this function, and the real code path (`drop("LISTING_GONE")`)
      // rather than a stubbed verdict.
      inventoryItem: { findUnique: async () => null },
      buyer: { findUnique: async () => null },
    },
  },
});

mock.module("@/lib/services/operations/queue-item.service", {
  namedExports: {
    raiseException: async (input: Rec) => { raised.push(input); return { created: true }; },
  },
});
mock.module("@/lib/services/integrations/geocoding.service", { namedExports: { geocodeZip: async () => null } });
mock.module("@/lib/logger", { namedExports: { logger: { error: () => {}, warn: () => {}, info: () => {} } } });

beforeEach(() => {
  candidates = [];
  raised = [];
  updated = [];
  findManyWhere = null;
});

async function svc() {
  return import("../candidate.service");
}

/**
 * A candidate the REAL `revalidateCandidate` will drop.
 *
 * `dropStaleCandidatesMidAuction` calls `revalidateCandidate` in its own module, so it cannot be
 * mocked from outside — and stubbing it would test the stub. The prisma fixture instead makes
 * the listing row absent, which is precisely what the stale sweep has just established about
 * every id it passes in, and the real `drop("LISTING_GONE")` branch runs.
 */
function candidateReturning(id: string, _drop: boolean): CandidateRow {
  return {
    id,
    auctionId: `au_${id}`,
    vehicleRequestId: `vr_${id}`,
    inventoryItemId: `inv_${id}`,
    candidateStatus: "ACTIVE",
    auctionStatus: "ACTIVE",
    buyerId: `b_${id}`,
  };
}

test("an empty id list does no work at all", async () => {
  const { dropStaleCandidatesMidAuction } = await svc();
  assert.deepEqual(await dropStaleCandidatesMidAuction([]), { checked: 0, dropped: 0, raised: 0 });
  assert.equal(findManyWhere, null, "no query is issued for nothing");
});

test("only ACTIVE candidates on a RUNNING auction are considered", async () => {
  candidates = [candidateReturning("c1", true)];
  const { dropStaleCandidatesMidAuction } = await svc();
  await dropStaleCandidatesMidAuction(["inv_c1"]);

  assert.equal(findManyWhere?.candidateStatus, "ACTIVE", "a dropped candidate is already dropped");
  assert.deepEqual(
    ((findManyWhere?.auction as Rec).status as Rec).in,
    ["PENDING", "ACTIVE", "REOPENED"],
    "MID-auction. A candidate going stale on a CLOSED auction is not an exception — the buyer is " +
      "looking at offers, not at listings. PENDING counts because §22a's harm starts at invitation.",
  );
});

test("a candidate whose listing is gone DROPS and raises exactly one §26 row", async () => {
  candidates = [candidateReturning("c1", true)];
  const { dropStaleCandidatesMidAuction } = await svc();
  const out = await dropStaleCandidatesMidAuction(["inv_c1"]);

  assert.equal(out.checked, 1);
  assert.equal(out.dropped, 1);
  assert.equal(out.raised, 1);
  assert.equal(raised.length, 1);
  assert.equal(raised[0]!.code, "CANDIDATE_STALE_MID_AUCTION");
  assert.equal(raised[0]!.auctionId, "au_c1");
  assert.equal(raised[0]!.vehicleRequestId, "vr_c1");
  assert.equal(raised[0]!.buyerId, "b_c1");
  assert.equal(
    raised[0]!.idempotencyKey,
    "CANDIDATE_STALE_MID_AUCTION:c1",
    "keyed per CANDIDATE: a re-observed dead listing finds the open row, a second dead car gets its own",
  );
});

test("§22a — the auction runs on; nothing here touches the other candidates", async () => {
  candidates = [candidateReturning("c1", true), candidateReturning("c2", true)];
  const { dropStaleCandidatesMidAuction } = await svc();
  const out = await dropStaleCandidatesMidAuction(["inv_c1"]);

  assert.equal(out.checked, 1, "only the swept listing's candidate is re-checked");
  assert.equal(raised.length, 1);
  assert.equal(raised[0]!.auctionId, "au_c1");
  assert.deepEqual(updated, ["c1"], "the other buyer's candidate is not written to at all");
  assert.equal(
    candidates.find((c) => c.id === "c2")!.candidateStatus,
    "ACTIVE",
    "§22a: the auction runs on, on its remaining candidates",
  );
});
