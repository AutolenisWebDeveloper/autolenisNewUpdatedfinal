// §34 pass condition — cross-portal parity, measured rather than assumed.
//
// §34, verbatim: "The test passes only when the buyer portal, the dealership portal,
// and the Operations queue all display the same current checkpoint, the same
// responsible party, the same deadline, and the same recovery action, against one
// unbroken transaction lineage."
//
// WHY THIS TEST IS SHAPED THIS WAY. §8.1j records the parity work as
// "Buyer panel, dealer notice and the existing Ops queue now read one projection"
// (IMPLEMENTATION-WORKFLOW.md L3080-3084), and `components/buyer/
// TransactionExceptionPanel.tsx:20` repeats the claim in a comment. Two of the three
// do. `app/admin/queues/page.tsx` does not: it fetches
// `/api/admin/queues/[queueType]` -> `admin-queue.service.ts` -> `listOpen`, reads
// raw `queue_items` columns in `exceptionFields()` (page.tsx:53-66) and renders them
// itself. `audience: "OPS"` has no production caller at all.
//
// So the question §34 asks is genuinely open, and this test measures it instead of
// assuming an answer in either direction. It separates two claims that are easy to
// merge and are not the same:
//
//   IDENTITY parity — all three surfaces are fed by the same `queue_items` row, so
//   they agree on WHICH exception, WHICH owner role and WHICH deadline instant.
//
//   DISPLAY parity — what §34 actually requires: the same checkpoint text, the same
//   responsible-party label, the same deadline rendering, the same recovery text.
//
// The fixture creates its exception through `raiseException`, the production writer
// (`queue-item.service.ts:181`), never through a raw insert. A hand-written
// `queue_items` row could carry a `required_action` or a `buyer_visible_status` that
// production never produces, and the comparison would then be between two fictions.

import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma, assertNonEmpty, provesDiscriminating, uid } from "./_harness";
import { raiseException } from "@/lib/services/operations/queue-item.service";
import { exceptionLineage, DEALER_VISIBLE_EXCEPTION_CODES } from "@/lib/services/operations/exception-lineage.service";
import { EXCEPTION_CATALOGUE } from "@/lib/services/operations/exception-catalogue";

/**
 * The Operations queue's own field extraction, reproduced EXACTLY as
 * `app/admin/queues/page.tsx:53-66` performs it.
 *
 * Reproduced rather than imported because the page is a client component and the
 * function is not exported — which is itself the point. A projection that only one
 * surface can compute is a projection the other two cannot share.
 */
function opsQueueFields(row: {
  exceptionCode: string | null;
  ownerRole: string | null;
  requiredAction: string | null;
  returnPoint: string | null;
  deadlineAt: Date | null;
}) {
  return {
    code: row.exceptionCode,
    owner: row.ownerRole,
    action: row.requiredAction,
    returnPoint: row.returnPoint,
    deadline: row.deadlineAt,
  };
}

/**
 * The §34 four-field comparison, as ONE function.
 *
 * WHY IT IS A FUNCTION AND NOT INLINE. The first version computed
 * `checkpointsAgree` / `ownerLabelsAgree` inline in the measurement test, and the
 * "discrimination" cases below built their own object literals and re-did the `!==`
 * themselves. The second independent review proved what that meant: hard-coding
 * `checkpointsAgree = true` destroyed the real comparison and the test named
 * "the parity comparison is discriminating" STAYED GREEN. A vacuity proof that is
 * itself vacuous licenses everything it guards, which made it the single most
 * dangerous assertion in this package.
 *
 * Now there is one implementation. The measurement calls it, and the discrimination
 * proof calls THE SAME function with perturbed inputs — so a change that breaks the
 * comparison breaks the proof too. That is the property "discriminating" has to mean.
 */
export function divergences(
  rendered: { code: string | null; owner: string | null; action: string | null; deadline: Date | null },
  projected: { checkpoint: string; ownerLabel: string; recovery: string; deadlineAt: string | null },
): string[] {
  const out: string[] = [];
  if (rendered.code !== projected.checkpoint)
    out.push(`checkpoint: Ops page renders "${rendered.code}", projection renders "${projected.checkpoint}"`);
  if (rendered.owner !== projected.ownerLabel)
    out.push(`responsible party: Ops page renders "${rendered.owner}", projection renders "${projected.ownerLabel}"`);
  if (rendered.action !== projected.recovery)
    out.push(`recovery: Ops page renders ${JSON.stringify(rendered.action)}, projection renders ${JSON.stringify(projected.recovery)}`);
  return out;
}

let buyerId = "";
let userId = "";
let dealerId = "";
let dealerUserId = "";

before(async () => {
  const email = `${uid("parity-buyer")}@example.test`;
  const user = await prisma.user.create({
    data: { email, role: "BUYER", supabaseId: uid("parity-supabase") },
  });
  userId = user.id;
  const buyer = await prisma.buyer.create({
    data: { userId: user.id, firstName: "Parity", lastName: "Fixture" },
  });
  buyerId = buyer.id;

  // The DEALER leg needs a dealership. `exception-lineage.service.ts` returns nothing to
  // the dealer audience for a row with no `dealer_id`, so a buyer-only fixture would have
  // made the third portal silently unmeasurable — which is exactly what the first version
  // of this file did while the report claimed all three were compared.
  const dealerUser = await prisma.user.create({
    data: { email: `${uid("parity-dealer")}@example.test`, role: "DEALER", supabaseId: uid("parity-dsb") },
  });
  dealerUserId = dealerUser.id;
  const dealer = await prisma.dealer.create({
    data: { userId: dealerUser.id, dealershipName: "Parity Motors" },
  });
  dealerId = dealer.id;
});

after(async () => {
  await prisma.queueItem.deleteMany({ where: { buyerId } });
  await prisma.buyer.deleteMany({ where: { id: buyerId } });
  await prisma.dealer.deleteMany({ where: { id: dealerId } });
  await prisma.user.deleteMany({ where: { id: { in: [userId, dealerUserId] } } });
  await prisma.$disconnect();
});

// ── The exception used for the comparison ────────────────────────────────────
//
// Chosen from the catalogue rather than hard-coded: it must be a code the BUYER and
// the DEALER can both see, or the comparison is between a rendered row and two
// blanks. `buyerVisibleStatus !== null` is §26's "the buyer is shown this";
// DEALER_VISIBLE_CODES is the dealer's fail-closed allowlist.
function pickTriPortalCode(): string {
  const candidates = EXCEPTION_CATALOGUE.filter(
    (d: { code: string; buyerVisibleStatus: string | null }) =>
      d.buyerVisibleStatus !== null && DEALER_VISIBLE_EXCEPTION_CODES.includes(d.code),
  );
  assertNonEmpty(
    candidates,
    "codes visible to buyer AND dealer AND ops — without one, three-portal parity cannot be measured at all",
  );
  return candidates[0].code;
}

test("§34 — one lineage: all three surfaces are fed by the same queue_items row", async () => {
  const code = pickTriPortalCode();
  const raised = await raiseException({
    code: code as never,
    buyerId,
    dealerId,
    detail: "Phase 11 acceptance — cross-portal parity probe",
  });

  const row = await prisma.queueItem.findUniqueOrThrow({ where: { id: raised.item.id } });

  const buyerRows = await exceptionLineage({ audience: "BUYER", buyerId });
  const opsRows = await exceptionLineage({ audience: "OPS", buyerId });
  // THE THIRD PORTAL. Omitting this is how the first version of this file measured two
  // surfaces while the report claimed three.
  const dealerRows = await exceptionLineage({ audience: "DEALER", dealerId });

  assertNonEmpty(buyerRows, "buyer lineage rows — an empty projection would make every field below vacuously equal");
  assertNonEmpty(opsRows, "ops lineage rows");
  assertNonEmpty(dealerRows, "dealer lineage rows — without these the third portal is untested, not equal");

  const buyerView = buyerRows.find((r) => r.id === raised.item.id);
  const opsView = opsRows.find((r) => r.id === raised.item.id);
  const dealerView = dealerRows.find((r) => r.id === raised.item.id);
  assert.ok(buyerView, "the buyer projection must contain the row that was raised");
  assert.ok(opsView, "the ops projection must contain the row that was raised");
  assert.ok(dealerView, "the DEALER projection must contain the row that was raised");

  // IDENTITY parity — the same row, the same code, the same owner, the same instant,
  // across ALL THREE audiences.
  for (const [name, view] of [["ops", opsView], ["dealer", dealerView]] as const) {
    assert.equal(buyerView.exceptionCode, view.exceptionCode, `same exception code (buyer vs ${name})`);
    assert.equal(buyerView.owner, view.owner, `same owner ROLE (buyer vs ${name})`);
    assert.equal(buyerView.deadlineAt, view.deadlineAt, `same deadline instant (buyer vs ${name})`);
  }
  assert.equal(buyerView.exceptionCode, row.exceptionCode, "projection agrees with the stored row");
});

test("§34 — DISPLAY parity: what the Operations queue actually renders vs what the projection renders", async () => {
  const code = pickTriPortalCode();
  // Raised here rather than reused from test 1. The first version reused it, which made
  // this test fail with a Prisma "no row found" — an unrelated error — whenever it was run
  // alone with --test-name-pattern, so a triaging reader saw a broken test instead of a
  // measurement.
  const own = await raiseException({
    code: code as never,
    buyerId,
    dealerId,
    occurrenceKey: "display-parity",
    detail: "Phase 11 acceptance — display parity probe",
  });
  const row = await prisma.queueItem.findUniqueOrThrow({ where: { id: own.item.id } });

  const opsProjected = (await exceptionLineage({ audience: "OPS", buyerId })).find((r) => r.id === row.id);
  assert.ok(opsProjected, "ops projection must contain the row");

  const opsRendered = opsQueueFields(row);

  // The four fields, through the ONE shared comparison. Nothing is recomputed here.
  const found = divergences(opsRendered, opsProjected);

  // §34 field 3 — the deadline — is the control, and it is compared separately because
  // its job is to prove the comparison is wired at all. Guarded first: `pickTriPortalCode`
  // returns `candidates[0]`, so a catalogue reorder could hand this test a code with no
  // deadline, and two nulls compare equal — passing the control while comparing nothing.
  assert.ok(
    opsProjected.deadlineAt !== null && opsRendered.deadline !== null,
    "CONTROL PRECONDITION: the chosen exception must carry a deadline on both sides. " +
      "Two nulls compare equal and would pass this control while comparing nothing.",
  );
  assert.equal(
    opsRendered.deadline?.toISOString() ?? null,
    opsProjected.deadlineAt,
    "CONTROL: the deadline instant must agree between the projection and the page's own " +
      "extraction. If this fails the comparison is broken, not the parity.",
  );

  assert.deepEqual(
    found,
    [],
    "§34 requires the buyer portal, the dealership portal and the Operations queue to DISPLAY the " +
      "same checkpoint, responsible party, deadline and recovery action. The Operations queue does " +
      "not read `exceptionLineage` — it reads raw `queue_items` columns in `app/admin/queues/" +
      "page.tsx:53-66` and renders them itself, so `audience: \"OPS\"` has no production caller. " +
      "Measured divergences:\n  - " +
      found.join("\n  - "),
  );
});

test("the parity comparison is discriminating — proven against the REAL comparison", () => {
  // Every case below calls `divergences()` — the same function the measurement calls.
  // A change that breaks the comparison breaks these too. The earlier version built
  // object literals and re-did the `!==` inline, which proved only that
  // `assert.deepEqual(["x"], [])` throws; the second independent review destroyed the
  // real comparison and watched this test stay green.
  const agreeing = {
    rendered: { code: "Contract overdue from dealer", owner: "Operations", action: "Do the thing", deadline: new Date(0) },
    projected: { checkpoint: "Contract overdue from dealer", ownerLabel: "Operations", recovery: "Do the thing", deadlineAt: new Date(0).toISOString() },
  };

  // Sanity: the shared function must report agreement when the inputs agree. Without
  // this, a `divergences()` that always returned [] would pass every case below.
  assert.deepEqual(
    divergences(agreeing.rendered, agreeing.projected),
    [],
    "the shared comparison must report NO divergence when every field agrees — otherwise " +
      "the seeded cases below prove nothing",
  );

  provesDiscriminating("parity: a checkpoint divergence is detected by the real comparison", () => {
    const found = divergences({ ...agreeing.rendered, code: "CONTRACT_OVERDUE_FROM_DEALER" }, agreeing.projected);
    assert.deepEqual(found, []);
  });

  provesDiscriminating("parity: an owner-label divergence is detected by the real comparison", () => {
    const found = divergences({ ...agreeing.rendered, owner: "OPERATIONS" }, agreeing.projected);
    assert.deepEqual(found, []);
  });

  provesDiscriminating("parity: a recovery divergence is detected by the real comparison", () => {
    const found = divergences({ ...agreeing.rendered, action: "something else" }, agreeing.projected);
    assert.deepEqual(found, []);
  });

  provesDiscriminating("parity: an empty projection is refused, not treated as agreement", () => {
    assertNonEmpty([], "seeded empty projection");
  });
});
