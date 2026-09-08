// §6.4's second half, wired: completing a draft cancels its recovery sequence.
//
// The four touches are enqueued at capture and cancelled together by their shared
// key "when the request advances". Until this was wired, nothing advanced them —
// `cancelDraftRecovery` had exactly one caller, the 14-day abandonment sweep — so
// a buyer who came back and submitted a complete request kept receiving all four
// "finish your request" emails. The send-time recheck did not save them either,
// because the request was still DRAFT: `attachOrCreateOpenRequest` preserved the
// existing status, so completing a draft left it a draft.
//
// This exercises the REAL dispatcher against the shared in-memory Prisma, so it
// proves the write and the cancel actually happen inside the intake transaction
// rather than that a mock was called.
//
// Run: pnpm test:intake

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { makeFakePrisma, type FakeDb } from "./fake-prisma";

const db: FakeDb = makeFakePrisma();
mock.module("@/lib/prisma", { namedExports: { prisma: db.client } });
mock.module("@/lib/logger", { namedExports: { logger: { info: () => {}, warn: () => {}, error: () => {} } } });

async function intake() {
  return (await import("@/lib/services/acquisition/unified-buyer-intake.service")).intakeBuyerRequest;
}
async function recovery() {
  return import("@/lib/services/acquisition/draft-recovery.service");
}

beforeEach(() => db.reset());

const CAPTURE = {
  source: "request_vehicle_wizard" as const,
  email: "draft-completer@example.invalid",
  zip: "75035",
  firstName: "Sam",
};

test("completing a draft promotes it AND cancels all four recovery touches", async () => {
  const intakeBuyerRequest = await intake();
  const { enqueueDraftRecovery } = await recovery();

  // 1. The homepage hero captures a partial request as a DRAFT.
  const draft = await intakeBuyerRequest({ ...CAPTURE, draft: true });
  assert.ok(draft.vehicleRequestId, "a draft capture persists a request");
  const request = db.state.vehicleRequests.get(draft.vehicleRequestId)!;
  assert.equal(request.status, "DRAFT");

  // 2. The route enqueues §6.4's sequence for it.
  const { enqueued } = await enqueueDraftRecovery({ vehicleRequestId: draft.vehicleRequestId!, email: CAPTURE.email });
  assert.equal(enqueued, 4, "all four touches exist the moment the tab closes");
  assert.equal(
    [...db.state.commsOutbox.values()].filter((r) => r.status === "pending").length,
    4,
  );

  // 3. The buyer comes back and submits a COMPLETE request.
  const complete = await intakeBuyerRequest({ ...CAPTURE, make: "Toyota" });

  assert.equal(complete.vehicleRequestId, draft.vehicleRequestId, "§5 rule 5: one open request, updated not duplicated");
  assert.equal(
    db.state.vehicleRequests.get(draft.vehicleRequestId!)!.status,
    "SUBMITTED",
    "a completed draft is no longer a draft",
  );

  const rows = [...db.state.commsOutbox.values()];
  assert.equal(rows.length, 4, "cancelling never deletes — the rows and their history stay");
  assert.equal(
    rows.filter((r) => r.status === "cancelled").length,
    4,
    "the shared cancel key stops the whole sequence at once",
  );
  assert.ok(
    rows.every((r) => r.cancelledAt instanceof Date && typeof r.cancelReason === "string"),
    "every cancelled row records when and why",
  );
});

test("a second DRAFT capture does NOT cancel the sequence — nothing advanced", async () => {
  const intakeBuyerRequest = await intake();
  const { enqueueDraftRecovery } = await recovery();

  const draft = await intakeBuyerRequest({ ...CAPTURE, draft: true });
  await enqueueDraftRecovery({ vehicleRequestId: draft.vehicleRequestId!, email: CAPTURE.email });

  // The buyer edits their draft and saves it again. Still incomplete, so the
  // sequence must keep running: cancelling here would silently drop the recovery.
  await intakeBuyerRequest({ ...CAPTURE, draft: true, zip: "75034" });

  assert.equal(db.state.vehicleRequests.get(draft.vehicleRequestId!)!.status, "DRAFT");
  assert.equal(
    [...db.state.commsOutbox.values()].filter((r) => r.status === "pending").length,
    4,
    "an incomplete re-capture leaves the sequence intact",
  );
});
