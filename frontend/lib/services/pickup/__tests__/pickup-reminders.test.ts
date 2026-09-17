// §Stage 17's APPOINTMENT reminders — the seven-item list, the markers, and the missed pickup.
//
// A CLAIM I WROTE AND THEN CHECKED, WHICH IS WHY THE LAST TEST IN THIS FILE EXISTS. The reminders
// service originally carried a comment saying the markers "are cleared on a reschedule by the
// coordination service, which is what re-arms both reminders for the new appointment". They were
// not. `reminder_24h_sent_at` and `reminder_2h_sent_at` arrived with the Phase 1 wave and nothing
// had ever written them, so nothing cleared them either — only `proposed_reminder_sent_at` was
// reset, which is a different marker for a different rail.
//
// The failure that would have shipped is the quiet kind. A buyer whose Tuesday handover moves to
// Friday gets no reminder at all for Friday, because the row still says they were reminded — and
// a reminder that is never sent is indistinguishable, from every dashboard, from one that was not
// due. So the last test scans the SOURCE of every writer of `scheduledAt` and fails on one that
// does not clear both markers, rather than trusting the four that do today.
//
// Run with:
//   npx tsx --test --experimental-test-module-mocks \
//     "lib/services/pickup/__tests__/pickup-reminders.test.ts"

import test, { beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

type Row = Record<string, unknown>;

interface Ctrl {
  pickups: Row[];
  outbox: Row[];
  exceptions: Row[];
  updates: Row[];
  revoked: string[];
}
let ctrl: Ctrl;

const NOW = new Date("2026-03-01T12:00:00Z");

const pickupRow = (over: Row = {}): Row => ({
  dealId: "deal_1",
  status: "SCHEDULED",
  scheduledAt: new Date("2026-03-02T09:00:00Z"), // 21 hours out
  location: "North Motors, 12 Mill Road",
  dealerReleasedAt: null,
  noShowAt: null,
  reminder24hSentAt: null,
  reminder2hSentAt: null,
  deal: {
    id: "deal_1",
    buyerId: "buyer_1",
    coBuyerId: null,
    dealerId: "dlr_1",
    buyer: { firstName: "Ada", user: { email: "ada@example.com" } },
    offer: { dealerId: "dlr_1", dealer: { dealershipName: "North Motors" } },
    financing: { downPaymentMethod: "CASHIERS_CHECK" },
    tradeInSubmissions: [],
  },
  ...over,
});

mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      pickup: {
        findMany: async ({ where }: { where: Row }) =>
          ctrl.pickups.filter((p) => {
            if (p.status !== where.status) return false;
            const sched = where.scheduledAt as Row | undefined;
            const at = p.scheduledAt as Date | null;
            if (sched) {
              if (!at) return false;
              if (sched.lte instanceof Date && at > sched.lte) return false;
              if (sched.gt instanceof Date && at <= sched.gt) return false;
              if (sched.lt instanceof Date && at >= sched.lt) return false;
            }
            for (const k of ["reminder24hSentAt", "reminder2hSentAt", "dealerReleasedAt", "noShowAt"]) {
              if (k in where && where[k] === null && p[k] !== null) return false;
            }
            return true;
          }),
        findUnique: async () => ctrl.pickups[0] ?? null,
        updateMany: async ({ where, data }: { where: Row; data: Row }) => {
          const hits = ctrl.pickups.filter((p) =>
            Object.entries(where).every(([k, v]) => (v === null ? p[k] === null : p[k] === v)),
          );
          hits.forEach((p) => Object.assign(p, data));
          ctrl.updates.push(data);
          return { count: hits.length };
        },
      },
    },
  },
});

mock.module("@/lib/services/comms/transactional-dispatcher.service", {
  namedExports: {
    enqueueTransactional: async (i: Row) => { ctrl.outbox.push(i); return { queued: true }; },
  },
});
mock.module("@/lib/services/operations/queue-item.service", {
  namedExports: {
    raiseException: async (i: Row) => { ctrl.exceptions.push(i); return { item: { id: "qi_1" }, created: true }; },
  },
});
mock.module("@/lib/services/pickup/release-token.service", {
  namedExports: {
    revokeReleaseToken: async (dealId: string) => { ctrl.revoked.push(dealId); return true; },
  },
});

const svc = () => import("../pickup-reminders.service");

beforeEach(() => {
  ctrl = { pickups: [pickupRow()], outbox: [], exceptions: [], updates: [], revoked: [] };
});

test("the reminder carries all seven of §Stage 17's items, and the count is asserted", async () => {
  const { renderAppointmentReminder, REMINDER_ITEM_KEYS, STAGE_17_REMINDER_ITEM_COUNT } = await svc();

  assert.equal(REMINDER_ITEM_KEYS.length, STAGE_17_REMINDER_ITEM_COUNT);
  assert.equal(STAGE_17_REMINDER_ITEM_COUNT, 7, "§Stage 17 lists seven things each reminder contains");

  const body = renderAppointmentReminder({
    buyerFirstName: "Ada",
    scheduledAt: new Date("2026-03-02T09:00:00Z"),
    location: "North Motors, 12 Mill Road",
    dealershipName: "North Motors",
    hasCoBuyer: true,
    hasTrade: true,
    downPaymentMethod: "CASHIERS_CHECK",
    dealId: "deal_1",
  });

  // Each of the seven, by the thing it must actually say — not by its key, which would let the
  // list pass while every item rendered empty.
  assert.match(body.html, /12 Mill Road/, "1. time and location");
  assert.match(body.html, /identification for BOTH you and your co-buyer/i, "2. ID for buyer AND co-buyer");
  assert.match(body.html, /policy must be active/i, "3. insurance reminder");
  assert.match(body.html, /cashiers check/i, "4. down-payment method");
  assert.match(body.html, /title, BOTH sets of keys, and the payoff letter/i, "5. trade instructions");
  assert.match(body.html, /release code/i, "6. release-token instructions");
  assert.match(body.html, /Reschedule from your pickup page/i, "7. the rescheduling contact");
});

test("the reminder never contains the code itself", async () => {
  const { renderAppointmentReminder } = await svc();
  const body = renderAppointmentReminder({
    buyerFirstName: "Ada", scheduledAt: NOW, location: null, dealershipName: "North Motors",
    hasCoBuyer: false, hasTrade: false, downPaymentMethod: null, dealId: "deal_1",
  });

  // The raw token is returned once by `issueReleaseToken` and never stored, so this is
  // structurally impossible — but an email is forwarded, quoted and left open on a screen, and a
  // future edit that "helpfully" included it would be a credential in an inbox.
  assert.doesNotMatch(body.html, /[0-9a-f]{32,}/, "no token-shaped value may appear in a reminder");
  assert.match(body.html, /nobody from AutoLenis or the dealership will ask you for it/i,
    "the instruction has to inoculate against the phone call that asks for it");
});

test("a deal with no trade does not get trade instructions, and still reads as a complete list", async () => {
  const { renderAppointmentReminder } = await svc();
  const body = renderAppointmentReminder({
    buyerFirstName: "Ada", scheduledAt: NOW, location: "Bay 3", dealershipName: "North Motors",
    hasCoBuyer: false, hasTrade: false, downPaymentMethod: null, dealId: "deal_1",
  });

  assert.doesNotMatch(body.html, /payoff letter/i, "there is no trade to bring");
  assert.match(body.html, /Your government-issued photo identification/, "and no co-buyer to bring either");
  assert.match(body.html, /Confirm the method with them/i, "an unknown down-payment method says so rather than going silent");
});

test("the 24-hour reminder fires once, stamps its marker, and is not repeated", async () => {
  const s = await svc();

  const first = await s.sweepAppointmentReminders(NOW);
  assert.equal(first.reminded24h, 1);
  assert.equal(ctrl.outbox.length, 1);
  assert.ok(ctrl.pickups[0].reminder24hSentAt instanceof Date, "the marker is the idempotency");

  const second = await s.sweepAppointmentReminders(new Date(NOW.getTime() + 3600_000));
  assert.equal(second.reminded24h, 0, "a stamped marker takes the row out of the scan");
  assert.equal(ctrl.outbox.length, 1);
});

test("the 2-hour reminder is a separate leg with its own marker and template", async () => {
  const s = await svc();
  ctrl.pickups[0].scheduledAt = new Date(NOW.getTime() + 90 * 60_000); // 90 minutes out

  const result = await s.sweepAppointmentReminders(NOW);

  assert.equal(result.reminded24h, 1, "an appointment 90 minutes out is also inside the 24-hour horizon");
  assert.equal(result.reminded2h, 1);
  const keys = ctrl.outbox.map((o) => o.templateKey);
  assert.equal(new Set(keys).size, 2, "§27 partitions rails by template_key — a slow 24h rail must not delay the 2h one");
});

test("the 2-hour reminder is NOT sent for an appointment already in the past", async () => {
  const s = await svc();
  ctrl.pickups[0].scheduledAt = new Date(NOW.getTime() - 60 * 60_000);
  ctrl.pickups[0].reminder24hSentAt = NOW;

  const result = await s.sweepAppointmentReminders(NOW);

  assert.equal(result.reminded2h, 0, "'bring your ID in two hours' about a slot that passed an hour ago");
});

test("a late run still sends — the window is 'less than N away', not 'between N-1 and N'", async () => {
  const s = await svc();
  ctrl.pickups[0].scheduledAt = new Date(NOW.getTime() + 21 * 3600_000); // cron missed the 24h mark

  const result = await s.sweepAppointmentReminders(NOW);

  assert.equal(result.reminded24h, 1, "a reminder at 21 hours is worth far more than none");
});

test("a scheduled handover with no buyer email raises an Operations exception rather than passing quietly", async () => {
  const s = await svc();
  (ctrl.pickups[0].deal as Row).buyer = { firstName: "Ada", user: { email: null } };

  const result = await s.sweepAppointmentReminders(NOW);

  assert.equal(result.reminded24h, 0);
  assert.ok(ctrl.exceptions.some((e) => e.code === "COMMS_NO_DELIVERABLE_CHANNEL"));
});

test("an appointment that passed with no release is FLAGGED, not judged", async () => {
  const s = await svc();
  ctrl.pickups[0].scheduledAt = new Date(NOW.getTime() - 6 * 3600_000);
  ctrl.pickups[0].reminder24hSentAt = NOW;
  ctrl.pickups[0].reminder2hSentAt = NOW;

  const result = await s.sweepAppointmentReminders(NOW);

  assert.equal(result.noShowsFlagged, 1);
  const ex = ctrl.exceptions.find((e) => e.code === "PICKUP_MISSED");
  assert.ok(ex, "§26 PICKUP_MISSED is catalogued raisedByPhase 9 and had no caller until now");
  assert.match(String(ex.detail), /Establish which party did not appear/,
    "fault is not observable from this table, and §Stage 17 only scores the dealership 'where the dealership is at fault'");
  assert.equal(ctrl.pickups[0].status, "SCHEDULED", "the sweep must not return the deal to scheduling on its own");
});

test("an appointment inside the grace window is not flagged — handovers run late", async () => {
  const s = await svc();
  ctrl.pickups[0].scheduledAt = new Date(NOW.getTime() - 60 * 60_000);
  ctrl.pickups[0].reminder24hSentAt = NOW;
  ctrl.pickups[0].reminder2hSentAt = NOW;

  const result = await s.sweepAppointmentReminders(NOW);

  assert.equal(result.noShowsFlagged, 0, "paperwork, a valet, a queue — an hour late is ordinary");
});

test("recording a no-show revokes the code, clears BOTH reminder markers, and returns to scheduling", async () => {
  const s = await svc();
  ctrl.pickups[0].reminder24hSentAt = NOW;
  ctrl.pickups[0].reminder2hSentAt = NOW;

  const out = await s.recordPickupNoShow("deal_1", "BUYER", { id: "admin_1", role: "OPERATIONS_ADMIN" }, NOW);

  assert.deepEqual(out, { ok: true, returnedToScheduling: true });
  assert.deepEqual(ctrl.revoked, ["deal_1"], "§Stage 17: 'revoked token' — never consumed, no handover happened on it");
  assert.equal(ctrl.pickups[0].status, "NOT_SCHEDULED");
  assert.equal(ctrl.pickups[0].noShowParty, "BUYER");
  assert.equal(ctrl.pickups[0].reminder24hSentAt, null, "the new round must re-arm, or the rescheduled time gets no reminders");
  assert.equal(ctrl.pickups[0].reminder2hSentAt, null);
});

test("a pickup the dealership already released cannot be recorded as a no-show", async () => {
  const s = await svc();
  ctrl.pickups[0].dealerReleasedAt = NOW;

  const out = await s.recordPickupNoShow("deal_1", "DEALERSHIP", { id: "admin_1", role: "OPERATIONS_ADMIN" }, NOW);

  assert.deepEqual(out, { ok: false, reason: "already_released" });
  assert.deepEqual(ctrl.revoked, [], "the vehicle moved on that code — retiring it would rewrite what happened");
});

test("EVERY writer of pickups.scheduledAt clears both appointment reminder markers", () => {
  // THE GUARD FOR THE CLAIM THIS FILE'S HEADER DESCRIBES. Four writers clear the markers today.
  // The failure mode is a FIFTH that does not, which produces no error, no log line and no
  // missing row — only a buyer who is never reminded about the time they actually agreed to.
  const ROOT = process.cwd();
  const FILES = [
    "lib/services/pickup/pickup-coordination.service.ts",
    "lib/services/pickup/scheduling.service.ts",
    "lib/services/pickup/pickup.service.ts",
    "lib/services/pickup/pickup-reminders.service.ts",
  ];

  let writersFound = 0;
  const offenders: string[] = [];

  // BRACE-BALANCED, AND `update:` AS WELL AS `data:`. The first draft scanned only `data:`
  // blocks, and the anti-vacuity floor below caught it immediately: it found three writers where
  // four exist. `prisma.pickup.upsert` takes `create:`/`update:` and has no `data:` key at all,
  // so the one writer that reschedules through an upsert — `schedulePickup` — was invisible to
  // the very guard written to cover it.
  //
  // `create:` IS DELIBERATELY NOT SCANNED. A row being created has null markers by definition;
  // there is nothing to clear, and the same upsert's `update:` branch — the one that actually
  // moves an existing appointment — is scanned.
  const blocksOf = (src: string): string[] => {
    const out: string[] = [];
    for (const m of src.matchAll(/\b(data|update)\s*:\s*\{/g)) {
      let depth = 0;
      let i = m.index! + m[0].length - 1;
      const start = i;
      for (; i < src.length; i++) {
        if (src[i] === "{") depth++;
        else if (src[i] === "}") { depth--; if (depth === 0) break; }
      }
      out.push(src.slice(start, i + 1));
    }
    return out;
  };

  for (const file of FILES) {
    const src = readFileSync(join(ROOT, file), "utf8");
    for (const block of blocksOf(src)) {
      // SHORTHAND COUNTS. `data: { status, scheduledAt }` assigns the field just as
      // `scheduledAt: newDate` does, and requiring the colon was the second hole the floor
      // below exposed: three of the four real writers use the shorthand form, so a
      // colon-only pattern saw one of them.
      if (!/\bscheduledAt\s*[,:}\s]/.test(block)) continue;
      // `scheduledAt: null` RETIRES an appointment rather than moving it — the compensating
      // revert in the coordination service, and the no-show path. There is no new time to
      // remind anybody about, so the markers are irrelevant; the next CONFIRMED time goes
      // through one of the writers below and clears them there.
      if (/\bscheduledAt\s*:\s*null/.test(block)) continue;
      writersFound += 1;
      const clears =
        /reminder24hSentAt\s*:\s*null/.test(block) && /reminder2hSentAt\s*:\s*null/.test(block);
      if (!clears) {
        offenders.push(`${file}: a write block sets scheduledAt without clearing both reminder markers`);
      }
    }
  }

  // ANTI-VACUITY. A regex that stops matching finds nothing and passes forever. Four writers
  // exist today; fewer means the scan broke, not that the codebase got safer.
  assert.ok(
    writersFound >= 4,
    `expected at least 4 writers of pickups.scheduledAt, found ${writersFound} — the scan is no longer finding them`
  );
  assert.deepEqual(
    offenders,
    [],
    "An appointment that moves must re-arm §Stage 17's reminders. Leaving a marker set means the " +
      "NEW time gets no reminder at all, and a reminder that is never sent looks exactly like one " +
      "that was not due."
  );
});
