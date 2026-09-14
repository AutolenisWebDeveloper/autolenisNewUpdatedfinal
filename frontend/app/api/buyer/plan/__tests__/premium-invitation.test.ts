// §23.2a touchpoints 3 and 4 — THE POST-ACCEPTANCE INVITATION, ITS "ONCE", AND ITS FOLLOW-UP.
//
// §27.1 K27-1329 and K27-1330. Before this phase neither existed: `POST /api/buyer/plan/upgrade`
// was a bare flip with no invitation surface, no impression record, and therefore nothing that
// could enforce §23.2a's "once", nothing that could satisfy §23.2b's decline ceiling (which
// `isUpgradePromptSuppressed` REQUIRES as an input and throws without), and no one-hour follow-up.
//
//   npx tsx --test --experimental-test-module-mocks \
//     app/api/buyer/plan/__tests__/premium-invitation.test.ts

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/dist/server/web/spec-extension/request";

type Rec = Record<string, unknown>;

let deal: Rec | null;
let activityEvents: Rec[];
let suppression: Rec;
let enqueued: Rec[];
let buyerRow: Rec | null;

mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      deal: { findFirst: async () => deal },
      buyer: { findUnique: async () => buyerRow },
      buyerActivityEvent: {
        create: async (a: Rec) => { activityEvents.push((a as { data: Rec }).data); return {}; },
        findMany: async ({ where }: { where: Rec }) =>
          activityEvents.filter((e) => e.eventType === where.eventType).map((e) => ({ metadata: e.metadata, createdAt: new Date() })),
      },
    },
  },
});

mock.module("@/lib/auth/api", {
  namedExports: {
    getRequestBuyer: async () => ({ id: "b1" }),
    successResponse: (data: unknown) => Response.json({ success: true, data }),
    errorResponse: (code: string, message: string, status: number) =>
      Response.json({ success: false, error: { code, message } }, { status }),
  },
});

mock.module("@/lib/services/plan/upgrade-suppression.service", {
  namedExports: {
    isUpgradePromptSuppressed: async () => suppression,
    UPGRADE_TOUCHPOINTS: {
      RECEIPT: "receipt",
      BEST_PRICE_REPORT: "best_price_report",
      POST_ACCEPTANCE: "post_acceptance",
      POST_ACCEPTANCE_EMAIL: "post_acceptance_email",
      REAFFIRMATION_EMAIL: "reaffirmation_email",
    },
    EMAIL_TOUCHPOINTS: ["post_acceptance_email", "reaffirmation_email"],
  },
});

mock.module("@/lib/services/plan/upgrade-window.service", {
  namedExports: {
    quotePremiumBalance: async () => ({ grossCents: 49_900, creditCents: 9_900, dueCents: 40_000, creditBasis: "deposit", explanation: "" }),
  },
});

mock.module("@/lib/services/comms/transactional-dispatcher.service", {
  namedExports: {
    enqueueTransactional: async (input: Rec) => { enqueued.push(input); return { enqueued: true, id: "co_1", dedupKey: "" }; },
  },
});

beforeEach(() => {
  deal = { id: "deal_1", vehicleRequestId: "vr_1" };
  activityEvents = [];
  suppression = { suppressed: false };
  enqueued = [];
  buyerRow = { firstName: "Ada", user: { email: "ada@test.local" } };
});

async function show(query = "?dealId=deal_1") {
  const { GET } = await import("../invitation/route");
  const res = await GET(new NextRequest(`http://localhost/api/buyer/plan/invitation${query}`));
  return { status: res.status, json: (await res.json()) as Rec };
}

async function dismiss(body: Rec = { dealId: "deal_1", action: "dismiss" }) {
  const { POST } = await import("../invitation/route");
  const req = new NextRequest("http://localhost/api/buyer/plan/invitation", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
  const res = await POST(req);
  return { status: res.status, json: (await res.json()) as Rec };
}

// ── touchpoint 3: shown ONCE ────────────────────────────────────────────────────────────────────

test("the invitation is shown, with the balance, and the impression is recorded", async () => {
  const { json } = await show();
  const data = json.data as Rec;
  assert.equal(data.show, true);
  assert.equal((data.balance as Rec).dueCents, 40_000, "the buyer is shown what they would actually pay");
  assert.equal(activityEvents.length, 1);
  assert.equal(activityEvents[0].eventType, "PREMIUM_PROMPT_SHOWN");
  assert.equal((activityEvents[0].metadata as Rec).touchpoint, "post_acceptance");
});

test("ONCE — a second request does not show it again", async () => {
  // §23.2a: "the full-screen invitation, ONCE, immediately after offer acceptance". The impression
  // row IS the enforcement, which is why it is written by the server as part of deciding to show
  // rather than reported by the client afterwards: a client that renders and then fails to report
  // would show the once-invitation twice.
  assert.equal(((await show()).json.data as Rec).show, true);
  const second = (await show()).json.data as Rec;
  assert.equal(second.show, false);
  assert.equal(second.reason, "already_shown");
  assert.equal(activityEvents.filter((e) => e.eventType === "PREMIUM_PROMPT_SHOWN").length, 1);
});

test("a suppressed buyer sees nothing, and is told nothing about why", async () => {
  // "An exception is open on your transaction" or "a dispute is on your deposit" is information
  // the buyer should get from the surface that owns it, with its own copy — not leaked through the
  // answer to "may I show an upsell".
  suppression = { suppressed: true, reason: "exception_in_progress", detail: "an open exception (ALL_OFFERS_EXCEED_BUDGET)" };
  const data = (await show()).json.data as Rec;
  assert.equal(data.show, false);
  assert.equal(data.reason, "suppressed");
  assert.equal(JSON.stringify(data).includes("ALL_OFFERS_EXCEED_BUDGET"), false, "the suppression reason leaked to the client");
  assert.equal(activityEvents.length, 0, "a suppressed prompt must not count as an impression");
});

test("another buyer's deal is not found — ownership is checked on the DEAL", async () => {
  // Taking the request id from the body would disclose whether someone else's transaction is in an
  // exception state, through the shape of the answer.
  deal = null;
  assert.equal((await show("?dealId=someone_elses")).status, 404);
});

test("a missing dealId is a 400, not a silent no-show", async () => {
  assert.equal((await show("")).status, 400);
});

// ── touchpoint 4: scheduled on dismissal, decided at send time ──────────────────────────────────

test("dismissing records the decline AND schedules the one-hour follow-up", async () => {
  await show();
  const { json } = await dismiss();
  assert.equal((json.data as Rec).recorded, true);
  assert.equal(activityEvents.filter((e) => e.eventType === "PREMIUM_PROMPT_DISMISSED").length, 1);

  assert.equal(enqueued.length, 1);
  assert.equal(enqueued[0].templateKey, "premium_follow_up");
  assert.equal(enqueued[0].vehicleRequestId, "vr_1");
  assert.equal(
    enqueued[0].idempotencyKey,
    "premium_follow_up:email:vr_1",
    "§23.4 gives a second request its own election — a buyer-derived key would dedupe across transactions",
  );
  const runAt = enqueued[0].runAt as Date;
  const delayMinutes = Math.round((runAt.getTime() - Date.now()) / 60_000);
  assert.ok(delayMinutes >= 59 && delayMinutes <= 61, `§23.2a says one hour; got ${delayMinutes} minutes`);
});

test("NOT dismissing schedules nothing — §23.2a sends it only if the invitation was declined", async () => {
  await show();
  assert.equal(enqueued.length, 0);
});

test("only a dismissal is accepted here — a conversion is not a client's word", async () => {
  // Recording a conversion from a button press would count intentions as conversions. The upgrade
  // route is the only place that knows the upgrade actually happened.
  const { status, json } = await dismiss({ dealId: "deal_1", action: "accept" });
  assert.equal(status, 400);
  assert.match(String((json.error as Rec).message), /dismiss/);
  assert.equal(enqueued.length, 0);
});

test("a follow-up that cannot be scheduled does not fail the dismissal", async () => {
  // §23.2b treats a missing ask as the safe outcome; the buyer's deal is unaffected either way.
  buyerRow = { firstName: "Ada", user: null };
  const { status, json } = await dismiss();
  assert.equal(status, 200);
  assert.equal((json.data as Rec).recorded, true);
  assert.equal(enqueued.length, 0);
});
