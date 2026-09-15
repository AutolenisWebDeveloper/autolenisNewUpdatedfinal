// §Stage 13/14a — the contract request, and §Stage 15's insurance request that rides with it.
//
// THE DEFECTS THESE PIN.
//
//   (6) `document_requests.dueAt` was NEVER SET and `requestDocument()` had NO CALLERS. The
//       table modelled a deal-scoped request with a due date since the original schema, and
//       nothing in the system had ever written one. A request with no deadline cannot go
//       overdue, so the escalation §26 requires had no input.
//
//   (2/§13-D28) Insurance gated entry to CONTRACT_PENDING, which Stage 15 forbids in as many
//       words. It is now REQUESTED at the same moment instead, which is what gives the buyer
//       the whole contract-and-signing window to bind rather than being the bottleneck.
//
// Run: npx tsx --test --experimental-test-module-mocks \
//   "lib/services/deal/__tests__/phase8-contract-request.test.ts"

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

mock.module("server-only", { namedExports: {} });
mock.module("@/lib/logger", { namedExports: { logger: { error: () => {}, warn: () => {}, info: () => {} } } });

interface Created { dealId: string; documentType: string; dueAt: Date | null; buyerId: string | null }
let created: Created[] = [];
let existingRequests: (Created & { createdAt: Date; status: string })[] = [];
let enqueued: { templateKey: string; to: string; runAt?: Date; idempotencyKey?: string }[] = [];
let exceptions: string[] = [];

const DEAL = {
  id: "d1", buyerId: "b1", vin: "1HGCM82633A004352",
  vehicleYear: 2021, vehicleMake: "Honda", vehicleModel: "Accord",
  otdCentsConfirmed: 3_245_000,
  offer: {
    dealerId: "dealer_1", otdPriceCents: 3_245_000,
    externalDealerName: null, externalDealerEmail: null,
    dealer: { dealershipName: "Bay Honda", isSystemPlaceholder: false, user: { email: "sales@bayhonda.test" } },
  },
};
let dealRow: unknown = DEAL;
let buyerEmail: string | null = "ada@example.com";

mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      deal: { findUnique: async () => dealRow },
      buyer: { findUnique: async () => (buyerEmail ? { user: { email: buyerEmail } } : null) },
      documentRequest: {
        findFirst: async (args: { where: { documentType: string } }) =>
          existingRequests.find((r) => r.documentType === args.where.documentType && r.status === "PENDING") ?? null,
        create: async ({ data }: { data: Created }) => {
          const row = { ...data, createdAt: new Date(), status: "PENDING" };
          created.push(data);
          existingRequests.push(row);
          return row;
        },
      },
    },
  },
});
mock.module("@/lib/services/comms/transactional-dispatcher.service", {
  namedExports: {
    enqueueTransactional: async (input: { templateKey: string; to: string; runAt?: Date; idempotencyKey?: string }) => {
      enqueued.push(input);
      return {};
    },
  },
});
mock.module("@/lib/services/operations/queue-item.service", {
  namedExports: {
    raiseException: async (input: { code: string }) => { exceptions.push(input.code); return {}; },
  },
});

const mod = () => import("../contract-request.service");

beforeEach(() => {
  created = []; existingRequests = []; enqueued = []; exceptions = [];
  dealRow = DEAL; buyerEmail = "ada@example.com";
});

test("THE DEFECT: the contract request now carries a 24-HOUR dueAt", async () => {
  const now = new Date("2026-09-15T10:00:00.000Z");
  const { openContractRequest, CONTRACT_REQUEST_WINDOW_HOURS } = await mod();
  const result = await openContractRequest({ dealId: "d1", now });

  assert.equal(CONTRACT_REQUEST_WINDOW_HOURS, 24, "§14a: a 24-hour deadline");
  const contract = created.find((r) => r.documentType === "SALES_CONTRACT")!;
  assert.ok(contract, "a SALES_CONTRACT request must be opened");
  assert.ok(contract.dueAt, "dueAt is the overdue sweep's ONLY input — a request without one can never escalate");
  assert.equal(contract.dueAt!.toISOString(), "2026-09-16T10:00:00.000Z");
  assert.equal(result.created, true);
});

test("§Stage 15: insurance is requested AT THE SAME MOMENT, and carries NO deadline", async () => {
  const { openContractRequest } = await mod();
  await openContractRequest({ dealId: "d1" });

  const insurance = created.find((r) => r.documentType === "INSURANCE_PROOF")!;
  assert.ok(insurance, "insurance must be requested at contract request so the buyer has the full window");
  assert.equal(insurance.dueAt, null,
    "Stage 15 never puts a deadline on the buyer — it blocks RELEASE. A dueAt here would escalate a buyer for not having bought insurance yet.");
  assert.ok(enqueued.some((e) => e.templateKey === "insurance_required"));
});

test("the dealership gets the request AND a future-dated overdue reminder, not a sweep's promise", async () => {
  const now = new Date("2026-09-15T10:00:00.000Z");
  const { openContractRequest } = await mod();
  await openContractRequest({ dealId: "d1", now });

  const request = enqueued.find((e) => e.templateKey === "contract_requested")!;
  assert.ok(request, "the winning dealership must be asked");
  assert.equal(request.to, "sales@bayhonda.test");

  const overdue = enqueued.find((e) => e.templateKey === "contract_overdue")!;
  assert.ok(overdue, "the reminder is enqueued NOW with a future runAt — a row that exists cannot be forgotten by a cron that failed to run");
  assert.equal(overdue.runAt?.toISOString(), "2026-09-16T10:00:00.000Z");
});

test("IDEMPOTENT: a re-arrival does not open a second request or restart the clock", async () => {
  // CONTRACT_REVIEW -> CONTRACT_PENDING is a legal edge (contract re-submit), so a deal can
  // arrive here repeatedly. Restarting a 24-hour clock that is already running against a
  // dealership would be worse than doing nothing.
  const first = new Date("2026-09-15T10:00:00.000Z");
  const { openContractRequest } = await mod();
  await openContractRequest({ dealId: "d1", now: first });
  const afterFirst = created.length;
  enqueued = [];

  const later = new Date("2026-09-15T18:00:00.000Z");
  const second = await openContractRequest({ dealId: "d1", now: later });

  assert.equal(second.created, false);
  assert.equal(second.reason, "already_open");
  assert.equal(created.length, afterFirst, "no second request row");
  assert.equal(second.dueAt?.toISOString(), "2026-09-16T10:00:00.000Z", "the original deadline stands");
  assert.deepEqual(enqueued, [], "a dealership mid-upload must not be told to start again");
});

test("a dealership with NO email raises an exception — the deadline is running regardless", async () => {
  dealRow = {
    ...DEAL,
    offer: { ...DEAL.offer, dealer: { ...DEAL.offer.dealer, user: { email: null } } },
  };
  const { openContractRequest } = await mod();
  const result = await openContractRequest({ dealId: "d1" });

  assert.equal(result.created, true, "the request record is opened even when it cannot be sent");
  assert.equal(result.reason, "no_dealer_channel");
  assert.ok(exceptions.includes("COMMS_NO_DELIVERABLE_CHANNEL"),
    "a recipient with no channel produces no outbox row, so it is its own exception");
});

test("the request record is written BEFORE the message, so a send failure cannot lose the deadline", async () => {
  dealRow = { ...DEAL, offer: { ...DEAL.offer, dealer: { ...DEAL.offer.dealer, user: { email: null } } } };
  const { openContractRequest } = await mod();
  await openContractRequest({ dealId: "d1" });
  assert.ok(created.some((r) => r.documentType === "SALES_CONTRACT" && r.dueAt),
    "a request that exists only as a sent message disappears when the message cannot be sent");
});
