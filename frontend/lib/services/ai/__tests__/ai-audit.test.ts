// The unified AI audit trail.
//
// Before this, exactly one of six Zura surfaces audited at all. The design
// question was which table, and the answer turns on a schema fact:
// `AdminAuditLog.adminId` and `.adminEmail` are both NON-NULLABLE, so five of
// the six surfaces could only be written there by inventing an admin identity
// for a buyer's chat turn. A falsified actor in an audit record is worse than no
// record — so the AI trail targets `audit_logs`, which models both principals.
//
//   pnpm test:zura

import test, { beforeEach, mock } from "node:test";
import assert from "node:assert/strict";

const rows: Array<Record<string, unknown>> = [];
let createThrows = false;

mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      auditLog: {
        create: async ({ data }: { data: Record<string, unknown> }) => {
          if (createThrows) throw new Error("db down");
          rows.push(data);
          return data;
        },
      },
    },
  },
});

const loggedErrors: unknown[][] = [];
mock.module("@/lib/logger", {
  namedExports: {
    logger: {
      error: (...args: unknown[]) => loggedErrors.push(args),
      warn: () => {},
      info: () => {},
      debug: () => {},
    },
  },
});

type AuditService = typeof import("../ai-audit.service");
let svc: AuditService;

beforeEach(async () => {
  rows.length = 0;
  loggedErrors.length = 0;
  createThrows = false;
  svc = await import("../ai-audit.service");
});

const BUYER = { actorType: "BUYER" as const, actorId: "buyer-1", authenticatedRole: "BUYER" as const };
const ADMIN = { actorType: "ADMIN" as const, actorId: "admin-1", authenticatedRole: "SUPER_ADMIN" as const };
const ANON = { actorType: "SYSTEM" as const, actorId: "session:abc", authenticatedRole: null };

test("one AI turn writes exactly one audit_logs row", async () => {
  await svc.recordAiEvent({
    actor: BUYER,
    surface: "buyer",
    purpose: "zura.buyer.chat",
    outcome: "ANSWERED",
    messageLength: 12,
    model: "openai/gpt-oss-120b",
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].entityType, svc.AI_TURN_ENTITY_TYPE);
});

test("a NON-admin actor is written to userId, with adminId null", async () => {
  await svc.recordAiEvent({
    actor: BUYER,
    surface: "buyer",
    purpose: "zura.buyer.chat",
    outcome: "ANSWERED",
    messageLength: 1,
  });
  assert.equal(rows[0].adminId, null);
  assert.equal(rows[0].userId, "buyer-1");
});

test("an ADMIN actor is written to adminId, with userId null", async () => {
  await svc.recordAiEvent({
    actor: ADMIN,
    surface: "admin",
    purpose: "zura.admin.chat",
    outcome: "ANSWERED",
    messageLength: 1,
  });
  assert.equal(rows[0].adminId, "admin-1");
  assert.equal(rows[0].userId, null);
});

test("an ANONYMOUS actor never falsifies a principal", async () => {
  await svc.recordAiEvent({
    actor: ANON,
    surface: "public-web",
    purpose: "zura.public.concierge",
    outcome: "ANSWERED",
    messageLength: 1,
  });
  assert.equal(rows[0].adminId, null);
  assert.equal((rows[0].metadata as Record<string, unknown>).authenticatedRole, null);
});

test("every surface can be recorded — the trail has no hole", async () => {
  const surfaces = ["public-web", "voice", "buyer", "dealer", "affiliate", "admin"] as const;
  for (const surface of surfaces) {
    await svc.recordAiEvent({
      actor: BUYER,
      surface,
      purpose: `zura.${surface}.chat`,
      outcome: "ANSWERED",
      messageLength: 1,
    });
  }
  assert.equal(rows.length, surfaces.length);
  assert.deepEqual(
    rows.map((r) => (r.metadata as Record<string, unknown>).surface),
    [...surfaces],
  );
});

test("the row records message LENGTH and never message content", async () => {
  const secret = "my SSN is 123-45-6789 and my phone is 972-555-0143";
  await svc.recordAiEvent({
    actor: BUYER,
    surface: "buyer",
    purpose: "zura.buyer.chat",
    outcome: "ANSWERED",
    messageLength: secret.length,
  });
  const serialised = JSON.stringify(rows[0]);
  assert.ok(serialised.includes(String(secret.length)));
  assert.ok(!serialised.includes("123-45-6789"), "the audit trail must not become a second copy of PII");
  assert.ok(!serialised.includes("972-555-0143"));
});

test("the row carries the AI_TURN marker so it is filterable alongside the intent trail", async () => {
  await svc.recordAiEvent({
    actor: BUYER,
    surface: "buyer",
    purpose: "zura.buyer.chat",
    outcome: "ANSWERED",
    messageLength: 1,
  });
  assert.equal((rows[0].metadata as Record<string, unknown>).actorAction, svc.AI_TURN_ACTOR_ACTION);
});

test("a proposal outcome records the intent type, risk class and rejection code", async () => {
  await svc.recordAiEvent({
    actor: BUYER,
    surface: "buyer",
    purpose: "zura.buyer.chat",
    outcome: "REFUSED",
    messageLength: 5,
    proposalIntentType: "admin.trigger_deposit_refund",
    proposalRiskClass: "IRREVERSIBLE",
    rejectionCode: "UNAUTHORIZED_ACTOR",
  });
  const meta = rows[0].metadata as Record<string, unknown>;
  assert.equal(meta.proposalIntentType, "admin.trigger_deposit_refund");
  assert.equal(meta.proposalRiskClass, "IRREVERSIBLE");
  assert.equal(meta.rejectionCode, "UNAUTHORIZED_ACTOR");
  assert.equal(meta.outcome, "REFUSED");
});

test("an audit write failure is FAIL-LOUD: logged at error, but never thrown", async () => {
  createThrows = true;
  await assert.doesNotReject(() =>
    svc.recordAiEvent({
      actor: BUYER,
      surface: "buyer",
      purpose: "zura.buyer.chat",
      outcome: "ANSWERED",
      messageLength: 1,
    }),
  );
  assert.equal(loggedErrors.length, 1, "an unaudited turn is an accountability gap and must be logged");
  assert.match(String(loggedErrors[0][0]), /audit write FAILED/i);
});

test("the entityId groups a conversation's rows together", async () => {
  await svc.recordAiEvent({
    actor: BUYER,
    surface: "buyer",
    purpose: "zura.buyer.chat",
    outcome: "ANSWERED",
    messageLength: 1,
    chatSessionId: "chat-42",
  });
  assert.equal(rows[0].entityId, "chat-42");
});
