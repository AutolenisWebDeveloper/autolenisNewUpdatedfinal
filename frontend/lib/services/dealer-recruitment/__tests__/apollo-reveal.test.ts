<<<<<<< HEAD
// Block B / Apollo — gated reveal orchestration: cache → claim → atomic
// WORST-CASE draw → adapter → refund the unbilled remainder → store, with the
// credit ledger. Injected fake prisma models the unique claim + the conditional
// ledger draw exactly, so the money guarantees (no double-draw, the draw precedes
// every paid call, only documented-free outcomes refund, off-until-enabled) are
// provable offline.
=======
// Block B / Apollo — gated reveal orchestration: cache → claim → atomic draw →
// adapter → store, with the credit ledger. Injected fake prisma models the
// unique claim + the conditional ledger draw exactly, so the money guarantees
// (no double-draw, refund on miss, off-until-enabled) are provable offline.
>>>>>>> 92c9fdf4 (Phase 1 (§13-D2): record that the cancel path does not exist, and carry the admin cancel action into Phase 2)
//   npx tsx --test lib/services/dealer-recruitment/__tests__/apollo-reveal.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import type { PrismaClient } from "@prisma/client";
<<<<<<< HEAD
import { revealRooftopContact, REVEAL_TOTAL_COST_CREDITS, REVEAL_COST_CREDITS } from "../apollo-reveal.service";
import {
  apolloResolveAndReveal,
  ORG_RESOLVE_COST_CREDITS,
  MAX_CREDITS_PER_ATTEMPT,
  type ApolloClient,
} from "../apollo.service";
=======
import { revealRooftopContact } from "../apollo-reveal.service";
import { apolloResolveAndReveal, type ApolloClient } from "../apollo.service";
>>>>>>> 92c9fdf4 (Phase 1 (§13-D2): record that the cancel path does not exist, and carry the admin cancel action into Phase 2)

const NOW = new Date("2026-08-10T00:00:00Z"); // cycle 2026-08, day 10, 31-day month

interface LedgerRow { cycleKey: string; capCredits: number; spentCredits: number }
type RevealRow = Record<string, unknown> & { id: string; rooftopId: string; cycleKey: string; status: string; email: string | null; revealedAt: Date };

function fake(ledger: LedgerRow, reveals: RevealRow[] = []): { prisma: PrismaClient; ledger: LedgerRow; reveals: RevealRow[] } {
  let idc = 0;
  const prisma = {
    apolloReveal: {
      findFirst: async ({ where }: { where: Record<string, unknown> }) => {
        let rows = reveals.filter((r) => r.rooftopId === where.rooftopId);
        if (where.cycleKey) rows = rows.filter((r) => r.cycleKey === where.cycleKey);
        if (where.status) rows = rows.filter((r) => r.status === where.status);
        if ((where.email as { not?: unknown } | undefined)?.not === null) rows = rows.filter((r) => r.email != null);
        return rows[rows.length - 1] ?? null;
      },
      create: async ({ data }: { data: Record<string, unknown> }) => {
        if (reveals.some((r) => r.rooftopId === data.rooftopId && r.cycleKey === data.cycleKey)) {
          throw new Error("unique violation");
        }
        const row = { id: `rv${++idc}`, revealedAt: NOW, email: null, ...data } as RevealRow;
        reveals.push(row);
        return row;
      },
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const r = reveals.find((x) => x.id === where.id);
        if (r) Object.assign(r, data);
        return r;
      },
      delete: async ({ where }: { where: { id: string } }) => {
        const i = reveals.findIndex((x) => x.id === where.id);
        if (i >= 0) reveals.splice(i, 1);
        return {};
      },
    },
    apolloCreditLedger: {
      findUnique: async ({ where }: { where: { cycleKey: string } }) =>
        where.cycleKey === ledger.cycleKey ? { ...ledger } : null,
<<<<<<< HEAD
      updateMany: async ({ where, data }: { where: { cycleKey: string; spentCredits?: { lte: number; gte?: number } }; data: { spentCredits: { increment?: number; decrement?: number } } }) => {
=======
      updateMany: async ({ where, data }: { where: { cycleKey: string; spentCredits?: { lte: number } }; data: { spentCredits: { increment?: number; decrement?: number } } }) => {
>>>>>>> 92c9fdf4 (Phase 1 (§13-D2): record that the cancel path does not exist, and carry the admin cancel action into Phase 2)
        if (where.cycleKey !== ledger.cycleKey) return { count: 0 };
        if (data.spentCredits.increment != null) {
          const lte = where.spentCredits?.lte;
          if (lte != null && ledger.spentCredits > lte) return { count: 0 };
          ledger.spentCredits += data.spentCredits.increment;
          return { count: 1 };
        }
        if (data.spentCredits.decrement != null) {
<<<<<<< HEAD
          // Mirrors the guarded refund: never below what was actually spent.
          const gte = (where.spentCredits as { gte?: number } | undefined)?.gte;
          if (gte != null && ledger.spentCredits < gte) return { count: 0 };
=======
>>>>>>> 92c9fdf4 (Phase 1 (§13-D2): record that the cancel path does not exist, and carry the admin cancel action into Phase 2)
          ledger.spentCredits -= data.spentCredits.decrement;
          return { count: 1 };
        }
        return { count: 0 };
      },
    },
  } as unknown as PrismaClient;
  return { prisma, ledger, reveals };
}

const on = () => true;
const input = { rooftopId: "rt1", name: "Toyota of Dallas", website: "https://toyotaofdallas.com", city: "Dallas", state: "TX" };
<<<<<<< HEAD
const hit = async () => ({ kind: "revealed" as const, email: "ann@toyotaofdallas.com", name: "Ann", title: "ISM", creditsBilled: MAX_CREDITS_PER_ATTEMPT });
const empty = (creditsBilled: number, stage: string) => (async () => ({ kind: "empty", creditsBilled, stage })) as never;

test("the attempt cost is the org resolution plus the match, and the draw is that whole amount", () => {
  assert.equal(REVEAL_TOTAL_COST_CREDITS, ORG_RESOLVE_COST_CREDITS + REVEAL_COST_CREDITS);
  assert.equal(REVEAL_TOTAL_COST_CREDITS, MAX_CREDITS_PER_ATTEMPT);
  assert.equal(REVEAL_TOTAL_COST_CREDITS, 2);
});
=======
const hit = async () => ({ kind: "revealed" as const, email: "ann@toyotaofdallas.com", name: "Ann", title: "ISM" });
>>>>>>> 92c9fdf4 (Phase 1 (§13-D2): record that the cancel path does not exist, and carry the admin cancel action into Phase 2)

test("returns null (tier off) when not enabled — no key / disabled", async () => {
  const { prisma, ledger } = fake({ cycleKey: "2026-08", capCredits: 100, spentCredits: 0 });
  const r = await revealRooftopContact(input, { prisma, now: NOW, enabled: () => false, resolveAndReveal: hit as never });
  assert.equal(r, null);
  assert.equal(ledger.spentCredits, 0); // never drew
});

<<<<<<< HEAD
test("happy path: draws the full attempt, keeps it all (both stages billed), stores the reveal at that cost", async () => {
  const { prisma, ledger, reveals } = fake({ cycleKey: "2026-08", capCredits: 100, spentCredits: 0 });
  const r = await revealRooftopContact(input, { prisma, now: NOW, enabled: on, resolveAndReveal: hit as never });
  assert.equal(r?.email, "ann@toyotaofdallas.com");
  assert.equal(ledger.spentCredits, REVEAL_TOTAL_COST_CREDITS);
  assert.equal(reveals[0]!.status, "REVEALED");
  assert.equal(reveals[0]!.creditsCost, REVEAL_TOTAL_COST_CREDITS);
});

test("THE DRAW PRECEDES THE PAID CALL: the ledger already holds the full attempt when the adapter is invoked", async () => {
  // This is the invariant the API-contract batch changed. Stage 1 bills, so the
  // credit for it must be in the ledger BEFORE stage 1 runs — not drawn after,
  // not drawn only for the match.
  const { prisma, ledger } = fake({ cycleKey: "2026-08", capCredits: 100, spentCredits: 7 });
  let spentWhenCalled = -1;
  const observe = (async () => {
    spentWhenCalled = ledger.spentCredits;
    return { kind: "empty", creditsBilled: 0, stage: "no_org" };
  }) as never;
  await revealRooftopContact(input, { prisma, now: NOW, enabled: on, resolveAndReveal: observe });
  assert.equal(spentWhenCalled, 7 + REVEAL_TOTAL_COST_CREDITS, "org + match credits drawn before any Apollo call");
=======
test("happy path: draws one credit, stores the reveal, returns the contact", async () => {
  const { prisma, ledger, reveals } = fake({ cycleKey: "2026-08", capCredits: 100, spentCredits: 0 });
  const r = await revealRooftopContact(input, { prisma, now: NOW, enabled: on, resolveAndReveal: hit as never });
  assert.equal(r?.email, "ann@toyotaofdallas.com");
  assert.equal(ledger.spentCredits, 1);
  assert.equal(reveals[0]!.status, "REVEALED");
>>>>>>> 92c9fdf4 (Phase 1 (§13-D2): record that the cancel path does not exist, and carry the admin cancel action into Phase 2)
});

test("reveal-cache: a fresh prior reveal is reused with NO draw", async () => {
  const cached: RevealRow = { id: "old", rooftopId: "rt1", cycleKey: "2026-07", status: "REVEALED", email: "cached@x.com", revealedAt: new Date("2026-08-01T00:00:00Z"), contactName: "C", contactTitle: "ISM" };
  const { prisma, ledger } = fake({ cycleKey: "2026-08", capCredits: 100, spentCredits: 0 }, [cached]);
  const r = await revealRooftopContact(input, { prisma, now: NOW, enabled: on, resolveAndReveal: hit as never });
  assert.equal(r?.email, "cached@x.com");
  assert.equal(ledger.spentCredits, 0); // cache hit → no credit spent
});

test("no budget: draw refused → claim RELEASED (re-claimable), not EMPTY, fail closed", async () => {
  const { prisma, ledger, reveals } = fake({ cycleKey: "2026-08", capCredits: 100, spentCredits: 100 });
  const r = await revealRooftopContact(input, { prisma, now: NOW, enabled: on, resolveAndReveal: hit as never });
  assert.equal(r, null);
  assert.equal(ledger.spentCredits, 100); // untouched
  assert.equal(reveals.length, 0); // claim deleted (never queried) — rooftop can re-claim when budget returns
});

<<<<<<< HEAD
test("ONE credit left is not enough: the draw is the worst case, so the attempt is not started", async () => {
  // Starting stage 1 on one credit could bill it and leave nothing for the
  // match — a paid organization resolution with no reveal to show for it.
  const { prisma, ledger, reveals } = fake({ cycleKey: "2026-08", capCredits: 100, spentCredits: 99 });
  let adapterCalls = 0;
  const count = (async () => { adapterCalls++; return hit(); }) as never;
  const r = await revealRooftopContact(input, { prisma, now: NOW, enabled: on, resolveAndReveal: count });
  assert.equal(r, null);
  assert.equal(adapterCalls, 0, "no Apollo call without the full attempt in budget");
  assert.equal(ledger.spentCredits, 99);
  assert.equal(reveals.length, 0);
});

=======
>>>>>>> 92c9fdf4 (Phase 1 (§13-D2): record that the cancel path does not exist, and carry the admin cancel action into Phase 2)
test("re-claimable after budget returns: a no-budget rooftop reveals once the cap is set", async () => {
  const { prisma, ledger, reveals } = fake({ cycleKey: "2026-08", capCredits: 100, spentCredits: 100 });
  await revealRooftopContact(input, { prisma, now: NOW, enabled: on, resolveAndReveal: hit as never }); // no budget → released
  ledger.spentCredits = 0; // cap raised / budget freed
  const r = await revealRooftopContact(input, { prisma, now: NOW, enabled: on, resolveAndReveal: hit as never });
  assert.equal(r?.email, "ann@toyotaofdallas.com"); // not poisoned — reveals cleanly
<<<<<<< HEAD
  assert.equal(ledger.spentCredits, REVEAL_TOTAL_COST_CREDITS);
  assert.equal(reveals[reveals.length - 1]!.status, "REVEALED");
});

test("store failure after a paid draw: KEEPS the credits (Apollo charged), releases the claim, still returns the paid data", async () => {
  const { prisma, ledger, reveals } = fake({ cycleKey: "2026-08", capCredits: 100, spentCredits: 0 });
=======
  assert.equal(ledger.spentCredits, 1);
  assert.equal(reveals[reveals.length - 1]!.status, "REVEALED");
});

test("store failure after a paid draw: KEEPS the credit (Apollo charged), releases the claim, still returns the paid data", async () => {
  const { prisma, ledger, reveals } = fake({ cycleKey: "2026-08", capCredits: 100, spentCredits: 0 });
  // Make the REVEALED store update throw once.
>>>>>>> 92c9fdf4 (Phase 1 (§13-D2): record that the cancel path does not exist, and carry the admin cancel action into Phase 2)
  const realUpdate = (prisma as unknown as { apolloReveal: { update: (a: unknown) => Promise<unknown> } }).apolloReveal.update;
  (prisma as unknown as { apolloReveal: { update: (a: { data: Record<string, unknown> }) => Promise<unknown> } }).apolloReveal.update = async (a) => {
    if (a.data.status === "REVEALED") throw new Error("db down");
    return realUpdate(a);
  };
  const r = await revealRooftopContact(input, { prisma, now: NOW, enabled: on, resolveAndReveal: hit as never });
  assert.equal(r?.email, "ann@toyotaofdallas.com"); // paid data still returned
<<<<<<< HEAD
  assert.equal(ledger.spentCredits, REVEAL_TOTAL_COST_CREDITS); // KEPT — refunding would undercount
  assert.equal(reveals.length, 0); // claim released so the rooftop can re-resolve later
});

// ─── stage-1 accounting — the invariant that changed ─────────────────────────

test("a stage-1 clean miss (documented free) refunds the WHOLE draw", async () => {
  const { prisma, ledger, reveals } = fake({ cycleKey: "2026-08", capCredits: 100, spentCredits: 5 });
  const r = await revealRooftopContact(input, { prisma, now: NOW, enabled: on, resolveAndReveal: empty(0, "no_org") });
  assert.equal(r, null);
  assert.equal(ledger.spentCredits, 5); // drew 2, refunded 2
  assert.equal(reveals[0]!.status, "EMPTY");
  assert.equal(reveals[0]!.creditsCost, 0);
  assert.equal(reveals[0]!.emptyStage, "no_org");
});

test("a stage-1 miss that Apollo BILLED is NOT refunded: the org credit stays spent", async () => {
  // mixed_companies/search charges per request returning any result, whether
  // or not the result was usable. The ledger must keep that credit.
  const { prisma, ledger, reveals } = fake({ cycleKey: "2026-08", capCredits: 100, spentCredits: 5 });
  const r = await revealRooftopContact(input, { prisma, now: NOW, enabled: on, resolveAndReveal: empty(ORG_RESOLVE_COST_CREDITS, "no_org") });
  assert.equal(r, null);
  assert.equal(ledger.spentCredits, 5 + ORG_RESOLVE_COST_CREDITS); // drew 2, refunded only the unreached match
  assert.equal(reveals[0]!.creditsCost, ORG_RESOLVE_COST_CREDITS);
  assert.equal(reveals[0]!.emptyStage, "no_org");
});

test("a stage-1 ERROR keeps the org credit (unknowable → charged), refunds only the match", async () => {
  const { prisma, ledger, reveals } = fake({ cycleKey: "2026-08", capCredits: 100, spentCredits: 5 });
  await revealRooftopContact(input, { prisma, now: NOW, enabled: on, resolveAndReveal: empty(ORG_RESOLVE_COST_CREDITS, "org_error") });
  assert.equal(ledger.spentCredits, 5 + ORG_RESOLVE_COST_CREDITS);
  assert.equal(reveals[0]!.creditsCost, ORG_RESOLVE_COST_CREDITS);
  assert.equal(reveals[0]!.emptyStage, "org_error");
});

test("org found but nothing to reveal (no_people / no_match): the org credit is kept, the match credit returns", async () => {
  for (const stage of ["no_people", "people_search_error", "no_match"] as const) {
    const { prisma, ledger, reveals } = fake({ cycleKey: "2026-08", capCredits: 100, spentCredits: 5 });
    await revealRooftopContact(input, { prisma, now: NOW, enabled: on, resolveAndReveal: empty(ORG_RESOLVE_COST_CREDITS, stage) });
    assert.equal(ledger.spentCredits, 5 + ORG_RESOLVE_COST_CREDITS, stage);
    assert.equal(reveals[0]!.creditsCost, ORG_RESOLVE_COST_CREDITS, stage);
    assert.equal(reveals[0]!.emptyStage, stage);
  }
});

test("matched but no email: BOTH credits are kept — Apollo charged for the org and the match", async () => {
  const { prisma, ledger, reveals } = fake({ cycleKey: "2026-08", capCredits: 100, spentCredits: 5 });
  const r = await revealRooftopContact(input, { prisma, now: NOW, enabled: on, resolveAndReveal: empty(MAX_CREDITS_PER_ATTEMPT, "match_no_email") });
  assert.equal(r, null);
  assert.equal(ledger.spentCredits, 5 + MAX_CREDITS_PER_ATTEMPT); // nothing refunded
  assert.equal(reveals[0]!.status, "EMPTY");
  assert.equal(reveals[0]!.creditsCost, MAX_CREDITS_PER_ATTEMPT);
  assert.equal(reveals[0]!.emptyStage, "match_no_email");
});

test("every empty stage lands on the row verbatim, and cost follows creditsBilled alone", async () => {
  for (const [stage, creditsBilled] of [
    ["disabled", 0],
    ["no_org", 0],
    ["no_org", ORG_RESOLVE_COST_CREDITS],
    ["org_error", ORG_RESOLVE_COST_CREDITS],
    ["no_people", ORG_RESOLVE_COST_CREDITS],
    ["people_search_error", ORG_RESOLVE_COST_CREDITS],
    ["no_match", ORG_RESOLVE_COST_CREDITS],
    ["match_no_email", MAX_CREDITS_PER_ATTEMPT],
    ["match_error", MAX_CREDITS_PER_ATTEMPT],
  ] as const) {
    const { prisma, ledger, reveals } = fake({ cycleKey: "2026-08", capCredits: 100, spentCredits: 0 });
    const r = await revealRooftopContact(input, { prisma, now: NOW, enabled: on, resolveAndReveal: empty(creditsBilled, stage) });
    assert.equal(r, null, `${stage} must not return a contact`);
    assert.equal(reveals[0]!.status, "EMPTY", stage);
    assert.equal(reveals[0]!.emptyStage, stage, `${stage} must be recorded verbatim`);
    assert.equal(reveals[0]!.creditsCost, creditsBilled, `${stage} cost must follow creditsBilled`);
    assert.equal(ledger.spentCredits, creditsBilled, `${stage} ledger must keep exactly creditsBilled`);
  }
});

test("a creditsBilled above the draw is clamped to the draw — a refund can never go negative", async () => {
  const { prisma, ledger, reveals } = fake({ cycleKey: "2026-08", capCredits: 100, spentCredits: 0 });
  await revealRooftopContact(input, { prisma, now: NOW, enabled: on, resolveAndReveal: empty(99, "match_error") });
  assert.equal(ledger.spentCredits, REVEAL_TOTAL_COST_CREDITS);
  assert.equal(reveals[0]!.creditsCost, REVEAL_TOTAL_COST_CREDITS);
});

test("adapter THROWS: recorded as match_error and the WHOLE draw is kept (cannot know which paid calls ran)", async () => {
=======
  assert.equal(ledger.spentCredits, 1); // credit KEPT — the reveal really billed; refunding would undercount
  assert.equal(reveals.length, 0); // claim released so the rooftop can re-resolve later
});

test("adapter miss NOT billed (no match): credit is refunded and the claim marked EMPTY", async () => {
  const { prisma, ledger, reveals } = fake({ cycleKey: "2026-08", capCredits: 100, spentCredits: 5 });
  const miss = (async () => ({ kind: "empty", billed: false, stage: "no_match" })) as never;
  const r = await revealRooftopContact(input, { prisma, now: NOW, enabled: on, resolveAndReveal: miss });
  assert.equal(r, null);
  assert.equal(ledger.spentCredits, 5); // drew 1 then refunded 1 (Apollo not charged)
  assert.equal(reveals[0]!.status, "EMPTY");
  assert.equal(reveals[0]!.creditsCost, 0);
  assert.equal(reveals[0]!.emptyStage, "no_match"); // WHICH stage produced it
});

test("adapter miss BILLED (matched, no email): credit is KEPT, claim EMPTY at cost 1", async () => {
  const { prisma, ledger, reveals } = fake({ cycleKey: "2026-08", capCredits: 100, spentCredits: 5 });
  const billedMiss = (async () => ({ kind: "empty", billed: true, stage: "match_no_email" })) as never;
  const r = await revealRooftopContact(input, { prisma, now: NOW, enabled: on, resolveAndReveal: billedMiss });
  assert.equal(r, null);
  assert.equal(ledger.spentCredits, 6); // drew 1, NOT refunded — Apollo charged for the match
  assert.equal(reveals[0]!.status, "EMPTY");
  assert.equal(reveals[0]!.creditsCost, 1);
  assert.equal(reveals[0]!.emptyStage, "match_no_email");
});

// The whole point of the column: a free-stage empty and a paid-stage empty are
// the same EMPTY row today. These two prove the row now says which one it was,
// while credits_cost keeps following `billed` alone.
test("every empty stage lands on the row verbatim, and cost still follows billed alone", async () => {
  for (const [stage, billed] of [
    ["disabled", false],
    ["no_org", false],
    ["no_people", false],
    ["free_stage_error", false],
    ["no_match", false],
    ["match_no_email", true],
    ["match_error", true],
  ] as const) {
    const { prisma, ledger, reveals } = fake({ cycleKey: "2026-08", capCredits: 100, spentCredits: 0 });
    const miss = (async () => ({ kind: "empty", billed, stage })) as never;
    const r = await revealRooftopContact(input, { prisma, now: NOW, enabled: on, resolveAndReveal: miss });
    assert.equal(r, null, `${stage} must not return a contact`);
    assert.equal(reveals[0]!.status, "EMPTY", stage);
    assert.equal(reveals[0]!.emptyStage, stage, `${stage} must be recorded verbatim`);
    assert.equal(reveals[0]!.creditsCost, billed ? 1 : 0, `${stage} cost must follow billed`);
    assert.equal(ledger.spentCredits, billed ? 1 : 0, `${stage} ledger must follow billed`);
  }
});

test("adapter THROWS: recorded as match_error and the credit is KEPT (cannot know if charged)", async () => {
>>>>>>> 92c9fdf4 (Phase 1 (§13-D2): record that the cancel path does not exist, and carry the admin cancel action into Phase 2)
  const { prisma, ledger, reveals } = fake({ cycleKey: "2026-08", capCredits: 100, spentCredits: 5 });
  const boom = (async () => { throw new Error("adapter exploded"); }) as never;
  const r = await revealRooftopContact(input, { prisma, now: NOW, enabled: on, resolveAndReveal: boom });
  assert.equal(r, null);
<<<<<<< HEAD
  assert.equal(ledger.spentCredits, 5 + REVEAL_TOTAL_COST_CREDITS); // conservative: assume both charged
  assert.equal(reveals[0]!.status, "EMPTY");
  assert.equal(reveals[0]!.creditsCost, REVEAL_TOTAL_COST_CREDITS);
  assert.equal(reveals[0]!.emptyStage, "match_error");
});

test("the rooftop id reaches the adapter, so the funnel logs are keyed by it", async () => {
=======
  assert.equal(ledger.spentCredits, 6); // conservative: assume Apollo charged
  assert.equal(reveals[0]!.status, "EMPTY");
  assert.equal(reveals[0]!.creditsCost, 1);
  assert.equal(reveals[0]!.emptyStage, "match_error");
});

test("the rooftop id reaches the adapter, so the free-stage funnel logs are keyed by it", async () => {
>>>>>>> 92c9fdf4 (Phase 1 (§13-D2): record that the cancel path does not exist, and carry the admin cancel action into Phase 2)
  const { prisma } = fake({ cycleKey: "2026-08", capCredits: 100, spentCredits: 0 });
  const seen: Array<Record<string, unknown>> = [];
  const capture = (async (adapterInput: Record<string, unknown>) => {
    seen.push(adapterInput);
<<<<<<< HEAD
    return { kind: "empty", creditsBilled: 0, stage: "no_org" };
=======
    return { kind: "empty", billed: false, stage: "no_org" };
>>>>>>> 92c9fdf4 (Phase 1 (§13-D2): record that the cancel path does not exist, and carry the admin cancel action into Phase 2)
  }) as never;
  await revealRooftopContact(input, { prisma, now: NOW, enabled: on, resolveAndReveal: capture });
  assert.equal(seen.length, 1);
  assert.equal(seen[0]!.rooftopId, "rt1");
  // ...and nothing else the adapter is given changed. rooftopId is additive:
  // it feeds the logs, never an Apollo request.
  assert.deepEqual(seen[0], {
    rooftopId: "rt1",
    name: "Toyota of Dallas",
    website: "https://toyotaofdallas.com",
    city: "Dallas",
    state: "TX",
  });
});

<<<<<<< HEAD
test("END-TO-END: a matched-but-emailless reveal through the REAL adapter keeps both credits", async () => {
  const { prisma, ledger, reveals } = fake({ cycleKey: "2026-08", capCredits: 100, spentCredits: 0 });
  const matchedNoEmail: ApolloClient = {
    resolveOrganization: async () => ({ org: { id: "org1", domain: "toyotaofdallas.com" }, billed: true, resolver: "organizations/enrich" }),
=======
test("END-TO-END: a matched-but-emailless reveal through the REAL adapter keeps the credit", async () => {
  // Thread the real apolloResolveAndReveal (with a fake ApolloClient that matches a
  // person but returns no email) through revealRooftopContact — proving the whole
  // chain keeps the credit (Apollo charged) rather than refunding.
  const { prisma, ledger, reveals } = fake({ cycleKey: "2026-08", capCredits: 100, spentCredits: 0 });
  const matchedNoEmail: ApolloClient = {
    organizationsLookup: async () => ({ id: "org1", domain: "toyotaofdallas.com" }),
>>>>>>> 92c9fdf4 (Phase 1 (§13-D2): record that the cancel path does not exist, and carry the admin cancel action into Phase 2)
    peopleSearch: async () => [{ id: "p1", name: "Ann", title: "Internet Sales Manager", hasEmail: false }],
    peopleMatch: async () => ({ email: null, name: "Ann", title: "ISM" }), // matched, no email → billed
  };
  const realAdapter = ((rin: Parameters<typeof apolloResolveAndReveal>[0]) =>
    apolloResolveAndReveal(rin, { client: matchedNoEmail })) as typeof apolloResolveAndReveal;
  const r = await revealRooftopContact(input, { prisma, now: NOW, enabled: on, resolveAndReveal: realAdapter });
  assert.equal(r, null);
<<<<<<< HEAD
  assert.equal(ledger.spentCredits, MAX_CREDITS_PER_ATTEMPT); // org + match, never refunded
  assert.equal(reveals[0]!.status, "EMPTY");
  assert.equal(reveals[0]!.creditsCost, MAX_CREDITS_PER_ATTEMPT);
  assert.equal(reveals[0]!.emptyStage, "match_no_email"); // the real adapter named the stage
});

test("END-TO-END: a stage-1 free miss through the REAL adapter refunds everything", async () => {
  const { prisma, ledger, reveals } = fake({ cycleKey: "2026-08", capCredits: 100, spentCredits: 3 });
  const notFound: ApolloClient = {
    resolveOrganization: async () => ({ org: null, billed: false, resolver: "organizations/enrich" }),
    peopleSearch: async () => { throw new Error("must not be reached"); },
    peopleMatch: async () => { throw new Error("must not be reached"); },
  };
  const realAdapter = ((rin: Parameters<typeof apolloResolveAndReveal>[0]) =>
    apolloResolveAndReveal(rin, { client: notFound })) as typeof apolloResolveAndReveal;
  await revealRooftopContact(input, { prisma, now: NOW, enabled: on, resolveAndReveal: realAdapter });
  assert.equal(ledger.spentCredits, 3);
  assert.equal(reveals[0]!.creditsCost, 0);
  assert.equal(reveals[0]!.emptyStage, "no_org");
});

test("idempotency: a concurrent claim (unique conflict) does not double-draw", async () => {
=======
  assert.equal(ledger.spentCredits, 1); // charged + kept (never refunded) end-to-end
  assert.equal(reveals[0]!.status, "EMPTY");
  assert.equal(reveals[0]!.creditsCost, 1);
  assert.equal(reveals[0]!.emptyStage, "match_no_email"); // the real adapter named the stage
});

test("idempotency: a concurrent claim (unique conflict) does not double-draw", async () => {
  // A PENDING claim for this rooftop+cycle already exists (another worker).
>>>>>>> 92c9fdf4 (Phase 1 (§13-D2): record that the cancel path does not exist, and carry the admin cancel action into Phase 2)
  const pending: RevealRow = { id: "p", rooftopId: "rt1", cycleKey: "2026-08", status: "PENDING", email: null, revealedAt: NOW };
  const { prisma, ledger } = fake({ cycleKey: "2026-08", capCredits: 100, spentCredits: 0 }, [pending]);
  const r = await revealRooftopContact(input, { prisma, now: NOW, enabled: on, resolveAndReveal: hit as never });
  assert.equal(r, null); // yields to the holder
  assert.equal(ledger.spentCredits, 0); // never drew — no double-draw
});
