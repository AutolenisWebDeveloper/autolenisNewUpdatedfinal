// Route tests for POST /api/webhooks/docusign — Program 4 extends the handler
// beyond `envelope-completed` to also resolve `envelope-declined` and
// `envelope-voided` (previously silently acked → the deal was stranded at
// SIGNING_PENDING with no truthful state). Proves: signature is verified;
// declined/voided route to their handlers WITHOUT touching completion; and the
// existing per-(envelope,event) dedup keeps every event idempotent under replay.
//
// Run: npx tsx --test --experimental-test-module-mocks \
//   "app/api/webhooks/__tests__/docusign-events.test.ts"

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import crypto from "crypto";
import { NextRequest } from "next/server";

type EventRow = { eventId: string; eventType: string; processed: boolean };
interface Ctrl {
  events: EventRow[];
  completed: string[];
  declined: string[];
  voided: string[];
  dealerHandled: boolean;
}
let ctrl: Ctrl;

mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      paymentProviderEvent: {
        findUnique: async ({ where }: { where: { eventId: string } }) =>
          ctrl.events.find((e) => e.eventId === where.eventId) ?? null,
        create: async ({ data }: { data: EventRow }) => {
          if (ctrl.events.some((e) => e.eventId === data.eventId)) {
            throw Object.assign(new Error("unique"), { code: "P2002" });
          }
          ctrl.events.push({ eventId: data.eventId, eventType: data.eventType, processed: false });
          return data;
        },
        update: async ({ where, data }: { where: { eventId: string }; data: { processed: boolean } }) => {
          const row = ctrl.events.find((e) => e.eventId === where.eventId);
          if (row) row.processed = data.processed;
          return row;
        },
      },
    },
  },
});

mock.module("@/lib/services/esign/esign.service", {
  namedExports: {
    handleEnvelopeCompleted: async (id: string) => { ctrl.completed.push(id); },
    handleEnvelopeDeclined: async (id: string) => { ctrl.declined.push(id); },
    handleEnvelopeVoidedByProvider: async (id: string) => { ctrl.voided.push(id); },
  },
});
mock.module("@/lib/services/esign/dealer-marketplace-agreement.service", {
  namedExports: { handleDealerMarketplaceEnvelopeCompleted: async () => ctrl.dealerHandled },
});
mock.module("@/lib/logger", { namedExports: { logger: { error: () => {}, warn: () => {}, info: () => {} } } });

const SECRET = "test-docusign-secret";

function signedReq(event: string, envelopeId: string) {
  const rawBody = JSON.stringify({ event, data: { envelopeId } });
  const sig = crypto.createHmac("sha256", SECRET).update(rawBody, "utf8").digest("base64");
  return new NextRequest("http://localhost/api/webhooks/docusign", {
    method: "POST",
    body: rawBody,
    headers: { "x-docusign-signature-1": sig, "content-type": "application/json" },
  });
}

async function post(req: NextRequest) {
  const { POST } = await import("@/app/api/webhooks/docusign/route");
  return POST(req);
}

beforeEach(() => {
  process.env.DOCUSIGN_WEBHOOK_SECRET = SECRET;
  ctrl = { events: [], completed: [], declined: [], voided: [], dealerHandled: false };
});

test("rejects an invalid signature (fail-closed, 401)", async () => {
  const req = new NextRequest("http://localhost/api/webhooks/docusign", {
    method: "POST",
    body: JSON.stringify({ event: "envelope-declined", data: { envelopeId: "ds1" } }),
    headers: { "x-docusign-signature-1": "not-valid", "content-type": "application/json" },
  });
  const res = await post(req);
  assert.equal(res.status, 401);
  assert.equal(ctrl.declined.length, 0);
});

test("envelope-declined routes to handleEnvelopeDeclined and NOT to completion", async () => {
  const res = await post(signedReq("envelope-declined", "ds1"));
  assert.equal(res.status, 200);
  assert.deepEqual(ctrl.declined, ["ds1"]);
  assert.deepEqual(ctrl.completed, [], "a decline must never drive completion");
});

test("envelope-voided routes to the provider-void handler", async () => {
  const res = await post(signedReq("envelope-voided", "ds2"));
  assert.equal(res.status, 200);
  assert.deepEqual(ctrl.voided, ["ds2"]);
  assert.deepEqual(ctrl.completed, []);
});

test("envelope-completed still routes to completion (deal envelope)", async () => {
  const res = await post(signedReq("envelope-completed", "ds3"));
  assert.equal(res.status, 200);
  assert.deepEqual(ctrl.completed, ["ds3"]);
});

test("a replayed declined event is idempotent (handler runs once)", async () => {
  await post(signedReq("envelope-declined", "ds1"));
  const res2 = await post(signedReq("envelope-declined", "ds1"));
  assert.equal(res2.status, 200);
  assert.deepEqual(ctrl.declined, ["ds1"], "the second delivery is deduped, not re-run");
});

test("an unhandled event type is acked without side effects", async () => {
  const res = await post(signedReq("envelope-sent", "ds9"));
  assert.equal(res.status, 200);
  assert.equal(ctrl.completed.length + ctrl.declined.length + ctrl.voided.length, 0);
});
