// The transport policy the four portal surfaces inherited — and briefly lost.
//
// BEFORE this phase, every one of the six Zura surfaces reached the model
// through `groqChat`, which built `new Groq({ apiKey })`. The groq-sdk applies
// `maxRetries = 2` and `timeout = 60000` to every request it makes, so all six
// surfaces had a bounded request and two automatic retries without ever asking
// for them.
//
//   /api/{buyer,dealer,affiliate,admin}/ai/chat -> *ConciergeChat (agents.ts) -> groqChat -> SDK
//   /api/public/ai/chat                         -> groqChat -> SDK
//   lib/voice/handle-turn.ts                    -> groqChat -> SDK
//
// AFTER, the first five go through `runZuraTurn` -> `complete()` instead. The
// SDK is no longer in that path, and `lib/ai/provider.ts` deliberately injects
// NO defaults — because the social, acquisition and dealer-recruitment callers
// that migrated onto `complete()` were on a bare `fetch` before this phase and
// must not GAIN retries they never had (several already wrap their own).
//
// That correctness rule is what makes the policy opt-in, and opt-in is what
// made it possible to forget at exactly one call site. These tests assert the
// five service-driven surfaces carry it, so a stalled Groq socket cannot pin a
// portal chat lambda for the platform maximum while it holds a Prisma
// connection, and a single transient 5xx cannot surface as "AI service error".
//
//   pnpm test:zura

import test, { beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "fs";
import { join } from "path";
import { CHAT_TRANSPORT_POLICY } from "@/lib/ai/transport-policy";

// ─── Scaffolding (same shape as zura-isolation.test.ts) ──────────────────────

const prismaMock = {
  buyer: {
    findUnique: async () => ({
      id: "id-buyer-7f3a",
      userId: "id-user-7f3a",
      firstName: "Ada",
      onboardingComplete: true,
      preQualification: null,
      auctions: [],
      deals: [],
    }),
  },
  dealer: { findUnique: async () => ({ dealershipName: "Frisco Motors", tier: "GOLD", _count: { inventory: 12 } }) },
  affiliate: {
    findUnique: async () => ({ status: "ACTIVE", user: { email: "partner@affiliate-example.com" }, _count: { commissions: 4 } }),
  },
  auctionInvitation: { count: async () => 2 },
  offer: { count: async () => 1 },
  auditLog: { create: async () => ({}) },
};
mock.module("@/lib/prisma", { namedExports: { prisma: prismaMock } });

mock.module("@/lib/security/rate-limit", {
  namedExports: {
    limitGeneral: async () => ({ ok: true }),
    clientIpKey: () => "203.0.113.9",
  },
});

/** Every request the chokepoint received, so the POLICY can be asserted. */
const calls: Array<Record<string, unknown>> = [];

// Only the BEHAVIOUR is mocked. The policy constant deliberately lives in its
// own module (`lib/ai/transport-policy.ts`), so replacing the provider here does
// not blank it out — which is exactly the failure mode that put it there.
mock.module("@/lib/ai/provider", {
  namedExports: {
    complete: async (req: Record<string, unknown>) => {
      calls.push(req);
      return { content: "ok", model: "openai/gpt-oss-120b", provider: "groq", tokensUsed: 10, raw: {} };
    },
  },
});

type ChatService = typeof import("../zura-chat.service");
let svc: ChatService;

beforeEach(async () => {
  calls.length = 0;
  svc = await import("../zura-chat.service");
});

const ACTORS = {
  "public-web": { actorType: "SYSTEM" as const, actorId: "anon", authenticatedRole: null },
  voice: { actorType: "SYSTEM" as const, actorId: "anon", authenticatedRole: null },
  buyer: { actorType: "BUYER" as const, actorId: "id-buyer-7f3a", authenticatedRole: "BUYER" as const },
  dealer: { actorType: "DEALER" as const, actorId: "id-dealer-4e2d", authenticatedRole: "DEALER" as const },
  affiliate: { actorType: "AFFILIATE" as const, actorId: "id-affiliate-2a5c", authenticatedRole: "AFFILIATE" as const },
  admin: { actorType: "ADMIN" as const, actorId: "id-admin-1", authenticatedRole: "SUPER_ADMIN" as const },
};

// ─── The policy itself ───────────────────────────────────────────────────────

test("the shared policy states the groq-sdk's own defaults", () => {
  // `node_modules/groq-sdk/core.js`: `constructor({ maxRetries = 2, timeout = 60000 })`.
  // These are not free parameters — they are the values every surface already
  // had, so they are asserted rather than left to drift.
  assert.equal(CHAT_TRANSPORT_POLICY.maxRetries, 2);
  assert.equal(CHAT_TRANSPORT_POLICY.timeoutMs, 60_000);
});

// ─── Every service-driven surface carries it ─────────────────────────────────

for (const surface of Object.keys(ACTORS) as Array<keyof typeof ACTORS>) {
  test(`${surface}: the model request is bounded by a request timeout`, async () => {
    await svc.runZuraTurn({ surface, actor: ACTORS[surface], message: "hello" });
    assert.equal(calls.length, 1, "the surface must reach the chokepoint exactly once");
    assert.equal(
      calls[0].timeoutMs,
      CHAT_TRANSPORT_POLICY.timeoutMs,
      `${surface} lost the 60s abort the groq-sdk gave it; a stalled provider socket would pin the lambda`,
    );
  });

  test(`${surface}: the model request retries a transient failure`, async () => {
    await svc.runZuraTurn({ surface, actor: ACTORS[surface], message: "hello" });
    assert.equal(
      calls[0].maxRetries,
      CHAT_TRANSPORT_POLICY.maxRetries,
      `${surface} lost the SDK's 2 automatic retries; one transient 5xx would surface as an error`,
    );
  });
}

// ─── Anti-drift ──────────────────────────────────────────────────────────────

function code(relPath: string): string {
  const src = readFileSync(join(process.cwd(), relPath), "utf8");
  // Strip comments so the assertions match real code, not prose about it.
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

test("both chat entry points reference the SHARED policy, not their own literals", () => {
  for (const f of ["lib/ai/groq-client.ts", "lib/services/ai/zura-chat.service.ts"]) {
    assert.match(
      code(f),
      /CHAT_TRANSPORT_POLICY/,
      `${f} must inherit the shared policy — two copies of "60000" would drift apart silently`,
    );
  }
});

// The counterpart assertion — that `complete()` injects NO default of its own,
// so the bare-fetch callers keep exactly what they had — is behavioural and
// already lives in `lib/ai/__tests__/groq-transport.test.ts` ("a direct
// `complete()` caller gets NO retries and NO timeout, as before"), which drives
// the real provider against a mocked fetch and counts the attempts. Restating
// it as a source-text regex here would be strictly weaker and would trip on the
// shared constant's own literals.

test("the policy does NOT live in the module every AI test mocks", () => {
  // Regression guard. While the constant was exported from `lib/ai/provider.ts`,
  // every suite that mocked the provider (`zura-isolation`, `zura-idempotency`,
  // `zura-guardrail-adoption`) read it back as `undefined`, and the production
  // dereference threw `Cannot read properties of undefined (reading
  // 'maxRetries')` on all six surfaces. Behaviour is mocked; data must not be.
  assert.ok(
    !/export const CHAT_TRANSPORT_POLICY/.test(code("lib/ai/provider.ts")),
    "provider.ts is universally mocked — a constant exported from it reads back undefined",
  );
});
