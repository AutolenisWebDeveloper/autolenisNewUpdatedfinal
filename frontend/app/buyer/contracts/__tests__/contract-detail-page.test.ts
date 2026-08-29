// /buyer/contracts/[contractId] — the contract detail page's deal lookup.
//
// THE DEFECT
// ----------
// The page took its contractId from the route and then ignored it in the query:
//
//   const deal = await prisma.deal.findFirst({
//     where: { buyerId: buyer.id },          // ← no id filter
//     orderBy: { createdAt: "desc" },        // ← always the NEWEST deal
//   });
//   if (!deal || deal.id !== contractId) notFound();
//
// So the query fetched whichever deal happened to be newest and then compared
// it to the one that was asked for. For a buyer with a single deal those always
// coincide and the page works. For a buyer with two or more, every contract
// except the most recent 404s — including the links the buyer's own
// /buyer/contracts list renders, which maps over ALL their deals.
//
// Ownership was never at risk (the mismatch can only under-serve, never leak
// another buyer's deal), so this is a dead end rather than a hole: a valid link
// on their own page that cannot be opened.
//
// THE RULE
// --------
// Ask the database for the deal that was actually requested, scoped to the
// buyer: `where: { id: contractId, buyerId: buyer.id }`. Ownership then lives in
// the query rather than in a post-hoc comparison, and no ordering is involved
// because the id is unique.
//
// Run with:
//   npx tsx --test --experimental-test-module-mocks \
//     "app/buyer/contracts/__tests__/contract-detail-page.test.ts"

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

const BUYER = "buyer_1";
const OTHER_BUYER = "buyer_2";

class NotFoundSignal extends Error {
  constructor() { super("NEXT_NOT_FOUND"); this.name = "NotFoundSignal"; }
}

interface DealRow {
  id: string;
  buyerId: string;
  createdAt: Date;
  status: string;
  contractScans: unknown[];
  eSignEnvelope: null;
  offer: null;
  vehicleRequestOffer: null;
}

function deal(id: string, buyerId: string, createdAt: string): DealRow {
  return {
    id, buyerId, createdAt: new Date(createdAt),
    status: "CONTRACT_REVIEW",
    contractScans: [], eSignEnvelope: null, offer: null, vehicleRequestOffer: null,
  };
}

// Two deals for the same buyer — the realistic shape, and the one the old query
// could not serve. Plus one belonging to somebody else.
const DEALS: DealRow[] = [
  deal("deal_old", BUYER, "2026-01-01T00:00:00Z"),
  deal("deal_new", BUYER, "2026-06-01T00:00:00Z"),
  deal("deal_other", OTHER_BUYER, "2026-07-01T00:00:00Z"),
];

let findFirstArgs: Array<Record<string, unknown>>;

mock.module("@/lib/auth/session", {
  namedExports: { requireBuyer: async () => ({ id: BUYER }) },
});

mock.module("next/navigation", {
  namedExports: { notFound: () => { throw new NotFoundSignal(); } },
});

mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      deal: {
        // A faithful-enough findFirst: honour every scalar in `where`, then the
        // orderBy. This is what makes the test meaningful — the pre-fix query
        // fails here for the same reason it fails against Postgres.
        findFirst: async (args: { where: Record<string, unknown>; orderBy?: { createdAt?: string } }) => {
          findFirstArgs.push(args.where);
          let rows = DEALS.filter((d) =>
            Object.entries(args.where).every(([k, v]) => (d as unknown as Record<string, unknown>)[k] === v),
          );
          if (args.orderBy?.createdAt === "desc") {
            rows = [...rows].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
          }
          return rows[0] ?? null;
        },
      },
    },
  },
});

async function load() {
  return (await import("@/app/buyer/contracts/[contractId]/page")).default;
}

/** Render the page for one contractId; returns "rendered" or "not-found". */
async function open(contractId: string): Promise<"rendered" | "not-found"> {
  const Page = await load();
  try {
    await Page({ params: Promise.resolve({ contractId }) });
    return "rendered";
  } catch (err) {
    if (err instanceof NotFoundSignal) return "not-found";
    throw err;
  }
}

beforeEach(() => { findFirstArgs = []; });

test("a buyer can open the contract for an OLDER deal, not only their newest", async () => {
  assert.equal(
    await open("deal_old"),
    "rendered",
    "/buyer/contracts lists every deal and links each one; if only the newest resolves, those links are dead ends",
  );
});

test("the lookup asks for the requested contract, scoped to the buyer", async () => {
  await open("deal_old");
  const where = findFirstArgs[0]!;
  assert.equal(where.id, "deal_old", "the route param must reach the query, not just a post-hoc comparison");
  assert.equal(where.buyerId, BUYER, "ownership must stay in the query");
});

test("the newest deal still opens", async () => {
  assert.equal(await open("deal_new"), "rendered");
});

test("another buyer's deal is still not viewable", async () => {
  assert.equal(await open("deal_other"), "not-found", "ownership must not regress while fixing the lookup");
});

test("an unknown contract id is still a 404", async () => {
  assert.equal(await open("deal_does_not_exist"), "not-found");
});
