// Unit tests for refetchMissingSignedContracts — the durability backstop that
// re-fetches the executed DocuSign PDF for envelopes left COMPLETED with
// documentKey=null (Batch 6).
//
// Run with:
//   npx tsx --test --experimental-test-module-mocks \
//     "lib/services/esign/__tests__/signed-contract-refetch.test.ts"

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

interface Ctrl {
  envelopes: Array<{ id: string; dealId: string; docusignEnvelopeId: string | null }>;
  retrieve: (envId: string, dealId: string) => Promise<string | null>;
  updates: Array<{ where: Record<string, unknown>; data: Record<string, unknown> }>;
  findManyWhere: Record<string, unknown> | null;
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
        updateMany: async (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
          ctrl.updates.push(args);
          return { count: 1 };
        },
      },
    },
  },
});

mock.module("@/lib/services/esign/esign.service", {
  namedExports: {
    retrieveAndStoreSignedContract: async (envId: string, dealId: string) => ctrl.retrieve(envId, dealId),
  },
});

mock.module("@/lib/logger", { namedExports: { logger: { error: () => {}, warn: () => {}, info: () => {} } } });

async function load() { return import("@/lib/services/esign/signed-contract-refetch.service"); }

beforeEach(() => {
  ctrl = {
    envelopes: [],
    retrieve: async (_e, dealId) => `signed/${dealId}/env.pdf`,
    updates: [],
    findManyWhere: null,
  };
});

test("selects only COMPLETED envelopes with a null documentKey and a real envelope id", async () => {
  const { refetchMissingSignedContracts } = await load();
  await refetchMissingSignedContracts();
  assert.equal(ctrl.findManyWhere?.status, "COMPLETED");
  assert.deepEqual(ctrl.findManyWhere?.documentKey, null);
  assert.deepEqual(ctrl.findManyWhere?.docusignEnvelopeId, { not: null });
});

test("empty scan → all zeros, no writes", async () => {
  const { refetchMissingSignedContracts } = await load();
  const r = await refetchMissingSignedContracts();
  assert.deepEqual(r, { scanned: 0, restored: 0, skipped: 0, failed: 0 });
  assert.equal(ctrl.updates.length, 0);
});

test("restores documentKey (guarded on still-null) when the PDF is fetched", async () => {
  ctrl.envelopes = [{ id: "e1", dealId: "d1", docusignEnvelopeId: "ds1" }];
  const { refetchMissingSignedContracts } = await load();
  const r = await refetchMissingSignedContracts();
  assert.equal(r.scanned, 1);
  assert.equal(r.restored, 1);
  assert.equal(ctrl.updates.length, 1);
  assert.equal(ctrl.updates[0]!.where.id, "e1");
  assert.deepEqual(ctrl.updates[0]!.where.documentKey, null, "guarded write only while still null");
  assert.equal(ctrl.updates[0]!.data.documentKey, "signed/d1/env.pdf");
});

test("DORMANT: a null retrieval (mock/unconfigured DocuSign) is skipped, no write", async () => {
  ctrl.envelopes = [{ id: "e1", dealId: "d1", docusignEnvelopeId: "ds1" }];
  ctrl.retrieve = async () => null;
  const { refetchMissingSignedContracts } = await load();
  const r = await refetchMissingSignedContracts();
  assert.equal(r.skipped, 1);
  assert.equal(r.restored, 0);
  assert.equal(ctrl.updates.length, 0);
});

test("a retrieval throw is isolated (counted failed) and does not stop other envelopes", async () => {
  ctrl.envelopes = [
    { id: "bad", dealId: "d1", docusignEnvelopeId: "ds1" },
    { id: "good", dealId: "d2", docusignEnvelopeId: "ds2" },
  ];
  ctrl.retrieve = async (_e, dealId) => {
    if (dealId === "d1") throw new Error("docusign 503");
    return `signed/${dealId}/env.pdf`;
  };
  const { refetchMissingSignedContracts } = await load();
  const r = await refetchMissingSignedContracts();
  assert.equal(r.scanned, 2);
  assert.equal(r.failed, 1);
  assert.equal(r.restored, 1, "the healthy envelope is still restored");
  assert.equal(ctrl.updates.length, 1);
  assert.equal(ctrl.updates[0]!.where.id, "good");
});
