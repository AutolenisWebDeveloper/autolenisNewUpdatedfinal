// Program 3 — admin auction-action route MUST route dealer invitations through
// the ONE canonical invitability decision, and MUST NOT let a concierge-converted
// CLOSED auction be reinvited or reopened into the competitive lifecycle.
//
// These are integration tests: the REAL checkDealerAuctionInvitable /
// isConciergeConvertedAuction run against a mocked Prisma (verification gate OFF,
// so the verification sub-reads are out of scope — those are unit-tested in
// dealer-auction-invitability.test.ts).
//
//   npx tsx --test --experimental-test-module-mocks \
//     "app/api/admin/auctions/[auctionId]/__tests__/action-eligibility.test.ts"

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

interface AuctionRow {
  id: string;
  status: string;
  buyerId: string;
  startedAt: Date | null;
  endsAt: Date | null;
  postCloseProcessedAt: Date | null;
  deposit: unknown;
}
interface DealerRow { id: string; status: string; isSystemPlaceholder: boolean; dealershipName: string; user: { email: string } | null }

interface Ctrl {
  admin: { adminId: string; email: string; role: string } | null;
  auction: AuctionRow | null;
  dealer: DealerRow | null;
  invitationExists: boolean;
  invitationsCreated: Array<Record<string, unknown>>;
  auctionUpdates: Array<Record<string, unknown>>;
  notifications: number;
  audits: Array<Record<string, unknown>>;
  gateEnforced: boolean;
}
let ctrl: Ctrl;

mock.module("@/lib/auth/admin-api", {
  namedExports: {
    getAdminFromRequest: async () => ctrl.admin,
    adminError: (code: string, message: string, status: number) => ({ __kind: "error", code, message, status }),
    adminSuccess: (data: unknown) => ({ __kind: "success", data }),
  },
});

mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      auction: {
        findUnique: async () => ctrl.auction,
        update: async ({ data }: { data: Record<string, unknown> }) => { ctrl.auctionUpdates.push(data); return {}; },
      },
      dealer: {
        findUnique: async () => ctrl.dealer,
      },
      auctionInvitation: {
        findFirst: async () => (ctrl.invitationExists ? { id: "inv_existing" } : null),
        create: async ({ data }: { data: Record<string, unknown> }) => { ctrl.invitationsCreated.push(data); return { id: "inv_new" }; },
        deleteMany: async () => ({ count: 0 }),
        findMany: async () => [],
      },
      notification: {
        create: async () => { ctrl.notifications += 1; return {}; },
        createMany: async () => ({ count: 0 }),
      },
      adminAuditLog: { create: async ({ data }: { data: Record<string, unknown> }) => { ctrl.audits.push(data); return {}; } },
      buyer: { findUnique: async () => ({ city: "Austin", state: "TX" }) },
      auctionVehicle: { findFirst: async () => null },
      offer: { count: async () => 0 },
    },
  },
});

mock.module("@/lib/services/system/feature-flags.service", {
  namedExports: { FLAGS: { DEALER_VERIFICATION_GATE: "dealer_verification_gate" }, isEnabled: async () => ctrl.gateEnforced },
});
mock.module("@/lib/services/email/resend.service", { namedExports: { sendDealerAuctionInvitationEmail: async () => ({}) } });
mock.module("@/lib/services/auction/auction.service", { namedExports: { processAuctionClose: async () => ({ offers: 0 }) } });
mock.module("@/lib/services/payment/refund.service", { namedExports: { refundDepositCharge: async () => "NO_CHARGE" } });
mock.module("@/lib/logger", { namedExports: { logger: { error: () => {}, warn: () => {}, info: () => {} } } });

async function loadPOST() {
  const mod = await import("@/app/api/admin/auctions/[auctionId]/action/route");
  return mod.POST;
}
function req(body: Record<string, unknown>) {
  return { json: async () => body } as unknown as Parameters<Awaited<ReturnType<typeof loadPOST>>>[0];
}
const params = Promise.resolve({ auctionId: "auc_1" });

const T = Date.now();
const liveAuction: AuctionRow = {
  id: "auc_1", status: "ACTIVE", buyerId: "b1",
  startedAt: new Date(T - 3600_000), endsAt: new Date(T + 47 * 3600_000), postCloseProcessedAt: null, deposit: null,
};
const conciergeAuction: AuctionRow = {
  id: "auc_1", status: "CLOSED", buyerId: "b1",
  startedAt: new Date(T), endsAt: new Date(T), closedAt: new Date(T), postCloseProcessedAt: new Date(T), deposit: null,
} as AuctionRow;
const closedCompetitive: AuctionRow = {
  id: "auc_1", status: "CLOSED", buyerId: "b1",
  startedAt: new Date(T - 48 * 3600_000), endsAt: new Date(T - 1000), postCloseProcessedAt: new Date(T - 500), deposit: null,
};

beforeEach(() => {
  ctrl = {
    admin: { adminId: "adm_1", email: "admin@autolenis.com", role: "OPERATIONS_ADMIN" },
    auction: liveAuction,
    dealer: { id: "d1", status: "ACTIVE", isSystemPlaceholder: false, dealershipName: "Test Motors", user: { email: "d@x.com" } },
    invitationExists: false,
    invitationsCreated: [],
    auctionUpdates: [],
    notifications: 0,
    audits: [],
    gateEnforced: false,
  };
});

test("DEALER_INVITED: ACTIVE dealer into a live auction succeeds and creates the invitation", async () => {
  const POST = await loadPOST();
  const res = (await POST(req({ action: "DEALER_INVITED", reason: "manual add", dealerId: "d1" }), { params })) as unknown as { __kind: string };
  assert.equal(res.__kind, "success");
  assert.equal(ctrl.invitationsCreated.length, 1);
});

test("DEALER_INVITED into a concierge-converted CLOSED auction is rejected — no invitation", async () => {
  ctrl.auction = conciergeAuction;
  const POST = await loadPOST();
  const res = (await POST(req({ action: "DEALER_INVITED", reason: "manual add", dealerId: "d1" }), { params })) as unknown as { __kind: string; code: string; message: string };
  assert.equal(res.__kind, "error");
  assert.equal(res.code, "DEALER_NOT_INVITABLE");
  assert.match(res.message, /auction_not_competitive/);
  assert.equal(ctrl.invitationsCreated.length, 0, "no invitation is created for a concierge auction");
});

test("DEALER_INVITED into a CLOSED competitive auction is rejected (closed auctions take no new invites)", async () => {
  ctrl.auction = closedCompetitive;
  const POST = await loadPOST();
  const res = (await POST(req({ action: "DEALER_INVITED", reason: "manual add", dealerId: "d1" }), { params })) as unknown as { code: string; message: string };
  assert.equal(res.code, "DEALER_NOT_INVITABLE");
  assert.match(res.message, /auction_not_open/);
  assert.equal(ctrl.invitationsCreated.length, 0);
});

test("DEALER_INVITED of a SUSPENDED dealer is rejected — no invitation", async () => {
  ctrl.dealer = { id: "d1", status: "SUSPENDED", isSystemPlaceholder: false, dealershipName: "X", user: { email: "d@x.com" } };
  const POST = await loadPOST();
  const res = (await POST(req({ action: "DEALER_INVITED", reason: "manual add", dealerId: "d1" }), { params })) as unknown as { code: string; message: string };
  assert.equal(res.code, "DEALER_NOT_INVITABLE");
  assert.match(res.message, /dealer_not_active/);
  assert.equal(ctrl.invitationsCreated.length, 0);
});

test("DEALER_INVITED of the system placeholder dealer is rejected", async () => {
  ctrl.dealer = { id: "d1", status: "ACTIVE", isSystemPlaceholder: true, dealershipName: "Outside", user: null };
  const POST = await loadPOST();
  const res = (await POST(req({ action: "DEALER_INVITED", reason: "manual add", dealerId: "d1" }), { params })) as unknown as { code: string; message: string };
  assert.equal(res.code, "DEALER_NOT_INVITABLE");
  assert.match(res.message, /dealer_is_placeholder/);
});

test("AUCTION_REOPENED of a concierge-converted CLOSED auction is rejected — status unchanged", async () => {
  ctrl.auction = conciergeAuction;
  const POST = await loadPOST();
  const res = (await POST(req({ action: "AUCTION_REOPENED", reason: "oops" }), { params })) as unknown as { __kind: string; code: string };
  assert.equal(res.__kind, "error");
  assert.equal(res.code, "CONCIERGE_AUCTION");
  assert.equal(ctrl.auctionUpdates.length, 0, "concierge auction status is never mutated");
});

test("AUCTION_REOPENED of a genuinely CLOSED competitive auction succeeds", async () => {
  ctrl.auction = closedCompetitive;
  const POST = await loadPOST();
  const res = (await POST(req({ action: "AUCTION_REOPENED", reason: "give dealers more time" }), { params })) as unknown as { __kind: string; data: { newStatus: string } };
  assert.equal(res.__kind, "success");
  assert.equal(res.data.newStatus, "REOPENED");
  assert.equal(ctrl.auctionUpdates.length, 1);
  assert.equal(ctrl.auctionUpdates[0]!.status, "REOPENED");
});

// Program 3 — the concierge isolation must not be defeatable by first EXTENDING a
// concierge CLOSED auction (which would move endsAt past startedAt and erase the
// structural signature) and then reopening it. AUCTION_EXTENDED must refuse any
// non-live auction, so the two-step bypass fails at step 1.
test("AUCTION_EXTENDED is rejected on a concierge (CLOSED) auction — signature cannot be erased", async () => {
  ctrl.auction = conciergeAuction;
  const POST = await loadPOST();
  const res = (await POST(req({ action: "AUCTION_EXTENDED", reason: "attempt", hours: 48 }), { params })) as unknown as { __kind: string; code: string };
  assert.equal(res.__kind, "error");
  assert.equal(res.code, "INVALID_STATE");
  assert.equal(ctrl.auctionUpdates.length, 0, "a concierge auction's window is never mutated");
});

test("AUCTION_EXTENDED is rejected on any CLOSED/EXPIRED/CANCELLED auction", async () => {
  ctrl.auction = closedCompetitive;
  const POST = await loadPOST();
  const res = (await POST(req({ action: "AUCTION_EXTENDED", reason: "too late", hours: 24 }), { params })) as unknown as { code: string };
  assert.equal(res.code, "INVALID_STATE");
  assert.equal(ctrl.auctionUpdates.length, 0);
});

test("AUCTION_EXTENDED rejects non-positive hours (no negative window that could fake a concierge signature)", async () => {
  ctrl.auction = liveAuction;
  const POST = await loadPOST();
  const res = (await POST(req({ action: "AUCTION_EXTENDED", reason: "bad input", hours: -100 }), { params })) as unknown as { code: string };
  assert.equal(res.code, "INVALID_HOURS");
  assert.equal(ctrl.auctionUpdates.length, 0);
});

test("AUCTION_EXTENDED still succeeds on a live ACTIVE auction with positive hours", async () => {
  ctrl.auction = liveAuction;
  const POST = await loadPOST();
  const res = (await POST(req({ action: "AUCTION_EXTENDED", reason: "give more time", hours: 12 }), { params })) as unknown as { __kind: string };
  assert.equal(res.__kind, "success");
  assert.equal(ctrl.auctionUpdates.length, 1);
});
