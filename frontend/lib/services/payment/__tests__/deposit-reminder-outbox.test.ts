// PAY-19 / PAY-21 / PAY-23 / §5c — the six-touch $99 series on the transactional
// dispatcher.
//
// The cadence itself is not new; the RAIL is. What this file pins is everything that
// changed with it, because each one was a defect on the rail it replaces:
//
//   • ABSOLUTE offsets from enrolment. The old rail chained each touch off the
//     PREVIOUS one's send, on a fifteen-minute drain, so the day-7 notice inherited
//     five predecessors' drift. Every row here carries its own `run_at`.
//   • KEYED TO THE REQUEST. `deposit-reminder:{buyerId}` could not tell two Vehicle
//     Requests apart, and §23.1 says a new request means a new $99.
//   • A RECHECK THAT READS THE REQUEST. The old guard read the buyer's deposits and
//     account flags and nothing else, so cancelling a request left the series running
//     against it.
//   • BOTH CHANNELS, or a stated reason. One outbox row is one channel, so a touch is
//     two rows; when no CRM contact resolves the SMS half is skipped and the reason is
//     RETURNED, never swallowed.
//
// The legacy rail's drain is still pinned in
// `lib/services/crm/__tests__/deposit-reminder-cadence.test.ts` — production rows are
// still draining through it.
//
// Run: npx tsx --test --experimental-test-module-mocks \
//   "lib/services/payment/__tests__/deposit-reminder-outbox.test.ts"

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

const HOUR = 60 * 60 * 1000;

interface Enqueued {
  triggerEvent: string;
  templateKey: string;
  channel: string;
  recipientId?: string | null;
  to?: string | null;
  vehicleRequestId?: string | null;
  idempotencyKey?: string | null;
  cancelKey?: string | null;
  runAt?: Date | null;
  payload: Record<string, unknown>;
}

interface Ctrl {
  enqueued: Enqueued[];
  contact: { id: string } | null;
  contactThrows: boolean;
}
let ctrl: Ctrl;

mock.module("@/lib/prisma", { namedExports: { prisma: {} } });
mock.module("@/lib/logger", {
  namedExports: { logger: { error: () => {}, warn: () => {}, info: () => {} } },
});

mock.module("@/lib/services/comms/transactional-dispatcher.service", {
  namedExports: {
    enqueueTransactional: async (input: Enqueued) => {
      ctrl.enqueued.push(input);
      return { enqueued: true, id: `row_${ctrl.enqueued.length}`, dedupKey: String(input.idempotencyKey) };
    },
  },
});

// The copy is imported dynamically from the module that owns it, so the two rails
// cannot drift into two texts. Here it is faked to something recognisable per index —
// what matters is WHICH renderer each touch used, not the marketing wording.
mock.module("@/lib/services/crm/lifecycle-touch-drain.service", {
  namedExports: {
    DEPOSIT_REMINDER_RENDERERS: {
      1: () => ({ sms: "sms-1", emailSubject: "subject-1", emailHtml: "<p>html-1</p>" }),
      2: () => ({ sms: "sms-2", emailSubject: "subject-2", emailHtml: "<p>html-2</p>" }),
      3: () => ({ sms: "sms-3", emailSubject: "subject-3", emailHtml: "<p>html-3</p>" }),
      4: () => ({ sms: "sms-4", emailSubject: "subject-4", emailHtml: "<p>html-4</p>" }),
      5: () => ({ sms: "sms-5", emailSubject: "subject-5", emailHtml: "<p>html-5</p>" }),
      6: () => ({ sms: "sms-6", emailSubject: "subject-6", emailHtml: "<p>html-6</p>" }),
    },
  },
});

mock.module("@/lib/crm/resolve-contact", {
  namedExports: {
    resolveDispatchContact: async () => {
      if (ctrl.contactThrows) throw new Error("supabase down");
      return ctrl.contact;
    },
  },
});
mock.module("@/lib/supabase-service", { namedExports: { getServiceSupabase: () => ({}) } });

async function load() {
  return import("@/lib/services/payment/deposit-reminder.service");
}

const INPUT = {
  buyerId: "buyer_1",
  vehicleRequestId: "vr_1",
  firstName: "Sam",
  email: "sam@example.com",
  phone: "+15551230000",
};

beforeEach(() => {
  ctrl = { enqueued: [], contact: { id: "contact_1" }, contactThrows: false };
});

function emails() {
  return ctrl.enqueued.filter((e) => e.channel === "email");
}
function smses() {
  return ctrl.enqueued.filter((e) => e.channel === "sms");
}

// ── the cadence ──────────────────────────────────────────────────────────────

test("six touches, at the owner's offsets, ABSOLUTE from enrolment", async () => {
  const { enrollDepositReminders } = await load();
  const before = Date.now();
  await enrollDepositReminders(INPUT);
  const after = Date.now();

  const sent = emails();
  assert.equal(sent.length, 6);
  const expected = [0, 1 * HOUR, 6 * HOUR, 24 * HOUR, 72 * HOUR, 168 * HOUR];
  sent.forEach((row, i) => {
    const at = row.runAt!.getTime();
    assert.ok(
      at >= before + expected[i]! && at <= after + expected[i]!,
      `touch ${i + 1} should run at +${expected[i]! / HOUR}h from ENROLMENT, not from the previous send`,
    );
  });
});

test("touch 1 is immediate — the cadence leads, it does not wait out a grace period", async () => {
  const { enrollDepositReminders } = await load();
  const before = Date.now();
  await enrollDepositReminders(INPUT);
  assert.ok(emails()[0]!.runAt!.getTime() - before < 1000);
});

test("each touch uses its OWN copy, in order", async () => {
  const { enrollDepositReminders } = await load();
  await enrollDepositReminders(INPUT);

  assert.deepEqual(
    emails().map((e) => e.payload.subject),
    ["subject-1", "subject-2", "subject-3", "subject-4", "subject-5", "subject-6"],
  );
  assert.deepEqual(smses().map((e) => e.payload.body), ["sms-1", "sms-2", "sms-3", "sms-4", "sms-5", "sms-6"]);
});

// ── keyed to the request ─────────────────────────────────────────────────────

test("the cancel key names the REQUEST, so a second request has its own series", async () => {
  const { enrollDepositReminders, depositReminderCancelKey } = await load();
  await enrollDepositReminders(INPUT);

  assert.equal(depositReminderCancelKey("vr_1"), "deposit_reminder:vr_1");
  assert.ok(
    ctrl.enqueued.every((e) => e.cancelKey === "deposit_reminder:vr_1"),
    "one handle stops the whole series — both channels, all six touches",
  );
  assert.ok(ctrl.enqueued.every((e) => e.vehicleRequestId === "vr_1"));
});

test("dedup keys separate the touches AND the channels", async () => {
  const { enrollDepositReminders } = await load();
  await enrollDepositReminders(INPUT);

  const keys = ctrl.enqueued.map((e) => e.idempotencyKey);
  assert.equal(new Set(keys).size, 12, "twelve rows, twelve keys — a collision would silently drop a message");
  assert.ok(keys.includes("deposit_reminder_1:email:vr_1"));
  assert.ok(keys.includes("deposit_reminder_1:sms:vr_1"));
  assert.ok(
    keys.every((k) => String(k).endsWith(":vr_1")),
    "keyed on the REQUEST, not the buyer or the address — §23.1: a new request means a new $99",
  );
});

test("re-enrolment writes the same keys, so a buyer returning to checkout adds nothing", async () => {
  const { enrollDepositReminders } = await load();
  await enrollDepositReminders(INPUT);
  const first = ctrl.enqueued.map((e) => e.idempotencyKey);
  ctrl.enqueued = [];
  await enrollDepositReminders(INPUT);

  assert.deepEqual(ctrl.enqueued.map((e) => e.idempotencyKey), first);
  // The dispatcher's unique index is what actually collapses them; what this proves is
  // that the producer hands it the same keys rather than fresh ones.
});

// ── both channels, or a stated reason ────────────────────────────────────────

test("both channels are enqueued when a CRM contact resolves", async () => {
  const { enrollDepositReminders } = await load();
  const res = await enrollDepositReminders(INPUT);

  assert.equal(res.emailsEnqueued, 6);
  assert.equal(res.smsEnqueued, 6);
  assert.equal(res.smsSkippedReason, undefined);
  assert.ok(smses().every((e) => e.payload.contactId === "contact_1"), "deliverSms's TCPA gate reads that row");
});

test("no contact means email-only, and the reason is RETURNED rather than swallowed", async () => {
  ctrl.contact = null;
  const { enrollDepositReminders } = await load();
  const res = await enrollDepositReminders(INPUT);

  assert.equal(res.emailsEnqueued, 6, "the email series still runs — losing both would be worse");
  assert.equal(res.smsEnqueued, 0);
  assert.match(String(res.smsSkippedReason), /no CRM contact/);
  assert.equal(smses().length, 0, "an SMS row with no contactId is TCPA_GATED at send — never enqueue one");
});

test("a contact lookup FAILURE degrades to email-only and says so", async () => {
  ctrl.contactThrows = true;
  const { enrollDepositReminders } = await load();
  const res = await enrollDepositReminders(INPUT);

  assert.equal(res.emailsEnqueued, 6);
  assert.equal(res.smsEnqueued, 0);
  assert.match(String(res.smsSkippedReason), /contact resolution failed/);
});

test("a missing first name never reaches the buyer as an empty greeting", async () => {
  const { enrollDepositReminders } = await load();
  await enrollDepositReminders({ ...INPUT, firstName: null });
  assert.equal(emails()[0]!.payload.firstName, "there");
});

// ── the payload the dispatcher demands ───────────────────────────────────────

test("email rows carry a RENDERED subject and html, never a template key", async () => {
  const { enrollDepositReminders } = await load();
  await enrollDepositReminders(INPUT);

  for (const row of emails()) {
    assert.ok(row.payload.subject, "assertRenderableEmail refuses at enqueue without one");
    assert.ok(row.payload.html);
    assert.equal(row.payload.templateId, undefined, "a template KEY in templateId is a 22P02 at render time");
  }
});

test("every touch declares its own trigger event, for the §27 completeness assertion", async () => {
  const { enrollDepositReminders } = await load();
  await enrollDepositReminders(INPUT);

  assert.deepEqual(
    emails().map((e) => e.triggerEvent),
    [1, 2, 3, 4, 5, 6].map((i) => `deposit_pending_reminder_${i}`),
  );
});
