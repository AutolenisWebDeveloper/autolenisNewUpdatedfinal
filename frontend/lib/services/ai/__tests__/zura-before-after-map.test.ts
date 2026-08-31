// The Phase 2 §8 before → after map, asserted as code.
//
// "Nothing that works today silently disappears" is the design's own standard,
// and prose cannot enforce it. These are the structural halves of that promise:
// what must still EXIST, what must be GONE, and the couple of behaviours whose
// preservation is easy to break by accident during a transport migration.
//
// Behavioural preservation of the six chat surfaces lives in
// `zura-isolation.test.ts`; guardrail preservation in
// `zura-guardrail-adoption.test.ts`; the public intake path in
// `app/api/concierge/__tests__/concierge-hardening.test.ts`; and the whole
// pre-existing suite (`pnpm test:all`) is the broadest evidence of all.
//
//   pnpm test:zura

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

/**
 * Source with comments stripped.
 *
 * These assertions are about CODE, not prose. Several of the modules under test
 * document what was removed and why — quoting the removed string in a comment is
 * exactly the right thing for a reader and exactly the wrong thing to match on,
 * so the comments come out before matching.
 *
 * Deliberately simple: block comments and line comments only. It does not model
 * `//` inside a string literal, which none of the assertions below depends on.
 */
const code = (p: string) =>
  read(p)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((line) => line.replace(/(^|[^:])\/\/.*$/, "$1"))
    .join("\n");

// ─── The six Zura surfaces (§8.1) ────────────────────────────────────────────

test("all five authenticated/public chat routes still exist and export POST", () => {
  const routes = [
    "app/api/concierge/route.ts",
    "app/api/buyer/ai/chat/route.ts",
    "app/api/dealer/ai/chat/route.ts",
    "app/api/affiliate/ai/chat/route.ts",
    "app/api/admin/ai/chat/route.ts",
  ];
  for (const r of routes) {
    assert.ok(existsSync(join(ROOT, r)), `${r} is missing — a surface disappeared`);
    assert.match(code(r), /export async function POST/, `${r} no longer serves POST`);
  }
});

test("the voice turn handler keeps its own transport but joins the shared trail", () => {
  // §3.3 row 2: voice folds in PARTIALLY. It keeps its own turn handler, TwiML
  // transport, conversation store and latency budget; it shares the prompt core,
  // the provider adapter, the kill switch and the AI audit.
  const src = code("lib/voice/handle-turn.ts");
  assert.ok(existsSync(join(ROOT, "lib/voice/handle-turn.ts")));
  assert.match(src, /VoiceResponse/, "the TwiML transport must stay its own");
  assert.match(src, /getConversation\(callSid\)/, "the conversation store must stay its own");
  assert.match(src, /recordAiEvent\(/, "voice must write to the unified AI audit trail");
  assert.match(src, /surface: "voice"/);
});

test("every one of the six surfaces writes to the unified AI audit trail", () => {
  // The trail's value is that it has no hole. Assert each surface reaches it.
  const sources: Array<[string, string]> = [
    ["public-web", "app/api/concierge/route.ts"],
    ["voice", "lib/voice/handle-turn.ts"],
    // The four authenticated surfaces reach it through the shared service.
    ["buyer|dealer|affiliate|admin", "lib/services/ai/zura-chat.service.ts"],
  ];
  for (const [label, file] of sources) {
    assert.match(code(file), /recordAiEvent\(/, `${label} (${file}) does not audit its turns`);
  }
});

test("each route derives its surface as a SERVER-side constant", () => {
  for (const [route, surface] of [
    ["app/api/buyer/ai/chat/route.ts", "buyer"],
    ["app/api/dealer/ai/chat/route.ts", "dealer"],
    ["app/api/affiliate/ai/chat/route.ts", "affiliate"],
    ["app/api/admin/ai/chat/route.ts", "admin"],
  ] as const) {
    assert.match(
      code(route),
      new RegExp(`const SURFACE = "${surface}" as const`),
      `${route} must pin its surface in code, not read it from a request`,
    );
  }
});

test("the admin surface still writes its own ADMIN_AI_CHAT admin-audit row", () => {
  // §3.6: the one surface that already audited must not lose its trail. The AI
  // trail is written IN ADDITION, never instead.
  const src = code("app/api/admin/ai/chat/route.ts");
  assert.match(src, /createAuditLog\(/);
  assert.match(src, /action: "ADMIN_AI_CHAT"/);
});

test("the buyer activity breadcrumb survives, keyed on the server-derived surface", () => {
  const src = code("app/api/buyer/ai/chat/route.ts");
  assert.match(src, /buyerActivityEvent/);
  assert.match(src, /eventType: "AI_CHAT"/);
  assert.match(src, /surface: SURFACE/, "the metadata must carry the server-derived surface");
  assert.ok(!/agentType/.test(src), "the client-supplied agentType must not be recorded any more");
});

// ─── Retired, deliberately (§8.5) ────────────────────────────────────────────

test("/api/public/ai/chat is RETIRED — its guarantees moved into the shared service", () => {
  assert.ok(
    !existsSync(join(ROOT, "app/api/public/ai/chat/route.ts")),
    "the dormant, unreachable public route should be gone",
  );
  // Its four guarantees now live in one place, for all six surfaces.
  const svc = code("lib/services/ai/zura-chat.service.ts");
  assert.match(svc, /MAX_MESSAGE_LENGTH = 2000/);
  assert.match(svc, /MAX_HISTORY_MESSAGES = 8/);
  assert.match(svc, /limitGeneral/);
  assert.match(svc, /rateLimit: \{ tokens: 20, window: "1 h" \}/);
});

test("the `agentType` prop is gone from the widget and from every caller", () => {
  const widget = code("components/public/ChatWidget.tsx");
  assert.ok(!/agentType/.test(widget), "agentType must be gone from the component entirely");
  assert.ok(!/agentType={/.test(code("app/buyer/layout.tsx")), "no layout may still pass it");
});

test('the "Alex" second persona is gone', () => {
  assert.ok(!/I'm Alex/.test(code("components/public/ChatWidget.tsx")));
});

test("no client component reads the kill switch (it never worked there)", () => {
  for (const f of ["components/public/ChatWidget.tsx", "app/admin/ai/page.tsx"]) {
    const src = code(f);
    assert.ok(/^\s*"use client"/m.test(src), `${f} is expected to be a client module`);
    assert.ok(!/isAiEnabled/.test(src), `${f} still calls isAiEnabled — it always returns true there`);
    assert.ok(!/lib\/ai\/kill-switch/.test(src), `${f} still imports the kill switch`);
  }
});

test("the /admin/ai console's three false claims are gone and its selector resolves", () => {
  const page = code("app/admin/ai/page.tsx");
  const widget = code("components/public/ChatWidget.tsx");
  assert.ok(!/only approved provider/.test(page), "the false single-provider claim must be gone");
  assert.ok(!/explicitly prohibited/.test(page), "the false prohibition claim must be gone");
  assert.ok(!/Available agents/.test(page), "the agent count was a routing internal, and wrong");
  // The button queried `chat-toggle-btn`, which matches nothing. It must name a
  // testid that the widget actually renders.
  const selector = page.match(/data-testid='([a-z-]+)'/)?.[1];
  assert.ok(selector, "the console must still offer a way to open the widget");
  assert.ok(
    widget.includes(`data-testid="${selector}"`),
    `the console queries [data-testid='${selector}'], which the widget does not render`,
  );
});

// ─── Preserved capabilities that a transport migration could break ───────────

test("groqChat and groqChatStream keep their exported signatures", () => {
  const src = code("lib/ai/groq-client.ts");
  assert.match(src, /export async function groqChat\(/);
  assert.match(src, /export async function\* groqChatStream\(/);
  // The model pair and the fallback chain are preserved, not reinvented.
  assert.match(src, /openai\/gpt-oss-120b/);
  assert.match(src, /openai\/gpt-oss-20b/);
  assert.match(src, /fallbackModel: FALLBACK_MODEL/);
});

test("the admin morning briefing keeps BOTH entrypoints", () => {
  assert.match(code("app/api/admin/ai/briefing/route.ts"), /adminBriefingAgent/);
  assert.match(code("lib/services/admin/morning-briefing.service.ts"), /adminBriefingAgent/);
});

test("detectOptOutIntent is unchanged in the way that matters: it fails to FALSE", () => {
  // Phase 1 §G.3 #8: the deterministic keyword set runs first at the SMS layer
  // and the model can only WIDEN an opt-out. Its failure path returning `false`
  // is what makes "with AI disabled, STOP still works" true, so a migration that
  // let it throw would be a compliance regression.
  const src = code("lib/ai/acquisition.ts");
  const fn = src.slice(src.indexOf("export async function detectOptOutIntent"));
  const body = fn.slice(0, fn.indexOf("\n}\n") + 3);
  assert.match(body, /catch \(err\) \{[\s\S]*return false;/, "the failure path must still return false");
  assert.ok(!/throw/.test(body), "detectOptOutIntent must never throw");
});

test("the search interpreter still enforces the kill switch itself", () => {
  // §8.4: enforced TWICE (its own check plus the adapter). The extra check is
  // preserved rather than removed as newly-redundant.
  assert.match(code("lib/services/ai/search-interpreter.ts"), /isAiEnabled|assertAiEnabled/);
});

test("the CRM Copilot's approve boundary is untouched", () => {
  const src = code("lib/ai/crm-copilot.ts");
  assert.match(src, /COPILOT_MODEL/);
  // It now reaches its model through the chokepoint — the ONLY change.
  assert.match(src, /from '@\/lib\/ai\/provider'/);
});

// ─── One activation authority, propose and execute ───────────────────────────

test("the durable engine deps resolve activation through the FeatureFlag substrate", () => {
  // Regression guard for a defect the adversarial review found: proposal ran
  // through the FeatureFlag resolver while the admin approve/reject routes
  // revalidated through the ENV resolver. Turning a capability off at runtime
  // therefore did not stop an already-proposed intent from executing on
  // approval — which is the entire point of having a runtime switch.
  const src = code("lib/services/ai/action-intent/prisma-store.ts");
  assert.match(
    src,
    /activation: overrides\.activation \?\? featureFlagActivationResolver\(\)/,
    "createDurableEngineDeps must resolve activation through the FeatureFlag substrate",
  );
  assert.ok(
    !/envActivationResolver/.test(src),
    "the env resolver must not be the production default — it cannot be flipped at runtime",
  );
});

test("the chat service does NOT override the activation authority", () => {
  // A second copy of the decision is a second thing to keep in sync, and the
  // split between the two authorities is exactly what caused the defect.
  const src = code("lib/services/ai/zura-chat.service.ts");
  assert.ok(!/activation:/.test(src), "the chat service must inherit the durable default");
});

// ─── Zura persistence never targets the CRM inbox table ──────────────────────

test("no Zura module writes prisma.conversation (it is the CRM inbox, not an AI table)", () => {
  // In production `conversations` carries contact_id / phone / channel /
  // assigned_to / unread_count and has no session_id. §0.4 fact 2.
  //
  // SCOPE NOTE: `app/api/finder/route.ts` does write it and is deliberately
  // excluded. It is a pre-existing non-Zura surface that this phase does not
  // touch — and, contrary to the Phase 3 brief's stated fact, it was NOT deleted
  // in PR #375; that PR modified it (removing a cross-buyer mutation) and the
  // file is still present on `main`. Recorded here rather than acted on.
  const zuraModules = [
    "lib/services/ai",
    "lib/ai",
    "app/api/concierge",
    "app/api/buyer/ai",
    "app/api/dealer/ai",
    "app/api/affiliate/ai",
    "app/api/admin/ai",
  ];
  const offenders: string[] = [];
  const walk = (dir: string) => {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const e of entries) {
      if (e === "node_modules" || e === "__tests__") continue;
      const full = join(dir, e);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.tsx?$/.test(e)) {
        const src = code(relative(ROOT, full).split(sep).join("/"));
        if (/prisma\.conversation\.(create|update|upsert|delete|updateMany)/.test(src)) {
          offenders.push(relative(ROOT, full).split(sep).join("/"));
        }
      }
    }
  };
  for (const m of zuraModules) walk(join(ROOT, m));
  assert.deepEqual(offenders, []);
});

test("the transcript seam is inert in 3A and never writes anything", () => {
  const src = code("lib/services/ai/zura-transcript.service.ts");
  assert.match(src, /return false;/);
  assert.ok(
    !/prisma\.\w+\.(create|update|upsert)/.test(src),
    "the 3A seam must contain no write at all — the schema cannot hold one yet",
  );
});
