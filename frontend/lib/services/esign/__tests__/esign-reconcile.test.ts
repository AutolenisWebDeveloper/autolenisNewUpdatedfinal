// Unit tests for reconcileEsignEnvelopes — Program 4 durability backstop that
// recovers a dropped DocuSign completion/decline/void webhook. Proves it: no-ops
// when DocuSign is unconfigured; selects only stuck SIGNING_PENDING envelopes;
// drives the authoritative provider status into the right idempotent handler;
// is guarded by the shared provider-event claim (cross-path idempotency); and
// isolates per-envelope failures.
//
// Run: npx tsx --test --experimental-test-module-mocks \
//   lib/services/esign/__tests__/esign-reconcile.test.ts

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

interface Ctrl {
  configured: boolean;
  envelopes: Array<{ id: string; dealId: string; docusignEnvelopeId: string | null }>;
  findManyWhere: Record<string, unknown> | null;
  statusById: Record<string, string | null>;
  claims: string[]; // claimProviderEvent eventIds seen
  claimResult: "claimed" | "duplicate" | "in_progress";
  completed: string[];
  declined: string[];
  voided: string[];
  settled: number;
  statusThrowsFor: string | null;
}
let ctrl: Ctrl;

mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      eSignEnvelope: {
        findMany: async ({ where }: { where: Record<string, unknown> }) => {
          ctrl.findManyWhere = where;
          return ctrl.envelopes;
        },
      },
    },
  },
});

mock.module("@/lib/services/esign/docusign-auth.service", {
  namedExports: { isDocuSignConfigured: () => ctrl.configured },
});

mock.module("@/lib/services/esign/esign.service", {
  namedExports: {
    getEnvelopeStatus: async (envId: string) => {
      if (ctrl.statusThrowsFor === envId) throw new Error("docusign 503");
      return ctrl.statusById[envId] ?? null;
    },
    handleEnvelopeCompleted: async (envId: string) => { ctrl.completed.push(envId); },
    handleEnvelopeDeclined: async (envId: string) => { ctrl.declined.push(envId); },
    handleEnvelopeVoidedByProvider: async (envId: string) => { ctrl.voided.push(envId); },
  },
});

mock.module("@/lib/services/webhooks/provider-event-dedup", {
  namedExports: {
    claimProviderEvent: async ({ eventId }: { eventId: string }) => {
      ctrl.claims.push(eventId);
      if (ctrl.claimResult === "claimed") return { status: "claimed", settle: async () => { ctrl.settled++; } };
      return { status: ctrl.claimResult };
    },
  },
});

mock.module("@/lib/logger", { namedExports: { logger: { error: () => {}, warn: () => {}, info: () => {} } } });

async function load() { return import("@/lib/services/esign/esign-reconcile.service"); }

beforeEach(() => {
  ctrl = {
    configured: true,
    envelopes: [],
    findManyWhere: null,
    statusById: {},
    claims: [],
    claimResult: "claimed",
    completed: [],
    declined: [],
    voided: [],
    settled: 0,
    statusThrowsFor: null,
  };
});

test("DORMANT: unconfigured DocuSign short-circuits (no scan, no side effects)", async () => {
  ctrl.configured = false;
  const { reconcileEsignEnvelopes } = await load();
  const r = await reconcileEsignEnvelopes();
  assert.equal(r.skippedUnconfigured, true);
  assert.equal(r.scanned, 0);
  assert.equal(ctrl.findManyWhere, null, "must not even query when unconfigured");
});

test("selects only stuck SENT/DELIVERED envelopes whose deal is still SIGNING_PENDING", async () => {
  const { reconcileEsignEnvelopes } = await load();
  await reconcileEsignEnvelopes();
  assert.deepEqual(ctrl.findManyWhere?.status, { in: ["SENT", "DELIVERED"] });
  assert.deepEqual(ctrl.findManyWhere?.docusignEnvelopeId, { not: null });
  assert.deepEqual(ctrl.findManyWhere?.deal, { status: "SIGNING_PENDING" });
  assert.ok(ctrl.findManyWhere?.sentAt, "must bound to stale envelopes only");
});

test("a provider-completed envelope is driven to completion exactly once, under the shared claim key", async () => {
  ctrl.envelopes = [{ id: "e1", dealId: "d1", docusignEnvelopeId: "ds1" }];
  ctrl.statusById = { ds1: "completed" };
  const { reconcileEsignEnvelopes } = await load();
  const r = await reconcileEsignEnvelopes();
  assert.equal(r.completed, 1);
  assert.deepEqual(ctrl.completed, ["ds1"]);
  assert.deepEqual(ctrl.claims, ["ds1:envelope-completed"], "claims on the SAME key the webhook uses");
  assert.equal(ctrl.settled, 1, "the claim is settled after the handler runs");
});

test("cross-path idempotency: a duplicate claim (webhook already ran) does not re-run the handler", async () => {
  ctrl.envelopes = [{ id: "e1", dealId: "d1", docusignEnvelopeId: "ds1" }];
  ctrl.statusById = { ds1: "completed" };
  ctrl.claimResult = "duplicate";
  const { reconcileEsignEnvelopes } = await load();
  const r = await reconcileEsignEnvelopes();
  assert.equal(r.completed, 0, "duplicate claim → not counted");
  assert.deepEqual(ctrl.completed, [], "handler must NOT run when the event was already processed");
  assert.equal(ctrl.settled, 0);
});

test("declined and voided provider states route to their truthful handlers", async () => {
  ctrl.envelopes = [
    { id: "e1", dealId: "d1", docusignEnvelopeId: "ds1" },
    { id: "e2", dealId: "d2", docusignEnvelopeId: "ds2" },
  ];
  ctrl.statusById = { ds1: "declined", ds2: "voided" };
  const { reconcileEsignEnvelopes } = await load();
  const r = await reconcileEsignEnvelopes();
  assert.equal(r.declined, 1);
  assert.equal(r.voided, 1);
  assert.deepEqual(ctrl.declined, ["ds1"]);
  assert.deepEqual(ctrl.voided, ["ds2"]);
});

test("a still-in-flight envelope (sent/delivered at DocuSign) is left untouched", async () => {
  ctrl.envelopes = [{ id: "e1", dealId: "d1", docusignEnvelopeId: "ds1" }];
  ctrl.statusById = { ds1: "sent" };
  const { reconcileEsignEnvelopes } = await load();
  const r = await reconcileEsignEnvelopes();
  assert.equal(r.stillPending, 1);
  assert.equal(ctrl.completed.length + ctrl.declined.length + ctrl.voided.length, 0);
  assert.equal(ctrl.claims.length, 0, "no claim attempted for an in-flight envelope");
});

test("a status-poll failure is isolated (counted) and does not stop other envelopes", async () => {
  ctrl.envelopes = [
    { id: "bad", dealId: "d1", docusignEnvelopeId: "ds1" },
    { id: "good", dealId: "d2", docusignEnvelopeId: "ds2" },
  ];
  ctrl.statusThrowsFor = "ds1";
  ctrl.statusById = { ds2: "completed" };
  const { reconcileEsignEnvelopes } = await load();
  const r = await reconcileEsignEnvelopes();
  assert.equal(r.failed, 1);
  assert.equal(r.completed, 1, "the healthy envelope still reconciles");
  assert.deepEqual(ctrl.completed, ["ds2"]);
});
