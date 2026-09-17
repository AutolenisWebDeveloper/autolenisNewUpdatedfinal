// P9-01 — POST /api/admin/deals/[dealId]/action must map Phase 8's release gate, not 500 on it.
//
// THE DEFECT. Phase 8 gave `advanceDealStatus` a third rejection at COMPLETED:
// `ReleaseNotClearedError`, thrown when the dealership's fully executed contract is not on
// file or `deals.funding_cleared_at` is unset (deal.service.ts:264, :270). Two routes can
// reach COMPLETED without `force` and both were taught only the first two rejections. The
// dealer scan was one; this route is the other — `DEAL_STAGE_ADVANCED` takes `newStatus`
// straight from the request body and passes `force: force === true`, so an admin advancing a
// deal to COMPLETED without asking for an override gets an unhandled 500.
//
// WHY IT IS NOT AN EDGE CASE. `funding_cleared_at` has no satisfiable writer today.
// `clearFunding` refuses unless every clearance item passes, and two of its inputs —
// `financing.downPaymentMethod` and `financing.dealerFundingConfirmedAt` — have no production
// writer at all (every reference is a read). So for any non-forced completion this branch is
// not one possible outcome among several. It is the only one.
//
// WHY ITS OWN CODE. deal.service.ts:160-164 states the reason: "an insurance gap is the
// buyer's to close, while an uncleared funding or a missing executed contract is AutoLenis's
// and the dealership's. A caller that cannot tell them apart cannot say who has to act."
//
// WHY THE MESSAGE DOES NOT ADVERTISE `force`. The sibling mappings end with "Pass force:true
// to override." This one deliberately does not. The owner ruled on 2026-09-15 that force may
// skip an ORDERING constraint but never a FACT: funding clearance, the executed contract,
// insurance and possession are facts about the world, and forcing them makes the record lie.
// Telling an administrator to force past this would advertise a capability that is scheduled
// to be removed, to produce a completed deal that is false in the database. The message says
// what is missing and stops.
//
// RETARGETED AT PHASE 9, FROM COMPLETED TO HANDOVER_PENDING, AND THE REASON IS THE POINT.
//
// Every case below used to advance to COMPLETED, because that was the rung this route could
// reach. Phase 9's adversarial review found that a runtime-resolved COMPLETED target evaluates
// three of §Stage 20's FOURTEEN preconditions, so the route now refuses it outright (see the new
// case at the end of this file). The gate mappings these cases exist to pin are unaffected:
// `assertReleaseGates` runs on every rung in `RELEASE_GATED_STATUSES`, and HANDOVER_PENDING —
// the rung where the vehicle physically moves — is one of them. The subject is the same, tested
// at a target that still exists.
//
// Run with:
//   npx tsx --test --experimental-test-module-mocks \
//     "app/api/admin/deals/__tests__/deal-action-release-gate.test.ts"

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

class ReleaseNotClearedError extends Error {
  constructor(public readonly detail: string) {
    super(`This deal is not cleared for release: ${detail}.`);
    this.name = "ReleaseNotClearedError";
  }
}

interface Ctrl {
  deal: Record<string, unknown> | null;
  advanceThrows: Error | null;
  advances: Array<{ dealId: string; status: string; force: boolean }>;
  audits: Array<Record<string, unknown>>;
}
let ctrl: Ctrl;

mock.module("@/lib/auth/admin-api", {
  namedExports: {
    getAdminFromRequest: async () => ({ adminId: "adm_1", email: "ops@autolenis.com", role: "SUPER_ADMIN" }),
    adminError: (code: string, message: string, status: number) => ({ __kind: "error", code, message, status }),
    adminSuccess: (data: unknown) => ({ __kind: "success", data }),
  },
});

mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      deal: { findUnique: async () => ctrl.deal },
      // The COMPLETED branch notifies both parties; without these the success case dies in
      // the notifier rather than at the assertion, which would hide whether the map worked.
      buyer: { findUnique: async () => ({ firstName: "Ada", user: { email: "ada@example.com" } }) },
      deposit: { findFirst: async () => null },
      notification: { create: async () => ({}) },
      adminAuditLog: {
        create: async ({ data }: { data: Record<string, unknown> }) => { ctrl.audits.push(data); return {}; },
      },
    },
  },
});

mock.module("@/lib/services/payment/refund.service", {
  namedExports: { refundDepositCharge: async () => ({ outcome: "NO_CHARGE", stripeRefundId: null }) },
});

mock.module("@/lib/services/deal/deal.service", {
  namedExports: {
    advanceDealStatus: async (
      dealId: string,
      status: string,
      opts: { force?: boolean } = {},
    ) => {
      if (ctrl.advanceThrows) throw ctrl.advanceThrows;
      ctrl.advances.push({ dealId, status, force: opts.force === true });
      return true;
    },
    cancelDeal: async () => true,
    DealTransitionError: class extends Error {},
    InsuranceRequiredError: class extends Error {},
    ReleaseNotClearedError,
  },
});

mock.module("@/lib/services/email/resend.service", {
  namedExports: {
    sendDealerContractPendingEmail: async () => {},
    sendDealerContractIssuesEmail: async () => {},
    sendDealCompleteEmail: async () => {},
  },
});

mock.module("@/lib/logger", { namedExports: { logger: { error: () => {}, warn: () => {}, info: () => {} } } });

async function loadPOST() {
  return (await import("@/app/api/admin/deals/[dealId]/action/route")).POST;
}

function req(body: Record<string, unknown>) {
  return { json: async () => body } as unknown as Parameters<Awaited<ReturnType<typeof loadPOST>>>[0];
}
const params = Promise.resolve({ dealId: "deal_1" });

beforeEach(() => {
  ctrl = {
    deal: { id: "deal_1", buyerId: "buyer_1", status: "PICKUP_SCHEDULED", buyer: { id: "buyer_1" } },
    advanceThrows: null,
    advances: [],
    audits: [],
  };
});

test("funding not cleared → 409 RELEASE_NOT_CLEARED, not an unhandled 500", async () => {
  ctrl.advanceThrows = new ReleaseNotClearedError("funding has not been cleared for this deal");
  const POST = await loadPOST();

  const res = (await POST(
    req({ action: "DEAL_STAGE_ADVANCED", newStatus: "HANDOVER_PENDING", reason: "buyer collected the vehicle" }),
    { params },
  )) as unknown as { __kind: string; code: string; message: string; status: number };

  assert.equal(res.__kind, "error", "the seam's release rejection must be mapped, not thrown");
  assert.equal(res.status, 409);
  assert.equal(res.code, "RELEASE_NOT_CLEARED");
  assert.equal(
    res.message.includes("funding has not been cleared"),
    true,
    "the detail names which of the two facts is missing; a generic message cannot say who has to act",
  );
});

test("the dealership's executed contract not on file → 409 RELEASE_NOT_CLEARED", async () => {
  ctrl.advanceThrows = new ReleaseNotClearedError("the dealership's fully executed contract is not on file");
  const POST = await loadPOST();

  const res = (await POST(
    req({ action: "DEAL_STAGE_ADVANCED", newStatus: "HANDOVER_PENDING", reason: "closing out" }),
    { params },
  )) as unknown as { __kind: string; code: string; message: string; status: number };

  assert.equal(res.__kind, "error");
  assert.equal(res.status, 409);
  assert.equal(res.code, "RELEASE_NOT_CLEARED");
  assert.equal(res.message.includes("executed contract"), true);
});

test("the mapped message does NOT tell the administrator to force past a missing fact", async () => {
  // The owner's ruling, 2026-09-15: force may skip an ORDERING constraint, never a FACT.
  // The sibling mappings in this route end with "Pass force:true to override." This one must
  // not, because the override it would advertise is scheduled for removal and the deal it
  // would produce is false in the database.
  ctrl.advanceThrows = new ReleaseNotClearedError("funding has not been cleared for this deal");
  const POST = await loadPOST();

  const res = (await POST(
    req({ action: "DEAL_STAGE_ADVANCED", newStatus: "HANDOVER_PENDING", reason: "closing out" }),
    { params },
  )) as unknown as { message: string };

  assert.equal(
    /force/i.test(res.message),
    false,
    `the release-gate message must not advertise force, but read: ${res.message}`,
  );
});

test("a normal advance still succeeds and still carries force through untouched", async () => {
  // P9-01 maps an error. It changes no transition and no force semantics — that is P9-11's,
  // behind the owner's allowlist ruling. This pins that scope so the mapping cannot quietly
  // become a behaviour change.
  const POST = await loadPOST();

  const res = (await POST(
    req({ action: "DEAL_STAGE_ADVANCED", newStatus: "HANDOVER_PENDING", reason: "closing out", force: true }),
    { params },
  )) as unknown as { __kind: string };

  assert.equal(res.__kind, "success");
  assert.deepEqual(ctrl.advances, [{ dealId: "deal_1", status: "HANDOVER_PENDING", force: true }]);
});

test("COMPLETED is refused at this route — a deal is completed by possession, not by a dropdown", async () => {
  // THE PHASE 9 FINDING, PINNED. §8.2 defect (8) closed `PICKUP_SCHEDULED → COMPLETED` and
  // inserted HANDOVER_PENDING, which made `HANDOVER_PENDING → COMPLETED` a legal edge — and this
  // route resolves its target from the REQUEST BODY, so an OPERATIONS_ADMIN could select COMPLETED
  // on a deal already at HANDOVER_PENDING and take it non-forced. Three of fourteen preconditions
  // would run; `completed_at` would stay NULL; no pickup completion, no possession evidence, no
  // §Stage 21 obligations, neither party's completion message.
  //
  // THE CAPABILITY IS NOT LOST, IT MOVED: `POST /api/admin/deals/[dealId]/pickup/complete` still
  // lets Operations complete a deal, with the possession evidence §Stage 20 requires.
  const POST = await loadPOST();
  const res = (await POST(
    req({ action: "DEAL_STAGE_ADVANCED", newStatus: "COMPLETED", reason: "buyer collected the vehicle" }),
    { params },
  )) as unknown as { code: string; message: string; status: number };

  assert.equal(res.status, 409);
  assert.equal(res.code, "USE_COMPLETION_PATH");
  assert.match(res.message, /recording the buyer's possession/);
  assert.deepEqual(ctrl.advances, [], "the guard must refuse BEFORE the state machine is touched");
});

test("force does not open it either — possession is a fact, not an ordering constraint", async () => {
  const { POST } = await import("@/app/api/admin/deals/[dealId]/action/route");
  const res = await POST(
    req({ action: "DEAL_STAGE_ADVANCED", newStatus: "COMPLETED", reason: "closing out", force: true }),
    { params: Promise.resolve({ dealId: "deal_1" }) },
  );

  assert.equal(res.status, 409);
  assert.deepEqual(ctrl.advances, [], "owner ruling 2026-09-15: force may skip an ORDERING constraint, never a FACT");
});

// ─────────────────────────────────────────────────────────────────────────────
// P9-02 — THE GUARD IS ROUTE-LOCAL, AND A SECOND RUNTIME-RESOLVED CALLER EXISTED.
//
// The refusal above lives at `app/api/admin/deals/[dealId]/action/route.ts`, which is the right
// layer for it: the vulnerability is a target resolved from a REQUEST BODY, and `advanceDealStatus`
// is the documented canonical emitter of the completion event — putting the refusal inside it
// deleted tested behaviour and broke eight tests. The sibling `workflow/move` route enforces the
// same class of restriction the same way, with a `PERMITTED_STAGES` allowlist whose comment reads
// "excludes terminal states handled by dedicated routes". The layer is the repo's own precedent.
//
// BUT A ROUTE-LOCAL GUARD ONLY COVERS THAT ROUTE. The AI action catalogue declared
// `admin.advance_deal_status` with COMPLETED inside its `newStatus` enum, `availability:
// "AVAILABLE"`, and `canonicalService: "…#advanceDealStatus"` — a second surface resolving the
// target at runtime and calling straight through, past the route that refuses. An approved intent
// on a deal at HANDOVER_PENDING would have written `status = COMPLETED` with `completed_at` NULL,
// the pickup still RELEASED, no §Stage 21 obligations and neither party's completion mail — while
// still emitting the completion event, so affiliate settlement would run on a deal with no
// possession evidence at all. `canTransition("HANDOVER_PENDING", "COMPLETED")` is true, and
// `assertReleaseGates` evaluates three of the fourteen.
//
// Latent rather than live — the surface is fail-closed dormant behind two activation flags — and
// neither "one writer" guard could see it: one scans `lib/services`+`lib/jobs` for PICKUP writes,
// the other scans `app/api/admin` for admin routes. A catalogue entry is neither.
//
// This reads the catalogue's own zod schema rather than grepping for the word, so it fails on
// reintroduction however the enum is spelled.
test("no AI intent offers COMPLETED as a selectable deal status", async () => {
  const { ACTION_INTENT_CATALOG } = await import("@/lib/services/ai/action-intent/catalog");

  const entries = Object.values(ACTION_INTENT_CATALOG);
  assert.ok(entries.length > 5, "the catalogue scan is empty — it is proving nothing");

  const advance = entries.find((d) => d.type === "admin.advance_deal_status");
  assert.ok(advance, "admin.advance_deal_status must still EXIST — the capability is not removed");

  // Pull the enum out of the intent's own zod `parameters` schema by round-tripping a candidate through it, so the
  // assertion tracks whatever the schema actually accepts rather than its source text.
  const accepts = (status: string) =>
    advance.parameters.safeParse({ dealId: "deal_1", newStatus: status, reason: "test reason" }).success;

  assert.equal(
    accepts("COMPLETED"),
    false,
    "COMPLETED is reached by recording possession (§Stage 20's fourteen preconditions), never by " +
      "selecting a target status. An AI intent that accepts it is the admin dropdown bypass with " +
      "a different front door.",
  );

  // Anti-vacuity: the probe must be capable of returning true, or the assertion above is free.
  assert.equal(accepts("PICKUP_SCHEDULED"), true, "the schema probe accepts nothing — it is not testing the enum");
  assert.equal(accepts("CANCELLED"), true, "cancellation stays selectable; only COMPLETED is withdrawn");
});
