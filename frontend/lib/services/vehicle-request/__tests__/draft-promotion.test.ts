// §5 rule 6 + §6.4 — a completed draft stops being a draft, and stops being chased.
//
// THE DEFECT THIS PINS, found by the Phase 2 Playwright journey rather than by
// reading the code. `attachOrCreateOpenRequest` documented "an existing open
// request keeps its own [status]", which is right for OFFER_SENT and wrong for
// DRAFT: a buyer who captured a partial request on the homepage and then
// submitted a complete one stayed at DRAFT forever. Two visible consequences:
//
//   • §6.4's four recovery touches carry a send-time recheck that skips when the
//     request is "no longer a DRAFT" — so it never skipped, and a buyer who had
//     finished kept being told to finish;
//   • `abandonStaleDrafts` stamps `abandoned_at` on DRAFT rows at 14 days, so a
//     completed request would have been marked abandoned.
//
// The promotion is FORWARD ONLY and only out of DRAFT. Demotion is the failure
// mode that matters on the other side — rewinding OFFER_SENT to SUBMITTED
// because a buyer re-submitted a form would rewind a live auction — so it is
// asserted explicitly, not assumed.
//
// Run: pnpm test:vehicle-request

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { makeFakePrisma, type FakeDb } from "../../acquisition/__tests__/fake-prisma";

const db: FakeDb = makeFakePrisma();
mock.module("@/lib/prisma", { namedExports: { prisma: db.client } });
mock.module("@/lib/logger", { namedExports: { logger: { info: () => {}, warn: () => {}, error: () => {} } } });

async function svc() {
  return import("@/lib/services/vehicle-request/open-request.service");
}

beforeEach(() => db.reset());

function seedRequest(status: string, extra: Record<string, unknown> = {}) {
  const id = `vr_${status}_${db.state.seq++}`;
  db.state.vehicleRequests.set(id, {
    id,
    buyerId: "buyer_1",
    status,
    notes: null,
    makePreference: null,
    modelPreference: null,
    zip: null,
    ...extra,
  });
  return id;
}

test("a COMPLETE submission promotes an existing DRAFT to SUBMITTED", async () => {
  const { attachOrCreateOpenRequest } = await svc();
  const id = seedRequest("DRAFT");

  const res = await attachOrCreateOpenRequest({
    buyerId: "buyer_1",
    createStatus: "SUBMITTED",
    data: { makePreference: "Toyota" },
  });

  assert.equal(res.vehicleRequest.id, id, "it attaches to the open request, never creates a second");
  assert.equal(res.vehicleRequest.status, "SUBMITTED");
  assert.equal(res.promotedFromDraft, true, "the caller has to know, so it can cancel the §6.4 sequence");
  assert.ok(res.updatedFields.includes("status"));
});

test("a DRAFT submission does NOT promote — an incomplete capture stays a draft", async () => {
  const { attachOrCreateOpenRequest } = await svc();
  const id = seedRequest("DRAFT");

  const res = await attachOrCreateOpenRequest({
    buyerId: "buyer_1",
    createStatus: "DRAFT",
    data: { zip: "75035" },
  });

  assert.equal(res.vehicleRequest.id, id);
  assert.equal(res.vehicleRequest.status, "DRAFT", "§5 rule 6: incomplete is a draft, never a dead end");
  assert.equal(res.promotedFromDraft, false);
});

test("promotion is forward ONLY — a live request is never rewound to SUBMITTED", async () => {
  const { attachOrCreateOpenRequest } = await svc();
  // Every open status that is already past SUBMITTED. Rewinding any of them
  // because a buyer re-submitted a form would rewind a live auction.
  for (const status of [
    "SUBMITTED",
    "INTAKE",
    "PAYMENT_REQUIRED",
    "ACTIVE_SOURCING",
    "RADIUS_AUTHORIZATION_REQUIRED",
    "OFFER_READY",
    "OFFER_SENT",
    "OFFER_ACCEPTED",
    "OFFER_DECLINED",
  ]) {
    db.reset();
    seedRequest(status);
    const res = await attachOrCreateOpenRequest({
      buyerId: "buyer_1",
      createStatus: "SUBMITTED",
      data: { makePreference: "Toyota" },
    });
    assert.equal(res.vehicleRequest.status, status, `${status} must survive a re-submission unchanged`);
    assert.equal(res.promotedFromDraft, false, `${status} is not a draft promotion`);
  }
});

test("a no-op merge on a DRAFT still promotes — the status IS the change", async () => {
  const { attachOrCreateOpenRequest } = await svc();
  // Every incoming field is already held, so the merge computes zero field
  // changes. Before the fix that returned early and the draft stayed a draft.
  const id = seedRequest("DRAFT", { makePreference: "Toyota", zip: "75035" });

  const res = await attachOrCreateOpenRequest({
    buyerId: "buyer_1",
    createStatus: "SUBMITTED",
    data: { makePreference: "Toyota", zip: "75035" },
  });

  assert.equal(res.vehicleRequest.id, id);
  assert.equal(res.vehicleRequest.status, "SUBMITTED", "a resubmission that adds no new field still completes the draft");
  assert.equal(res.promotedFromDraft, true);
  assert.deepEqual(res.updatedFields, ["status"]);
});

test("a NEW request reports no promotion — there was no draft to promote", async () => {
  const { attachOrCreateOpenRequest } = await svc();
  const res = await attachOrCreateOpenRequest({
    buyerId: "buyer_1",
    createStatus: "SUBMITTED",
    data: { makePreference: "Toyota" },
  });

  assert.equal(res.outcome, "CREATED");
  assert.equal(res.vehicleRequest.status, "SUBMITTED");
  assert.equal(res.promotedFromDraft, false, "a create is not a promotion; cancelling a sequence that was never enqueued would be a lie");
});
