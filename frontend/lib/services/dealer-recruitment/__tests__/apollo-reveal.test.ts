// Block B / Apollo — gated reveal orchestration: cache → claim → atomic draw →
// adapter → store, with the credit ledger. Injected fake prisma models the
// unique claim + the conditional ledger draw exactly, so the money guarantees
// (no double-draw, refund on miss, off-until-enabled) are provable offline.
//   npx tsx --test lib/services/dealer-recruitment/__tests__/apollo-reveal.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import type { PrismaClient } from "@prisma/client";
import { revealRooftopContact } from "../apollo-reveal.service";
import { apolloResolveAndReveal, type ApolloClient } from "../apollo.service";

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
      updateMany: async ({ where, data }: { where: { cycleKey: string; spentCredits?: { lte: number } }; data: { spentCredits: { increment?: number; decrement?: number } } }) => {
        if (where.cycleKey !== ledger.cycleKey) return { count: 0 };
        if (data.spentCredits.increment != null) {
          const lte = where.spentCredits?.lte;
          if (lte != null && ledger.spentCredits > lte) return { count: 0 };
          ledger.spentCredits += data.spentCredits.increment;
          return { count: 1 };
        }
        if (data.spentCredits.decrement != null) {
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
const hit = async () => ({ kind: "revealed" as const, email: "ann@toyotaofdallas.com", name: "Ann", title: "ISM" });

test("returns null (tier off) when not enabled — no key / disabled", async () => {
  const { prisma, ledger } = fake({ cycleKey: "2026-08", capCredits: 100, spentCredits: 0 });
  const r = await revealRooftopContact(input, { prisma, now: NOW, enabled: () => false, resolveAndReveal: hit as never });
  assert.equal(r, null);
  assert.equal(ledger.spentCredits, 0); // never drew
});

test("happy path: draws one credit, stores the reveal, returns the contact", async () => {
  const { prisma, ledger, reveals } = fake({ cycleKey: "2026-08", capCredits: 100, spentCredits: 0 });
  const r = await revealRooftopContact(input, { prisma, now: NOW, enabled: on, resolveAndReveal: hit as never });
  assert.equal(r?.email, "ann@toyotaofdallas.com");
  assert.equal(ledger.spentCredits, 1);
  assert.equal(reveals[0]!.status, "REVEALED");
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

test("re-claimable after budget returns: a no-budget rooftop reveals once the cap is set", async () => {
  const { prisma, ledger, reveals } = fake({ cycleKey: "2026-08", capCredits: 100, spentCredits: 100 });
  await revealRooftopContact(input, { prisma, now: NOW, enabled: on, resolveAndReveal: hit as never }); // no budget → released
  ledger.spentCredits = 0; // cap raised / budget freed
  const r = await revealRooftopContact(input, { prisma, now: NOW, enabled: on, resolveAndReveal: hit as never });
  assert.equal(r?.email, "ann@toyotaofdallas.com"); // not poisoned — reveals cleanly
  assert.equal(ledger.spentCredits, 1);
  assert.equal(reveals[reveals.length - 1]!.status, "REVEALED");
});

test("store failure after a paid draw: KEEPS the credit (Apollo charged), releases the claim, still returns the paid data", async () => {
  const { prisma, ledger, reveals } = fake({ cycleKey: "2026-08", capCredits: 100, spentCredits: 0 });
  // Make the REVEALED store update throw once.
  const realUpdate = (prisma as unknown as { apolloReveal: { update: (a: unknown) => Promise<unknown> } }).apolloReveal.update;
  (prisma as unknown as { apolloReveal: { update: (a: { data: Record<string, unknown> }) => Promise<unknown> } }).apolloReveal.update = async (a) => {
    if (a.data.status === "REVEALED") throw new Error("db down");
    return realUpdate(a);
  };
  const r = await revealRooftopContact(input, { prisma, now: NOW, enabled: on, resolveAndReveal: hit as never });
  assert.equal(r?.email, "ann@toyotaofdallas.com"); // paid data still returned
  assert.equal(ledger.spentCredits, 1); // credit KEPT — the reveal really billed; refunding would undercount
  assert.equal(reveals.length, 0); // claim released so the rooftop can re-resolve later
});

test("adapter miss NOT billed (no match): credit is refunded and the claim marked EMPTY", async () => {
  const { prisma, ledger, reveals } = fake({ cycleKey: "2026-08", capCredits: 100, spentCredits: 5 });
  const miss = (async () => ({ kind: "empty", billed: false })) as never;
  const r = await revealRooftopContact(input, { prisma, now: NOW, enabled: on, resolveAndReveal: miss });
  assert.equal(r, null);
  assert.equal(ledger.spentCredits, 5); // drew 1 then refunded 1 (Apollo not charged)
  assert.equal(reveals[0]!.status, "EMPTY");
  assert.equal(reveals[0]!.creditsCost, 0);
});

test("adapter miss BILLED (matched, no email): credit is KEPT, claim EMPTY at cost 1", async () => {
  const { prisma, ledger, reveals } = fake({ cycleKey: "2026-08", capCredits: 100, spentCredits: 5 });
  const billedMiss = (async () => ({ kind: "empty", billed: true })) as never;
  const r = await revealRooftopContact(input, { prisma, now: NOW, enabled: on, resolveAndReveal: billedMiss });
  assert.equal(r, null);
  assert.equal(ledger.spentCredits, 6); // drew 1, NOT refunded — Apollo charged for the match
  assert.equal(reveals[0]!.status, "EMPTY");
  assert.equal(reveals[0]!.creditsCost, 1);
});

test("END-TO-END: a matched-but-emailless reveal through the REAL adapter keeps the credit", async () => {
  // Thread the real apolloResolveAndReveal (with a fake ApolloClient that matches a
  // person but returns no email) through revealRooftopContact — proving the whole
  // chain keeps the credit (Apollo charged) rather than refunding.
  const { prisma, ledger, reveals } = fake({ cycleKey: "2026-08", capCredits: 100, spentCredits: 0 });
  const matchedNoEmail: ApolloClient = {
    organizationsLookup: async () => ({ id: "org1", domain: "toyotaofdallas.com" }),
    peopleSearch: async () => [{ id: "p1", name: "Ann", title: "Internet Sales Manager", hasEmail: false }],
    peopleMatch: async () => ({ email: null, name: "Ann", title: "ISM" }), // matched, no email → billed
  };
  const realAdapter = ((rin: Parameters<typeof apolloResolveAndReveal>[0]) =>
    apolloResolveAndReveal(rin, { client: matchedNoEmail })) as typeof apolloResolveAndReveal;
  const r = await revealRooftopContact(input, { prisma, now: NOW, enabled: on, resolveAndReveal: realAdapter });
  assert.equal(r, null);
  assert.equal(ledger.spentCredits, 1); // charged + kept (never refunded) end-to-end
  assert.equal(reveals[0]!.status, "EMPTY");
  assert.equal(reveals[0]!.creditsCost, 1);
});

test("idempotency: a concurrent claim (unique conflict) does not double-draw", async () => {
  // A PENDING claim for this rooftop+cycle already exists (another worker).
  const pending: RevealRow = { id: "p", rooftopId: "rt1", cycleKey: "2026-08", status: "PENDING", email: null, revealedAt: NOW };
  const { prisma, ledger } = fake({ cycleKey: "2026-08", capCredits: 100, spentCredits: 0 }, [pending]);
  const r = await revealRooftopContact(input, { prisma, now: NOW, enabled: on, resolveAndReveal: hit as never });
  assert.equal(r, null); // yields to the holder
  assert.equal(ledger.spentCredits, 0); // never drew — no double-draw
});
