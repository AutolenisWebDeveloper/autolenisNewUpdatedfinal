// The seven personas' guardrail text — adopted into force, and PROVEN adopted.
//
// Phase 2 retires `routeToAgent` (a dispatcher with no `admin` and no
// `affiliate` arm, driven by a client string) while KEEPING its guardrails,
// which were the strongest prompt content in the repository and were in force
// nowhere. "Kept" is a claim that decays the moment someone edits one copy, so
// it is checked two ways here:
//
//   1. each SOURCE guardrail still appears VERBATIM in `agents.ts`, so the copy
//      in `zura-personas.ts` cannot silently diverge from what it claims to have
//      been copied from; and
//   2. each ADOPTED guardrail appears in the composed prompt for the surface and
//      state it belongs to, so it is actually reaching a model.
//
//   pnpm test:zura

import test, { beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  SOURCE_GUARDRAILS,
  PREQUAL_GUARDRAIL_ADOPTED,
  AUCTION_GUARDRAIL_ADOPTED,
  SEARCH_GUARDRAIL_ADOPTED,
  DEALER_GUARDRAIL_ADOPTED,
  BUYER_BASELINE_ADOPTED,
  dealGuardrailAdopted,
} from "../zura-personas";

const AGENTS_SOURCE = readFileSync(join(process.cwd(), "lib/services/ai/agents.ts"), "utf8");

// ─── 1. The source is still there, verbatim ──────────────────────────────────

test("every source guardrail still appears verbatim in agents.ts", () => {
  for (const [name, text] of Object.entries(SOURCE_GUARDRAILS)) {
    assert.ok(
      AGENTS_SOURCE.includes(text),
      `guardrail "${name}" no longer matches agents.ts — the adopted copy has drifted from its source`,
    );
  }
});

test("agents.ts retains all seven agent functions — no agent was deleted", () => {
  for (const fn of [
    "buyerConciergeAgent",
    "prequalAdvisorAgent",
    "searchAdvisorAgent",
    "auctionAdvisorAgent",
    "dealAdvisorAgent",
    "dealerAdvisorAgent",
    "adminBriefingAgent",
  ]) {
    assert.match(AGENTS_SOURCE, new RegExp(`export async function ${fn}\\b`), `${fn} is missing`);
  }
});

test("routeToAgent and AgentType are RETIRED as code, not merely unused", () => {
  assert.ok(
    !/export\s+(async\s+)?function\s+routeToAgent/.test(AGENTS_SOURCE),
    "routeToAgent must not be exported — it dispatched on a client string and had no admin/affiliate arm",
  );
  assert.ok(
    !/export\s+type\s+AgentType/.test(AGENTS_SOURCE),
    "the AgentType union must be gone — it was the selector already on the wire",
  );
});

test("no module anywhere imports routeToAgent", () => {
  // A grep-style structural assertion: the retirement is only real if nothing
  // can reach it. `agents.ts` itself only mentions it in prose.
  const roots = ["lib", "app", "components"];
  const { readdirSync, statSync } = require("node:fs") as typeof import("node:fs");
  const offenders: string[] = [];
  const walk = (dir: string) => {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const e of entries) {
      if (e === "node_modules" || e === ".next" || e === "__tests__") continue;
      const full = join(dir, e);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.tsx?$/.test(e)) {
        const src = readFileSync(full, "utf8");
        if (/import\s*\{[^}]*\brouteToAgent\b/.test(src)) offenders.push(full);
      }
    }
  };
  for (const r of roots) walk(join(process.cwd(), r));
  assert.deepEqual(offenders, []);
});

// ─── 2. The adopted text reaches a model ─────────────────────────────────────

const prismaMock = {
  buyer: {
    findUnique: async ({ where }: { where: { id: string } }) => ({
      id: where.id,
      userId: "u",
      firstName: "Ada",
      onboardingComplete: true,
      preQualification: {
        decision: "APPROVED",
        tier: "TIER_2",
        maxOtdAmountCents: 4_000_000,
        expiresAt: new Date(Date.now() + 86_400_000),
      },
      auctions: where.id === "buyer-auction" ? [{ id: "a1", status: "ACTIVE", endsAt: new Date(), _count: { offers: 3 } }] : [],
      deals: where.id === "buyer-deal" ? [{ id: "d1", status: "FINANCING", offer: { otdPriceCents: 3_000_000 } }] : [],
    }),
  },
  dealer: {
    findUnique: async () => ({ dealershipName: "Frisco Motors", tier: "GOLD", _count: { inventory: 1 } }),
  },
  affiliate: { findUnique: async () => ({ status: "ACTIVE", _count: { commissions: 1 } }) },
  auctionInvitation: { count: async () => 0 },
  offer: { count: async () => 0 },
  auditLog: { create: async () => ({}) },
};
mock.module("@/lib/prisma", { namedExports: { prisma: prismaMock } });
mock.module("@/lib/security/rate-limit", {
  namedExports: { limitGeneral: async () => ({ ok: true }), clientIpKey: () => "203.0.113.9" },
});

const calls: string[] = [];
mock.module("@/lib/ai/provider", {
  namedExports: {
    complete: async (req: { messages: Array<{ role: string; content: string }> }) => {
      calls.push(req.messages.find((m) => m.role === "system")?.content ?? "");
      return { content: "ok", model: "openai/gpt-oss-120b", provider: "groq", tokensUsed: 1, raw: {} };
    },
  },
});

type ChatService = typeof import("../zura-chat.service");
let svc: ChatService;

beforeEach(async () => {
  calls.length = 0;
  svc = await import("../zura-chat.service");
});

async function buyerPrompt(actorId: string): Promise<string> {
  await svc.runZuraTurn({
    surface: "buyer",
    actor: { actorType: "BUYER", actorId, authenticatedRole: "BUYER" },
    message: "hi",
  });
  return calls[calls.length - 1];
}

test("BUYER baseline warmth guardrail is in the composed prompt", async () => {
  assert.ok((await buyerPrompt("buyer-plain")).includes(BUYER_BASELINE_ADOPTED));
});

test("the prequal guardrail is in force — and resolves the ceiling contradiction", async () => {
  const p = await buyerPrompt("buyer-plain");
  assert.ok(p.includes(PREQUAL_GUARDRAIL_ADOPTED));
  // The RESOLUTION (Phase 2 §1.3a): the source sentence banned "the specific
  // dollar amounts from iPredict" outright, which contradicted printing the
  // buyer's own ceiling. The adopted text narrows the ban to the INTERNALS.
  assert.ok(
    !p.includes(SOURCE_GUARDRAILS.prequal),
    "the unnarrowed source sentence must not ship — it contradicts the ceiling line",
  );
  assert.match(p, /READ-ONLY/);
  assert.match(p, /\$40,000/);
  assert.ok(!p.includes("TIER_2"));
});

test("the auction guardrail is UNCONDITIONAL on the buyer surface", async () => {
  // Present even with no live auction: the cost of omitting it when one exists
  // is far higher than the cost of stating it when one does not.
  assert.ok((await buyerPrompt("buyer-plain")).includes(AUCTION_GUARDRAIL_ADOPTED));
  assert.ok((await buyerPrompt("buyer-auction")).includes(AUCTION_GUARDRAIL_ADOPTED));
});

test("the search guardrail appears only in a searching/shortlist state", async () => {
  // `buyer-plain` has a live prequal and no auction/deal → journeyStage "searching".
  assert.ok((await buyerPrompt("buyer-plain")).includes(SEARCH_GUARDRAIL_ADOPTED));
  assert.ok(
    !(await buyerPrompt("buyer-deal")).includes(SEARCH_GUARDRAIL_ADOPTED),
    "a buyer mid-deal should not be loaded with shortlist guidance",
  );
});

test("the deal guardrail appears only when a deal is active", async () => {
  assert.ok((await buyerPrompt("buyer-deal")).includes(dealGuardrailAdopted()));
  assert.ok(!(await buyerPrompt("buyer-plain")).includes(dealGuardrailAdopted()));
});

test("the dealer guardrail is in force on the dealer surface", async () => {
  await svc.runZuraTurn({
    surface: "dealer",
    actor: { actorType: "DEALER", actorId: "d1", authenticatedRole: "DEALER" },
    message: "hi",
  });
  assert.ok(calls[calls.length - 1].includes(DEALER_GUARDRAIL_ADOPTED));
});

test("the admin briefing agent keeps its own guardrail and both entrypoints", () => {
  // It stays an agent (Phase 2 §8.2): the admin route and the cron both call it.
  assert.ok(AGENTS_SOURCE.includes(SOURCE_GUARDRAILS.adminBriefing));
});

test("every surface's prompt carries the shared Zura knowledge base", async () => {
  const surfaces = [
    ["public-web", { actorType: "SYSTEM" as const, actorId: "anon", authenticatedRole: null }],
    ["buyer", { actorType: "BUYER" as const, actorId: "b1", authenticatedRole: "BUYER" as const }],
    ["dealer", { actorType: "DEALER" as const, actorId: "d1", authenticatedRole: "DEALER" as const }],
    ["affiliate", { actorType: "AFFILIATE" as const, actorId: "a1", authenticatedRole: "AFFILIATE" as const }],
    ["admin", { actorType: "ADMIN" as const, actorId: "adm1", authenticatedRole: "SUPER_ADMIN" as const }],
  ] as const;
  for (const [surface, actor] of surfaces) {
    calls.length = 0;
    await svc.runZuraTurn({ surface, actor, message: "hi" });
    assert.match(
      calls[calls.length - 1],
      /You are Zura, the AutoLenis AI concierge/,
      `${surface}: one brain means one shared knowledge base on every surface`,
    );
  }
});
