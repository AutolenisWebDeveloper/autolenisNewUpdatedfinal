// §Stage 21 — post-completion dealership obligations.
//
// THE CLAUSE EVERYTHING HERE IS PROTECTING is "Tracked as child records of the completed Deal,
// WITHOUT REOPENING OR ALTERING IT." §Stage 20 makes COMPLETED terminal and corrections
// append-only, so an obligation that wrote to `deals` — a status, a cleared `completed_at`, a
// re-opened flag — would undo the terminality of the stage before it. The Deal client in this
// fixture therefore has NO update method at all: an attempt to write one is a TypeError, not a
// silent pass, and the test that proves it would fail loudly rather than assert nothing.
//
// AND THE FOUR CONSEQUENCES, WHICH ARE ONE TRANSITION. "Overdue obligations notify the buyer and
// the dealership, escalate to Operations, and register on the dealership scorecard." All four
// hang off the PENDING → OVERDUE compare-and-swap, so the test that matters most is the second
// sweep: an overdue obligation that is chased again on every run is how a chase becomes a reason
// to mute the sender.
//
// Run with:
//   npx tsx --test --experimental-test-module-mocks \
//     "lib/services/deal/__tests__/post-completion-obligations.test.ts"

import test, { beforeEach, mock } from "node:test";
import assert from "node:assert/strict";

type Row = Record<string, unknown>;

interface Ctrl {
  dealStatus: string;
  obligations: Row[];
  outbox: Row[];
  exceptions: Row[];
  nextId: number;
  /** Makes the dispatcher throw for exactly one obligation, so the sweep's resilience is real. */
  failEnqueueFor: string | null;
}
let ctrl: Ctrl;

const match = (row: Row, where: Row): boolean =>
  Object.entries(where).every(([k, v]) => {
    if (v !== null && typeof v === "object" && "not" in (v as Row)) return row[k] !== (v as Row).not;
    return row[k] === v;
  });

mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      // NO `update`. See the header: an obligation that alters the completed Deal must be a
      // hard failure in this fixture, not an assertion somebody can delete.
      deal: { findUnique: async () => ({ id: "deal_1", status: ctrl.dealStatus }) },
      postCompletionObligation: {
        findFirst: async ({ where }: { where: Row }) => ctrl.obligations.find((o) => match(o, where)) ?? null,
        findMany: async ({ where }: { where: Row }) =>
          ctrl.obligations
            .filter((o) => o.status === (where.status as string))
            .filter((o) => {
              const d = where.dueAt as Row | undefined;
              return !d || (o.dueAt instanceof Date && d.lt instanceof Date && o.dueAt < d.lt);
            })
            .map((o) => ({
              ...o,
              deal: {
                id: "deal_1",
                buyerId: "buyer_1",
                dealerId: "dlr_1",
                buyer: { firstName: "Ada", user: { email: "ada@example.com" } },
                offer: { dealerId: "dlr_1", dealer: { dealershipName: "North Motors", user: { email: "sales@north.example" } } },
              },
            })),
        create: async ({ data }: { data: Row }) => {
          const row = { ...data, id: data.id ?? `ob_${++ctrl.nextId}` };
          ctrl.obligations.push(row);
          return row;
        },
        updateMany: async ({ where, data }: { where: Row; data: Row }) => {
          const hits = ctrl.obligations.filter((o) => match(o, where));
          hits.forEach((o) => Object.assign(o, data));
          return { count: hits.length };
        },
      },
    },
  },
});

mock.module("@/lib/services/comms/transactional-dispatcher.service", {
  namedExports: {
    enqueueTransactional: async (input: Row) => {
      // The failure is driven through the FIXTURE, not through a second `mock.module`. node:test
      // module mocks are captured at import, so re-mocking mid-file does not reach a service that
      // has already bound the export — a test written that way passes while proving nothing.
      if (ctrl.failEnqueueFor && (input.payload as Row)?.obligationId === ctrl.failEnqueueFor) {
        throw new Error("outbox unavailable");
      }
      ctrl.outbox.push(input);
      return { queued: true };
    },
  },
});

mock.module("@/lib/services/operations/queue-item.service", {
  namedExports: {
    raiseException: async (input: Row) => { ctrl.exceptions.push(input); return { item: { id: "qi_1" }, created: true }; },
  },
});

const svc = () => import("../post-completion-obligations.service");

const NOW = new Date("2026-03-01T12:00:00Z");
const PAST_DUE = new Date("2026-02-01T12:00:00Z");

beforeEach(() => {
  ctrl = { dealStatus: "COMPLETED", obligations: [], outbox: [], exceptions: [], nextId: 0, failEnqueueFor: null };
});

test("the five obligation types are the document's five, and the count is asserted not trusted", async () => {
  const { OBLIGATION_TYPES, STAGE_21_OBLIGATION_TYPE_COUNT } = await svc();

  assert.equal(Object.keys(OBLIGATION_TYPES).length, STAGE_21_OBLIGATION_TYPE_COUNT);
  assert.equal(STAGE_21_OBLIGATION_TYPE_COUNT, 5, "the constant must equal the document's count, not merely the code's");
  assert.deepEqual(Object.keys(OBLIGATION_TYPES), [
    "TITLE_AND_REGISTRATION",
    "TRADE_PAYOFF",
    "DUE_BILL_REPAIRS",
    "MISSING_ACCESSORIES",
    "DOCUMENT_CORRECTION",
  ], "§Stage 21 lists these five, in this order");

  for (const [key, spec] of Object.entries(OBLIGATION_TYPES)) {
    assert.ok(spec.label.length > 0, `${key}: an obligation with no label cannot be shown to anyone`);
    assert.ok(spec.defaultDueDays > 0, `${key}: an obligation with no due window can never become overdue`);
  }
});

test("an obligation cannot be opened against a deal that is not COMPLETED", async () => {
  // A precondition BLOCKS completion; an obligation exists only BECAUSE completion happened.
  // Opening one early makes the two indistinguishable.
  ctrl.dealStatus = "HANDOVER_PENDING";

  const out = await (await svc()).openObligation({ dealId: "deal_1", type: "TITLE_AND_REGISTRATION" });

  assert.deepEqual(out, { ok: false, reason: "not_completed" });
  assert.equal(ctrl.obligations.length, 0);
});

test("the dealership owns every obligation — AutoLenis tracks, it does not perform", async () => {
  await (await svc()).openObligation({ dealId: "deal_1", type: "TITLE_AND_REGISTRATION", now: NOW });

  assert.equal(ctrl.obligations[0].ownerRole, "DEALERSHIP",
    "§Stage 21: 'The dealership remains responsible for performance. AutoLenis tracks status and communication.'");
  assert.equal(ctrl.obligations[0].status, "PENDING", "OVERDUE is reached by the sweep, never written at creation");
});

test("opening the same obligation twice yields one row, not two", async () => {
  const s = await svc();
  const first = await s.openObligation({ dealId: "deal_1", type: "MISSING_ACCESSORIES", now: NOW });
  const second = await s.openObligation({ dealId: "deal_1", type: "MISSING_ACCESSORIES", now: NOW });

  assert.equal(first.ok && first.created, true);
  assert.equal(second.ok && second.created, false, "a buyer reporting a missing key twice has one obligation");
  assert.equal(second.ok && second.id, first.ok && first.id);
  assert.equal(ctrl.obligations.length, 1, "a duplicate would double-count on the dealership's scorecard");
});

test("an overdue obligation notifies BOTH parties, escalates, and moves to OVERDUE", async () => {
  await (await svc()).openObligation({ dealId: "deal_1", type: "TITLE_AND_REGISTRATION", dueAt: PAST_DUE, now: PAST_DUE });

  const result = await (await svc()).sweepOverdueObligations(NOW);

  assert.equal(result.markedOverdue, 1);
  assert.equal(ctrl.obligations[0].status, "OVERDUE", "the swap IS the scorecard entry — it counts OVERDUE rows");
  assert.deepEqual(
    ctrl.outbox.map((o) => o.recipientKind).sort(),
    ["buyer", "dealer"],
    "§Stage 21: 'notify the buyer and the dealership' — both, on their own rails"
  );
  assert.equal(ctrl.exceptions.length, 1, "'escalate to Operations'");
  assert.equal(ctrl.exceptions[0].code, "POST_COMPLETION_OBLIGATION_OVERDUE");
  assert.equal(ctrl.exceptions[0].dealerId, "dlr_1", "the escalation must name the dealership that owes it");
});

test("a SECOND sweep chases nobody — the swap is what makes the consequences fire once", async () => {
  await (await svc()).openObligation({ dealId: "deal_1", type: "TITLE_AND_REGISTRATION", dueAt: PAST_DUE, now: PAST_DUE });
  await (await svc()).sweepOverdueObligations(NOW);
  const after = { outbox: ctrl.outbox.length, exceptions: ctrl.exceptions.length };

  const second = await (await svc()).sweepOverdueObligations(new Date(NOW.getTime() + 86_400_000));

  assert.equal(second.scanned, 0, "an OVERDUE row is no longer PENDING, so the sweep does not see it again");
  assert.equal(ctrl.outbox.length, after.outbox, "chasing on every run is how a sender gets muted");
  assert.equal(ctrl.exceptions.length, after.exceptions);
});

test("the two parties are told different things, on different template keys", async () => {
  await (await svc()).openObligation({ dealId: "deal_1", type: "TRADE_PAYOFF", dueAt: PAST_DUE, now: PAST_DUE });
  await (await svc()).sweepOverdueObligations(NOW);

  const buyerMsg = ctrl.outbox.find((o) => o.recipientKind === "buyer")!;
  const dealerMsg = ctrl.outbox.find((o) => o.recipientKind === "dealer")!;

  assert.notEqual(buyerMsg.templateKey, dealerMsg.templateKey,
    "§27 partitions rails by template_key — one key for both would put the dealership's message on the buyer's rail");
  assert.match(String((buyerMsg.payload as Row).html), /do not need to do anything/i,
    "the buyer is owed nothing here; telling them to chase it would be wrong");
  assert.match(String((dealerMsg.payload as Row).html), /scorecard/i,
    "the dealership is told the consequence, because it is the party that can act");
  assert.equal((buyerMsg.payload as Row).obligationId, ctrl.obligations[0].id,
    "the recheck reads this to skip a chase for an obligation resolved in the meantime");
});

test("an obligation resolved BEFORE its due date never becomes overdue", async () => {
  const opened = await (await svc()).openObligation({ dealId: "deal_1", type: "DUE_BILL_REPAIRS", dueAt: PAST_DUE, now: PAST_DUE });
  assert.ok(opened.ok);
  await (await svc()).resolveObligation(opened.id, { now: new Date("2026-01-15T00:00:00Z") });

  const result = await (await svc()).sweepOverdueObligations(NOW);

  assert.equal(result.scanned, 0);
  assert.equal(ctrl.obligations[0].status, "RESOLVED");
  assert.equal(ctrl.outbox.length, 0, "nobody is chased about work that is done");
});

test("RESOLVED is terminal — resolving twice does not re-resolve", async () => {
  const opened = await (await svc()).openObligation({ dealId: "deal_1", type: "DOCUMENT_CORRECTION", now: NOW });
  assert.ok(opened.ok);

  assert.equal(await (await svc()).resolveObligation(opened.id), true);
  assert.equal(await (await svc()).resolveObligation(opened.id), false, "the second call matches zero rows");
});

test("nothing in this stage writes to the completed Deal", async () => {
  // The Deal client in this fixture has no `update`, so any write is a TypeError rather than a
  // silent pass. The whole flow runs against it: open, sweep, resolve.
  const s = await svc();
  const opened = await s.openObligation({ dealId: "deal_1", type: "TITLE_AND_REGISTRATION", dueAt: PAST_DUE, now: PAST_DUE });
  await s.sweepOverdueObligations(NOW);
  assert.ok(opened.ok);
  await s.resolveObligation(opened.id);

  assert.equal(ctrl.dealStatus, "COMPLETED", "§Stage 21: tracked 'without reopening or altering' the Deal");
});

test("a sweep that fails on one obligation still processes the rest", async () => {
  const s = await svc();
  const first = await s.openObligation({ dealId: "deal_1", type: "TITLE_AND_REGISTRATION", dueAt: PAST_DUE, now: PAST_DUE });
  await s.openObligation({ dealId: "deal_1", type: "TRADE_PAYOFF", dueAt: PAST_DUE, now: PAST_DUE });
  assert.ok(first.ok);
  ctrl.failEnqueueFor = first.id;

  const result = await s.sweepOverdueObligations(NOW);

  assert.equal(result.scanned, 2);
  assert.equal(result.failed, 1, "the first obligation's notification threw");

  // BOTH ESCALATED, INCLUDING THE ONE WHOSE CHASE MESSAGE FAILED. This assertion read
  // `escalated === 1` and was describing the defect rather than the requirement: the escalation
  // used to run AFTER the two notification blocks, so a throw in either took the Operations case
  // down with it. The swap to OVERDUE has already committed by then and the next sweep matches
  // zero rows, so that case was lost permanently — the one thing §Stage 21 needs to put an
  // overdue obligation in front of a person. `raiseException` now runs first.
  assert.equal(result.escalated, 2, "a failed chase message must not cost the row its Operations case");
  assert.equal(
    ctrl.exceptions.filter((e) => e.code === "POST_COMPLETION_OBLIGATION_OVERDUE").length,
    2,
    "and the case is really raised for both, not merely counted",
  );
  assert.ok(
    ctrl.exceptions.some((e) => String(e.idempotencyKey ?? "").endsWith(first.id!)),
    "specifically including the obligation whose notification threw",
  );
  assert.equal(
    ctrl.obligations.find((o) => o.id === first.id)!.status,
    "OVERDUE",
    "the swap committed BEFORE the notification, so a failed chase does not re-fire on every later run",
  );
});
