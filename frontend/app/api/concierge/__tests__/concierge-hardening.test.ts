// `/api/concierge` — the anonymous public concierge, hardened.
//
// The HIGH this closes: anonymous, un-rate-limited, no kill switch, identity
// consisting of a `sessionId` the BROWSER minted, consent written because an
// email was merely present in the body, and unbounded promotion into the dealer
// sourcing pipeline.
//
// Each of those is asserted here as behaviour, not as an intention.
//
//   pnpm test:concierge-route

import test, { beforeEach, mock } from "node:test";
import assert from "node:assert/strict";

// Transitive imports construct clients at module scope; give them harmless values.
process.env.NEXT_PUBLIC_SUPABASE_URL = "http://localhost:54321";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service";
process.env.ZURA_SESSION_SECRET = "test-session-secret";

mock.module("server-only", { namedExports: {}, defaultExport: {} });

// ─── Controllable test state ─────────────────────────────────────────────────

interface Ctrl {
  aiEnabled: boolean;
  turnLimitOk: boolean;
  promoteLimitOk: boolean;
  opportunities: Map<string, Record<string, unknown>>;
  /** Rows the CAS completion claim has already taken. */
  completedClaims: Set<string>;
  promotions: string[];
  contactUpserts: Array<Record<string, unknown>>;
  auditRows: Array<Record<string, unknown>>;
  extracted: Record<string, unknown>;
  rateLimitKeys: string[];
}
let ctrl: Ctrl;

function freshCtrl(): Ctrl {
  return {
    aiEnabled: true,
    turnLimitOk: true,
    promoteLimitOk: true,
    opportunities: new Map(),
    completedClaims: new Set(),
    promotions: [],
    contactUpserts: [],
    auditRows: [],
    // A COMPLETE profile, so the deterministic completeness predicate fires and
    // the promotion path is actually exercised on every turn under test.
    extracted: {
      make: "Toyota",
      model: "Highlander",
      bodyStyle: null,
      vehicleType: "new",
      yearMin: null,
      yearMax: null,
      trim: null,
      budgetType: "total",
      budgetAmount: 45000,
      monthlyPayment: null,
      timeline: "this_week",
      zip: "75035",
      phone: "+19725550143",
      hasTradeIn: false,
      financingNeeded: null,
      firstName: "Ada",
    },
    rateLimitKeys: [],
  };
}
ctrl = freshCtrl();

let idSeq = 0;

mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      buyerOpportunity: {
        findUnique: async ({ where }: { where: { sessionId: string } }) =>
          ctrl.opportunities.get(where.sessionId) ?? null,
        create: async ({ data }: { data: Record<string, unknown> }) => {
          const row = { id: `bo_${++idSeq}`, completed: false, messages: [], ...data };
          ctrl.opportunities.set(data.sessionId as string, row);
          return row;
        },
        update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          for (const [k, v] of ctrl.opportunities) {
            if ((v as { id: string }).id === where.id) {
              const merged = { ...v, ...data };
              ctrl.opportunities.set(k, merged);
              return merged;
            }
          }
          return { id: where.id, ...data };
        },
        // The CAS completion claim: exactly one caller sees count 1.
        updateMany: async ({ where }: { where: { id: string; completed: boolean } }) => {
          if (ctrl.completedClaims.has(where.id)) return { count: 0 };
          ctrl.completedClaims.add(where.id);
          return { count: 1 };
        },
      },
      auditLog: {
        create: async ({ data }: { data: Record<string, unknown> }) => {
          ctrl.auditRows.push(data);
          return data;
        },
      },
    },
  },
});

mock.module("@/lib/ai/kill-switch", {
  namedExports: {
    isAiEnabledAsync: async () => ctrl.aiEnabled,
    isAiEnabled: () => ctrl.aiEnabled,
    assertAiEnabled: () => {},
    assertAiEnabledForModelCall: async () => {},
    invalidateKillSwitchCache: () => {},
    __resetKillSwitchCacheForTests: () => {},
    AI_KILL_SWITCH_FLAG: "ai_kill_switch",
    KILL_FLAG_CACHE_MS: 10_000,
  },
});

mock.module("@/lib/security/rate-limit", {
  namedExports: {
    clientIpKey: () => "198.51.100.7",
    limitGeneral: async (key: string) => {
      ctrl.rateLimitKeys.push(key);
      if (key.startsWith("zura:public:promote:")) {
        return ctrl.promoteLimitOk ? { ok: true } : { ok: false, status: 429, message: "slow down" };
      }
      return ctrl.turnLimitOk ? { ok: true } : { ok: false, status: 429, message: "slow down" };
    },
  },
});

mock.module("@/lib/ai/acquisition", {
  namedExports: {
    streamConcierge: async function* () {
      yield "Great — ";
      yield "I have what I need.";
    },
    extractStructuredData: async () => ctrl.extracted,
  },
});

mock.module("@/lib/services/acquisition/unified-buyer-intake.service", {
  namedExports: {
    promoteOpportunity: async (id: string) => {
      ctrl.promotions.push(id);
    },
  },
});

mock.module("@/lib/services/contact.service", {
  namedExports: {
    ContactService: {
      upsertContact: async (_supabase: unknown, input: Record<string, unknown>) => {
        ctrl.contactUpserts.push(input);
      },
    },
  },
});
mock.module("@/lib/supabase-service", { namedExports: { getServiceSupabase: () => ({}) } });
mock.module("@/lib/events/emit", { namedExports: { emitDomainEvent: async () => {} } });

// `after()` must run inline so the post-stream block is observable.
const afterTasks: Array<() => Promise<void>> = [];
mock.module("next/server", {
  namedExports: {
    after: (fn: () => Promise<void>) => {
      afterTasks.push(fn);
    },
  },
});

type Route = typeof import("../route");
let route: Route;

beforeEach(async () => {
  ctrl = freshCtrl();
  afterTasks.length = 0;
  route = await import("../route");
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

function req(body: unknown, handle?: string): Request {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-forwarded-for": "198.51.100.7",
  };
  if (handle) headers["X-Zura-Session"] = handle;
  return new Request("https://autolenis.test/api/concierge", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

async function post(body: unknown, handle?: string) {
  // The route is typed against NextRequest but only uses the standard Request
  // surface plus `headers`, so a plain Request is a faithful stand-in here.
  const res = await route.POST(req(body, handle) as never);
  await drainStream(res);
  for (const task of afterTasks.splice(0)) await task();
  return res;
}

async function drainStream(res: Response): Promise<void> {
  if (!res.body) return;
  const reader = res.body.getReader();
  for (;;) {
    const { done } = await reader.read();
    if (done) break;
  }
  reader.releaseLock();
}

const GATE = { firstName: "Ada", email: "ada@example.com" };

// ─── Kill switch ─────────────────────────────────────────────────────────────

test("AI disabled → 503 AI_DISABLED, and no stream of tokens", async () => {
  ctrl.aiEnabled = false;
  const res = await route.POST(req({ userMessage: "hi", ...GATE }) as never);
  assert.equal(res.status, 503);
  assert.equal(await res.text(), "AI_DISABLED");
  assert.equal(ctrl.opportunities.size, 0, "a disabled turn must not create a row");
});

// ─── Rate limiting ───────────────────────────────────────────────────────────

test("an anonymous flood is rate limited by IP → 429", async () => {
  ctrl.turnLimitOk = false;
  const res = await route.POST(req({ userMessage: "hi" }) as never);
  assert.equal(res.status, 429);
});

test("the per-IP turn limit is keyed on the caller's IP", async () => {
  await post({ userMessage: "hi", ...GATE });
  assert.ok(ctrl.rateLimitKeys.some((k) => k === "zura:public:ip:198.51.100.7"));
});

// ─── Server-issued session handle ────────────────────────────────────────────

test("turn 1 ISSUES a handle, and a client-supplied sessionId is ignored", async () => {
  const res = await post({ sessionId: "attacker-chosen-id", userMessage: "hi", ...GATE });
  const handle = res.headers.get("X-Zura-Session");
  assert.ok(handle, "turn 1 must return a server-issued handle");
  assert.ok(
    !ctrl.opportunities.has("attacker-chosen-id"),
    "the client-supplied session id must never key a row",
  );
  assert.equal(ctrl.opportunities.size, 1);
});

test("a forged handle does not open the named session — a NEW one is started", async () => {
  const first = await post({ userMessage: "hi", ...GATE });
  const realHandle = first.headers.get("X-Zura-Session")!;
  const realSid = [...ctrl.opportunities.keys()][0];

  const forged = Buffer.from(
    JSON.stringify({ sid: realSid, iat: Date.now(), gate: true }),
    "utf8",
  ).toString("base64url") + ".not-a-real-signature";

  const second = await post({ userMessage: "again" }, forged);
  assert.notEqual(second.headers.get("X-Zura-Session"), realHandle);
  assert.equal(ctrl.opportunities.size, 2, "a forged handle must start a fresh session, not adopt one");
});

test("a valid handle CONTINUES the same session across turns", async () => {
  const first = await post({ userMessage: "hi", ...GATE });
  const handle = first.headers.get("X-Zura-Session")!;
  await post({ userMessage: "second turn" }, handle);
  assert.equal(ctrl.opportunities.size, 1, "a valid handle must not fork a new session");
});

test("with no signing secret the route refuses rather than running unauthenticated", async () => {
  const saved = process.env.ZURA_SESSION_SECRET;
  const savedCron = process.env.CRON_SECRET;
  delete process.env.ZURA_SESSION_SECRET;
  process.env.CRON_SECRET = "";
  try {
    const res = await route.POST(req({ userMessage: "hi", ...GATE }) as never);
    assert.equal(res.status, 503);
    assert.equal(await res.text(), "SESSION_NOT_CONFIGURED");
  } finally {
    process.env.ZURA_SESSION_SECRET = saved;
    process.env.CRON_SECRET = savedCron ?? "";
  }
});

// ─── Server-verified consent ─────────────────────────────────────────────────

test("consent is NOT written when the server never validated a gate", async () => {
  // An email alone used to be enough. Now it is not: no first name → no gate.
  await post({ userMessage: "hi", email: "ada@example.com" });
  const written = ctrl.contactUpserts;
  assert.equal(written.length, 1, "the contact is still mirrored — only the CONSENT flags change");
  assert.equal(written[0].consentEmail, false);
  assert.equal(written[0].consentSms, false);
  assert.equal(written[0].consentText, undefined);
});

test("consent IS written when the server validated the gate", async () => {
  await post({ userMessage: "hi", ...GATE });
  const written = ctrl.contactUpserts;
  assert.equal(written.length, 1);
  assert.equal(written[0].consentEmail, true);
  assert.equal(written[0].consentSms, true);
  assert.match(String(written[0].consentText), /lead gate/i);
});

test("an unvalidated gate submission never seeds the opportunity row", async () => {
  // The row is created BEFORE the stream; the gate values are the only thing
  // that could seed it at that point. (`firstName` may later be filled in by
  // the model's extraction of the conversation — that is a different, existing
  // path and is not consent-bearing.)
  await route.POST(req({ userMessage: "hi", firstName: "Ada", email: "not-an-email" }) as never);
  const row = [...ctrl.opportunities.values()][0];
  assert.equal(row.email, null, "an invalid email must not be stored as the lead's address");
  assert.equal(row.firstName, null, "an unvalidated gate must not seed the row");
});

// ─── The gate is RECOVERABLE ─────────────────────────────────────────────────
//
// Regression guard for a defect the adversarial review found. Consent used to be
// recoverable: the client-minted session id was stable for the widget's lifetime
// and the gate email lived on the row, so a dropped first response cost nothing.
// Moving the gate onto a signed handle made it unrecoverable — a lost turn-1
// response, or a handle past its TTL, stranded the visitor in a session that
// could never promote. The server now REPORTS gate status so the client can
// re-send, and accepts a gate submission on any turn.

test("the response reports gate status so a client can tell it needs to re-send", async () => {
  const ungated = await post({ userMessage: "hi" });
  assert.equal(ungated.headers.get("X-Zura-Gate"), "0");

  const gated = await post({ userMessage: "hi", ...GATE });
  assert.equal(gated.headers.get("X-Zura-Gate"), "1");
});

test("a gate accepted on a LATER turn upgrades the session and enables promotion", async () => {
  // Turn 1: the response was lost, so the visitor's session is un-gated.
  const first = await post({ userMessage: "hi" });
  const handle = first.headers.get("X-Zura-Session")!;
  assert.equal(first.headers.get("X-Zura-Gate"), "0");
  assert.deepEqual(ctrl.promotions, [], "an un-gated session must not promote");

  // Turn 2: the client re-sends the gate because the server said "0".
  const second = await post({ userMessage: "here you go", ...GATE }, handle);
  assert.equal(second.headers.get("X-Zura-Gate"), "1");
  assert.ok(second.headers.get("X-Zura-Session"), "the upgraded handle must be re-issued");
  assert.equal(ctrl.promotions.length, 1, "the recovered gate must restore the funnel");
  assert.equal(ctrl.opportunities.size, 1, "recovery must not fork the session");
});

test("a re-sent gate on an ALREADY-gated session changes nothing", async () => {
  const first = await post({ userMessage: "hi", ...GATE });
  const handle = first.headers.get("X-Zura-Session")!;
  const before = ctrl.promotions.length;
  const second = await post({ userMessage: "again", ...GATE }, handle);
  assert.equal(second.headers.get("X-Zura-Gate"), "1");
  assert.equal(ctrl.promotions.length, before, "the CAS claim still collapses the replay");
});

// ─── Bounded promotion ───────────────────────────────────────────────────────

test("promotion requires a server-verified gate", async () => {
  await post({ userMessage: "hi" }); // no gate at all
  assert.deepEqual(ctrl.promotions, [], "an un-gated visitor must not enter the sourcing pipeline");
});

test("a gated, complete profile DOES promote — the capability still works", async () => {
  await post({ userMessage: "hi", ...GATE });
  assert.equal(ctrl.promotions.length, 1);
});

test("a replayed post-stream block promotes ONCE, not twice", async () => {
  const first = await post({ userMessage: "hi", ...GATE });
  const handle = first.headers.get("X-Zura-Session")!;
  await post({ userMessage: "again" }, handle);
  assert.equal(ctrl.promotions.length, 1, "the CAS completion claim must collapse the replay");
});

test("the per-IP daily promotion cap blocks promotion without blocking the reply", async () => {
  ctrl.promoteLimitOk = false;
  const res = await post({ userMessage: "hi", ...GATE });
  assert.equal(res.status, 200, "a promotion cap must never break the visitor's conversation");
  assert.deepEqual(ctrl.promotions, []);
});

// ─── Unified AI audit ────────────────────────────────────────────────────────

test("the public surface writes exactly one AI-audit row per turn", async () => {
  await post({ userMessage: "hi", ...GATE });
  const aiRows = ctrl.auditRows.filter(
    (r) => (r.metadata as { actorAction?: string })?.actorAction === "AI_TURN",
  );
  assert.equal(aiRows.length, 1);
  const meta = aiRows[0].metadata as Record<string, unknown>;
  assert.equal(meta.surface, "public-web");
  assert.equal(meta.outcome, "ANSWERED");
});

test("the AI-audit row records message LENGTH, never message content", async () => {
  await post({ userMessage: "my phone is 972-555-0143", ...GATE });
  const meta = ctrl.auditRows.find(
    (r) => (r.metadata as { actorAction?: string })?.actorAction === "AI_TURN",
  )!.metadata as Record<string, unknown>;
  assert.equal(meta.messageLength, "my phone is 972-555-0143".length);
  assert.ok(!JSON.stringify(meta).includes("972-555-0143"), "the audit trail must not copy the message body");
});

test("an anonymous actor is recorded with a null role, never a falsified admin", async () => {
  await post({ userMessage: "hi", ...GATE });
  const row = ctrl.auditRows.find(
    (r) => (r.metadata as { actorAction?: string })?.actorAction === "AI_TURN",
  )!;
  assert.equal(row.adminId, null, "an anonymous turn must never claim an admin principal");
  assert.equal((row.metadata as Record<string, unknown>).authenticatedRole, null);
});

// ─── Input bounds ────────────────────────────────────────────────────────────

test("an over-long message is rejected before any model call", async () => {
  const res = await route.POST(req({ userMessage: "x".repeat(2001), ...GATE }) as never);
  assert.equal(res.status, 400);
  assert.equal(ctrl.opportunities.size, 0);
});

test("a missing userMessage is rejected", async () => {
  const res = await route.POST(req({ ...GATE }) as never);
  assert.equal(res.status, 400);
});
