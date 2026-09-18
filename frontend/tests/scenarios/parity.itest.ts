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

let buyerId = "";
let userId = "";

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
});

after(async () => {
  await prisma.queueItem.deleteMany({ where: { buyerId } });
  await prisma.buyer.deleteMany({ where: { id: buyerId } });
  await prisma.user.deleteMany({ where: { id: userId } });
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
    detail: "Phase 11 acceptance — cross-portal parity probe",
  });

  const row = await prisma.queueItem.findUniqueOrThrow({ where: { id: raised.item.id } });

  const buyerRows = await exceptionLineage({ audience: "BUYER", buyerId });
  const opsRows = await exceptionLineage({ audience: "OPS", buyerId });

  assertNonEmpty(buyerRows, "buyer lineage rows — an empty projection would make every field below vacuously equal");
  assertNonEmpty(opsRows, "ops lineage rows");

  const buyerView = buyerRows.find((r) => r.id === raised.item.id);
  const opsView = opsRows.find((r) => r.id === raised.item.id);
  assert.ok(buyerView, "the buyer projection must contain the row that was raised");
  assert.ok(opsView, "the ops projection must contain the row that was raised");

  // IDENTITY parity — the same row, the same code, the same owner, the same instant.
  assert.equal(buyerView.exceptionCode, opsView.exceptionCode, "same exception code");
  assert.equal(buyerView.owner, opsView.owner, "same owner ROLE (the enum, not the label)");
  assert.equal(buyerView.deadlineAt, opsView.deadlineAt, "same deadline instant");
  assert.equal(buyerView.exceptionCode, row.exceptionCode, "projection agrees with the stored row");
});

test("§34 — DISPLAY parity: what the Operations queue actually renders vs what the projection renders", async () => {
  const code = pickTriPortalCode();
  const existing = await prisma.queueItem.findFirst({ where: { buyerId, exceptionCode: code } });
  const row = existing ?? (await prisma.queueItem.findFirstOrThrow({ where: { buyerId } }));

  const opsProjected = (await exceptionLineage({ audience: "OPS", buyerId })).find((r) => r.id === row.id);
  assert.ok(opsProjected, "ops projection must contain the row");

  const opsRendered = opsQueueFields(row);

  // §34 field 1 — "the same current checkpoint".
  //
  // The projection renders the catalogue's human label. The page renders the raw
  // enum. These are not the same string, and an operator comparing notes with a
  // buyer over the phone is comparing "Vehicle hold expired" with
  // "VEHICLE_HOLD_EXPIRED".
  const checkpointsAgree = opsRendered.code === opsProjected.checkpoint;

  // §34 field 2 — "the same responsible party".
  const ownerLabelsAgree = opsRendered.owner === opsProjected.ownerLabel;

  // §34 field 3 — "the same deadline". Same instant; compared as instants.
  const deadlinesAgree =
    (opsRendered.deadline?.toISOString() ?? null) === opsProjected.deadlineAt;

  // §34 field 4 — "the same recovery action".
  const recoveryAgrees = opsRendered.action === opsProjected.recovery;

  // This test RECORDS the measurement rather than asserting a predetermined answer.
  // The deadline is the field the two paths genuinely share, so it is the control:
  // if it disagreed, the comparison itself would be broken and the other three
  // results would mean nothing.
  assert.equal(
    deadlinesAgree,
    true,
    "CONTROL: the deadline instant must agree between the projection and the page's own " +
      "extraction. If this fails the comparison is broken, not the parity.",
  );

  const divergences: string[] = [];
  if (!checkpointsAgree)
    divergences.push(
      `checkpoint: Ops page renders "${opsRendered.code}", projection renders "${opsProjected.checkpoint}"`,
    );
  if (!ownerLabelsAgree)
    divergences.push(
      `responsible party: Ops page renders "${opsRendered.owner}", projection renders "${opsProjected.ownerLabel}"`,
    );
  if (!recoveryAgrees)
    divergences.push(
      `recovery: Ops page renders ${JSON.stringify(opsRendered.action)}, projection renders ${JSON.stringify(opsProjected.recovery)}`,
    );

  assert.deepEqual(
    divergences,
    [],
    "§34 requires the buyer portal, the dealership portal and the Operations queue to DISPLAY the " +
      "same checkpoint, responsible party, deadline and recovery action. The Operations queue does " +
      "not read `exceptionLineage` — it reads raw `queue_items` columns in `app/admin/queues/" +
      "page.tsx:53-66` and renders them itself, so `audience: \"OPS\"` has no production caller. " +
      "Measured divergences:\n  - " +
      divergences.join("\n  - "),
  );
});

test("the parity comparison is discriminating — it fails on a seeded divergence", () => {
  // If the comparison above cannot fail, its green result means nothing. Prove it can.
  provesDiscriminating("parity: checkpoint divergence is detected", () => {
    const rendered = { code: "VEHICLE_HOLD_EXPIRED" };
    const projected = { checkpoint: "Vehicle hold expired" };
    const divergences: string[] = [];
    if (rendered.code !== projected.checkpoint) divergences.push("checkpoint");
    assert.deepEqual(divergences, []);
  });

  provesDiscriminating("parity: owner-label divergence is detected", () => {
    const rendered = { owner: "OPERATIONS" };
    const projected = { ownerLabel: "Operations" };
    const divergences: string[] = [];
    if (rendered.owner !== projected.ownerLabel) divergences.push("owner");
    assert.deepEqual(divergences, []);
  });

  provesDiscriminating("parity: an empty projection is refused, not treated as agreement", () => {
    assertNonEmpty([], "seeded empty projection");
  });
});
