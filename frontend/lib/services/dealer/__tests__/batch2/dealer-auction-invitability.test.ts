// Program 3 — canonical dealer-auction INVITABILITY decision.
//
// Every dealer-invitation entry point (automatic launch, deposit-activation
// reconciler, admin batch launch, admin single invite) must route the "may this
// dealer be invited to THIS auction?" question through ONE canonical decision.
// This pins that decision: auction must be an OPEN competitive auction (PENDING /
// ACTIVE, and NOT a concierge-converted offline auction), the dealer must be an
// ACTIVE non-placeholder dealer, and — when the verification gate is enforced —
// the dealer must be signed + license-verified (the same source of truth
// filterAuctionEligibleDealerIds uses).
//
//   npx tsx --test --experimental-test-module-mocks \
//     lib/services/dealer/__tests__/batch2/dealer-auction-invitability.test.ts

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

interface DealerRow { status: string; isSystemPlaceholder: boolean; sig: boolean; verified: boolean }
interface AuctionRow {
  status: string;
  startedAt: Date | null;
  endsAt: Date | null;
  postCloseProcessedAt: Date | null;
}

const dealers: Record<string, DealerRow | undefined> = {};
const auctions: Record<string, AuctionRow | undefined> = {};
let gateEnforced = false;

function idOf(args: { where?: { id?: string; dealerId?: string } }): string {
  return String(args.where?.id ?? args.where?.dealerId ?? "");
}

mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      auction: {
        findUnique: async (a: { where?: { id?: string } }) => auctions[idOf(a)] ?? null,
      },
      dealer: {
        findUnique: async (a: { where?: { id?: string } }) => {
          const d = dealers[idOf(a)];
          if (!d) return null;
          // getDealerVerificationEligibility reads marketplaceAgreementSignedAt too.
          return { status: d.status, isSystemPlaceholder: d.isSystemPlaceholder, marketplaceAgreementSignedAt: null };
        },
      },
      dealerAgreementSignature: {
        findUnique: async (a: { where?: { dealerId?: string } }) => (dealers[idOf(a)]?.sig ? { id: "sig" } : null),
      },
      dealerVerification: {
        findUnique: async (a: { where?: { dealerId?: string } }) => ({ verified: dealers[idOf(a)]?.verified ?? false }),
      },
    },
  },
});
mock.module("@/lib/services/system/feature-flags.service", {
  namedExports: { FLAGS: { DEALER_VERIFICATION_GATE: "dealer_verification_gate" }, isEnabled: async () => gateEnforced },
});

async function load() { return import("@/lib/services/dealer/dealer-auction-eligibility.service"); }

const now = Date.now();
const liveAuction: AuctionRow = {
  status: "ACTIVE",
  startedAt: new Date(now - 3600_000),
  endsAt: new Date(now + 47 * 3600_000), // 48h window
  postCloseProcessedAt: null,
};
const pendingAuction: AuctionRow = { status: "PENDING", startedAt: null, endsAt: null, postCloseProcessedAt: null };
// Concierge-converted: born CLOSED, zero-duration window, post-close marker set at creation.
const conciergeAuction: AuctionRow = {
  status: "CLOSED",
  startedAt: new Date(now),
  endsAt: new Date(now),
  postCloseProcessedAt: new Date(now),
};
// A genuinely competitive auction that closed after running 48h.
const closedCompetitiveAuction: AuctionRow = {
  status: "CLOSED",
  startedAt: new Date(now - 48 * 3600_000),
  endsAt: new Date(now - 1000),
  postCloseProcessedAt: new Date(now - 500),
};

beforeEach(() => {
  gateEnforced = false;
  for (const k of Object.keys(dealers)) delete dealers[k];
  for (const k of Object.keys(auctions)) delete auctions[k];
  dealers.active = { status: "ACTIVE", isSystemPlaceholder: false, sig: true, verified: true };
  dealers.unverified = { status: "ACTIVE", isSystemPlaceholder: false, sig: true, verified: false };
  dealers.suspended = { status: "SUSPENDED", isSystemPlaceholder: false, sig: true, verified: true };
  dealers.placeholder = { status: "ACTIVE", isSystemPlaceholder: true, sig: true, verified: true };
  auctions.live = liveAuction;
  auctions.pending = pendingAuction;
  auctions.concierge = conciergeAuction;
  auctions.closed = closedCompetitiveAuction;
});

// ---- isConciergeConvertedAuction (pure predicate) ----

test("isConciergeConvertedAuction: true for a born-closed zero-duration auction", async () => {
  const { isConciergeConvertedAuction } = await load();
  assert.equal(isConciergeConvertedAuction(conciergeAuction), true);
});

test("isConciergeConvertedAuction: false for a live 48h auction", async () => {
  const { isConciergeConvertedAuction } = await load();
  assert.equal(isConciergeConvertedAuction(liveAuction), false);
});

test("isConciergeConvertedAuction: false for a competitive auction that closed after running", async () => {
  const { isConciergeConvertedAuction } = await load();
  assert.equal(isConciergeConvertedAuction(closedCompetitiveAuction), false);
});

test("isConciergeConvertedAuction: false for a pending (never-started) auction", async () => {
  const { isConciergeConvertedAuction } = await load();
  assert.equal(isConciergeConvertedAuction(pendingAuction), false);
});

// ---- checkDealerAuctionInvitable (composed decision) ----

test("invitable: ACTIVE verified dealer into a live auction (gate ON)", async () => {
  gateEnforced = true;
  const { checkDealerAuctionInvitable } = await load();
  const r = await checkDealerAuctionInvitable("live", "active");
  assert.equal(r.invitable, true);
});

test("invitable: ACTIVE dealer into a PENDING auction", async () => {
  const { checkDealerAuctionInvitable } = await load();
  const r = await checkDealerAuctionInvitable("pending", "active");
  assert.equal(r.invitable, true);
});

test("NOT invitable: unverified dealer when the verification gate is ON", async () => {
  gateEnforced = true;
  const { checkDealerAuctionInvitable } = await load();
  const r = await checkDealerAuctionInvitable("live", "unverified");
  assert.equal(r.invitable, false);
  assert.equal(r.reason, "license_not_verified");
});

test("invitable: unverified dealer passes when the gate is OFF (grandfathered)", async () => {
  gateEnforced = false;
  const { checkDealerAuctionInvitable } = await load();
  const r = await checkDealerAuctionInvitable("live", "unverified");
  assert.equal(r.invitable, true);
});

test("NOT invitable: a concierge-converted CLOSED auction can never be reinvited", async () => {
  const { checkDealerAuctionInvitable } = await load();
  const r = await checkDealerAuctionInvitable("concierge", "active");
  assert.equal(r.invitable, false);
  assert.equal(r.reason, "auction_not_competitive");
});

test("NOT invitable: a genuinely CLOSED competitive auction (closed auctions don't take new invites)", async () => {
  const { checkDealerAuctionInvitable } = await load();
  const r = await checkDealerAuctionInvitable("closed", "active");
  assert.equal(r.invitable, false);
  assert.equal(r.reason, "auction_not_open");
});

test("NOT invitable: a SUSPENDED dealer", async () => {
  const { checkDealerAuctionInvitable } = await load();
  const r = await checkDealerAuctionInvitable("live", "suspended");
  assert.equal(r.invitable, false);
  assert.equal(r.reason, "dealer_not_active");
});

test("NOT invitable: the system Outside-Dealer placeholder", async () => {
  const { checkDealerAuctionInvitable } = await load();
  const r = await checkDealerAuctionInvitable("live", "placeholder");
  assert.equal(r.invitable, false);
  assert.equal(r.reason, "dealer_is_placeholder");
});

test("NOT invitable: unknown auction / unknown dealer", async () => {
  const { checkDealerAuctionInvitable } = await load();
  assert.equal((await checkDealerAuctionInvitable("nope", "active")).reason, "auction_not_found");
  assert.equal((await checkDealerAuctionInvitable("live", "nope")).reason, "dealer_not_found");
});
