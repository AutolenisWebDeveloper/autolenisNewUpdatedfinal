// Proposal idempotency keys.
//
// `proposeIntent` collapses a duplicate key by returning the EXISTING record's
// outcome. That is the behaviour we want for a RETRY and a disaster for a
// DIFFERENT request, so what goes into the key decides whether the user is told
// the truth about what they just asked for.
//
// Regression guard for a defect the adversarial review found: the key omitted
// the PARAMETERS, so "select offer B" in the same conversation was answered with
// "offer A is awaiting approval".
//
//   pnpm test:zura

import test, { beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import { INTENT_ENVELOPE_OPEN, INTENT_ENVELOPE_CLOSE } from "../action-intent/extract";
import { InMemoryActionIntentStore, noopAuditRecorder } from "../action-intent/store";
import { permissivePolicyDeps } from "../action-intent/__tests__/_harness";

const prismaMock = {
  buyer: {
    findUnique: async ({ where }: { where: { id: string } }) => ({
      id: where.id,
      userId: "u",
      firstName: "Ada",
      onboardingComplete: true,
      preQualification: null,
      auctions: [],
      deals: [],
    }),
  },
  auditLog: { create: async () => ({}) },
};
mock.module("@/lib/prisma", { namedExports: { prisma: prismaMock } });
mock.module("@/lib/security/rate-limit", {
  namedExports: { limitGeneral: async () => ({ ok: true }), clientIpKey: () => "203.0.113.9" },
});

let nextReply = "";
mock.module("@/lib/ai/provider", {
  namedExports: {
    complete: async () => ({
      content: nextReply,
      model: "openai/gpt-oss-120b",
      provider: "groq",
      tokensUsed: 1,
      raw: {},
    }),
  },
});

type ChatService = typeof import("../zura-chat.service");
let svc: ChatService;

/** One shared store across a conversation, so a collapse is observable. */
let store: InMemoryActionIntentStore;

const CONVERSATION = "6b1e9f80-4b2a-4a1e-9f3c-2d7c5a1b8e40";
const buyerActor = { actorType: "BUYER" as const, actorId: "buyer-1", authenticatedRole: "BUYER" as const };

beforeEach(async () => {
  store = new InMemoryActionIntentStore();
  svc = await import("../zura-chat.service");
});

function envelope(intentType: string, parameters: Record<string, unknown>): string {
  return `${INTENT_ENVELOPE_OPEN}\n${JSON.stringify({ intentType, parameters })}\n${INTENT_ENVELOPE_CLOSE}`;
}

async function propose(intentType: string, parameters: Record<string, unknown>) {
  nextReply = `Sure.\n${envelope(intentType, parameters)}`;
  return svc.runZuraTurn(
    {
      surface: "buyer",
      actor: buyerActor,
      message: "do it",
      chatSessionId: CONVERSATION,
    },
    {
      engineDeps: {
        store,
        audit: noopAuditRecorder,
        policyDeps: permissivePolicyDeps(),
        activation: async () => true,
      },
    },
  );
}

test("two DIFFERENT proposals in one conversation get their OWN records", async () => {
  const first = await propose("buyer.select_offer", { auctionId: "auction-1", offerId: "offer-A" });
  const second = await propose("buyer.select_offer", { auctionId: "auction-1", offerId: "offer-B" });

  assert.ok(first.ok && first.proposal, "the first proposal should be recorded");
  assert.ok(second.ok && second.proposal, "the second proposal should be recorded");
  const firstId = first.ok && first.proposal && "intentId" in first.proposal.outcome
    ? first.proposal.outcome.intentId
    : undefined;
  const secondId = second.ok && second.proposal && "intentId" in second.proposal.outcome
    ? second.proposal.outcome.intentId
    : undefined;
  assert.ok(firstId && secondId);
  assert.notEqual(
    secondId,
    firstId,
    "asking for offer B must not be answered with offer A's record",
  );

  const stored = await store.listByStatus("APPROVAL_REQUIRED");
  assert.equal(stored.length, 2);
  assert.deepEqual(
    stored.map((r) => (r.parameters as { offerId: string }).offerId).sort(),
    ["offer-A", "offer-B"],
  );
});

test("an identical RETRY still collapses to one record — idempotency is preserved", async () => {
  const params = { auctionId: "auction-1", offerId: "offer-A" };
  const first = await propose("buyer.select_offer", params);
  const retry = await propose("buyer.select_offer", params);

  const firstId = first.ok && first.proposal && "intentId" in first.proposal.outcome
    ? first.proposal.outcome.intentId
    : undefined;
  const retryId = retry.ok && retry.proposal && "intentId" in retry.proposal.outcome
    ? retry.proposal.outcome.intentId
    : undefined;
  assert.equal(retryId, firstId, "a replayed request must not create a second record");
  assert.equal((await store.listByStatus("APPROVAL_REQUIRED")).length, 1);
});

test("parameter key ORDER does not change the key — a reorder is still a retry", async () => {
  const first = await propose("buyer.select_offer", { auctionId: "auction-1", offerId: "offer-A" });
  const reordered = await propose("buyer.select_offer", { offerId: "offer-A", auctionId: "auction-1" });

  const firstId = first.ok && first.proposal && "intentId" in first.proposal.outcome
    ? first.proposal.outcome.intentId
    : undefined;
  const reorderedId = reordered.ok && reordered.proposal && "intentId" in reordered.proposal.outcome
    ? reordered.proposal.outcome.intentId
    : undefined;
  assert.equal(reorderedId, firstId);
  assert.equal((await store.listByStatus("APPROVAL_REQUIRED")).length, 1);
});
