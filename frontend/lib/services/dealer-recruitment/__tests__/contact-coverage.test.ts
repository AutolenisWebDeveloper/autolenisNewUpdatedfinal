// Admin dealer contact-coverage census — the read-only ops readout behind
// /admin/dealer-outreach/coverage. Injected fake prisma proves: the counts map
// to the SAME predicates the backfill actually uses (so the readout can't drift
// from what the job will do), the derived gap figures, and honest reporting when
// Apollo is off / no ledger row exists.
//   npx tsx --test lib/services/dealer-recruitment/__tests__/contact-coverage.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import type { PrismaClient } from "@prisma/client";
import { getContactCoverage, type CoverageDeps } from "../contact-coverage.service";
import { SEND_SAFE_STATUSES } from "../contact-resolution.service";

const NOW = new Date("2026-08-10T12:00:00Z");

interface Counts {
  dealersTotal: number;
  dealersWithRooftop: number;
  dealersPending: number;
  prospectsTotal: number;
  prospectsWithRooftop: number;
  prospectsPending: number;
  rooftopsTotal: number;
  rooftopsWithContact: number;
  rooftopsGap: number;
  profilesTotal: number;
  profilesSendSafe: number;
}

interface Recorded {
  sendSafeStatuses: string[][];
  prospectExcluded: string[][];
  revealCycleKeys: string[];
}

function fakePrisma(
  c: Counts,
  opts: {
    ledger?: { capCredits: number; spentCredits: number } | null;
    reveals?: Array<{ status: string; count: number }>;
  } = {},
): { prisma: PrismaClient; rec: Recorded } {
  const rec: Recorded = { sendSafeStatuses: [], prospectExcluded: [], revealCycleKeys: [] };
  type W = Record<string, unknown> | undefined;
  const has = (w: W, k: string) => w != null && Object.prototype.hasOwnProperty.call(w, k);

  const prisma = {
    dealer: {
      count: async ({ where }: { where?: W } = {}) => {
        if (has(where, "rooftopId") && where!.rooftopId === null) return c.dealersPending;
        if (has(where, "rooftopId")) return c.dealersWithRooftop;
        return c.dealersTotal;
      },
    },
    dealerProspect: {
      count: async ({ where }: { where?: W } = {}) => {
        if (has(where, "status")) {
          const st = where!.status as { notIn?: string[] };
          rec.prospectExcluded.push(st.notIn ?? []);
          return c.prospectsPending;
        }
        if (has(where, "rooftopId")) return c.prospectsWithRooftop;
        return c.prospectsTotal;
      },
    },
    dealerRooftop: {
      count: async ({ where }: { where?: W } = {}) => {
        const contacts = where?.contacts as
          | { some?: { emailVerificationStatus?: { in?: string[] } }; none?: { emailVerificationStatus?: { in?: string[] } } }
          | undefined;
        if (contacts?.some) {
          rec.sendSafeStatuses.push(contacts.some.emailVerificationStatus?.in ?? []);
          return c.rooftopsWithContact;
        }
        if (contacts?.none) {
          rec.sendSafeStatuses.push(contacts.none.emailVerificationStatus?.in ?? []);
          return c.rooftopsGap;
        }
        return c.rooftopsTotal;
      },
    },
    dealerContactProfile: {
      count: async ({ where }: { where?: W } = {}) => {
        if (has(where, "emailVerificationStatus")) {
          const s = where!.emailVerificationStatus as { in?: string[] };
          rec.sendSafeStatuses.push(s.in ?? []);
          return c.profilesSendSafe;
        }
        return c.profilesTotal;
      },
    },
    apolloCreditLedger: {
      findUnique: async () => opts.ledger ?? null,
    },
    apolloReveal: {
      groupBy: async ({ where }: { where: { cycleKey: string } }) => {
        rec.revealCycleKeys.push(where.cycleKey);
        return (opts.reveals ?? []).map((r) => ({ status: r.status, _count: { _all: r.count } }));
      },
    },
  } as unknown as PrismaClient;
  return { prisma, rec };
}

const COUNTS: Counts = {
  dealersTotal: 10,
  dealersWithRooftop: 4,
  dealersPending: 6,
  prospectsTotal: 1532,
  prospectsWithRooftop: 500,
  prospectsPending: 1000,
  rooftopsTotal: 300,
  rooftopsWithContact: 120,
  rooftopsGap: 180,
  profilesTotal: 140,
  profilesSendSafe: 120,
};

const deps = (prisma: PrismaClient, over: Partial<CoverageDeps> = {}): Partial<CoverageDeps> => ({
  prisma,
  now: NOW,
  enabled: () => true,
  remaining: (async () => 750) as CoverageDeps["remaining"],
  ...over,
});

test("reports the full population census with derived coverage figures", async () => {
  const { prisma } = fakePrisma(COUNTS, {
    ledger: { capCredits: 2000, spentCredits: 250 },
    reveals: [{ status: "REVEALED", count: 30 }, { status: "EMPTY", count: 12 }, { status: "PENDING", count: 1 }],
  });
  const r = await getContactCoverage(deps(prisma));

  assert.deepEqual(r.dealers, { total: 10, withRooftop: 4, pendingResolution: 6 });
  assert.deepEqual(r.prospects, { total: 1532, withRooftop: 500, pendingResolution: 1000 });
  assert.deepEqual(r.rooftops, { total: 300, withSendSafeContact: 120, contactGap: 180 });
  assert.deepEqual(r.contactProfiles, { total: 140, sendSafe: 120 });

  assert.equal(r.apollo.enabled, true);
  assert.equal(r.apollo.cycleKey, "2026-08");
  assert.equal(r.apollo.capCredits, 2000);
  assert.equal(r.apollo.spentCredits, 250);
  assert.equal(r.apollo.backfillRemaining, 750);
  assert.equal(r.apollo.revealedThisCycle, 30);
  assert.equal(r.apollo.emptyThisCycle, 12);
  assert.equal(r.apollo.revealsThisCycle, 43, "all statuses counted, including PENDING claims");
});

test("send-safe filters use the shared SEND_SAFE_STATUSES (no drift from the waterfall)", async () => {
  const { prisma, rec } = fakePrisma(COUNTS);
  await getContactCoverage(deps(prisma));
  assert.ok(rec.sendSafeStatuses.length >= 3, "rooftop some/none + profile filters all applied");
  for (const used of rec.sendSafeStatuses) {
    assert.deepEqual(used, [...SEND_SAFE_STATUSES]);
  }
});

test("prospect pending-resolution excludes DEAD and ONBOARDED (mirrors the backfill queue)", async () => {
  const { prisma, rec } = fakePrisma(COUNTS);
  await getContactCoverage(deps(prisma));
  assert.equal(rec.prospectExcluded.length, 1);
  assert.deepEqual([...rec.prospectExcluded[0]].sort(), ["DEAD", "ONBOARDED"]);
});

test("reveal stats are scoped to the current billing cycle", async () => {
  const { prisma, rec } = fakePrisma(COUNTS);
  await getContactCoverage(deps(prisma));
  assert.deepEqual(rec.revealCycleKeys, ["2026-08"]);
});

test("no ledger row → zeroed budget, never fabricated", async () => {
  const { prisma } = fakePrisma(COUNTS, { ledger: null });
  const r = await getContactCoverage(deps(prisma, { remaining: (async () => 0) as CoverageDeps["remaining"] }));
  assert.equal(r.apollo.capCredits, 0);
  assert.equal(r.apollo.spentCredits, 0);
  assert.equal(r.apollo.backfillRemaining, 0);
});

test("Apollo disabled is reported as such, and the census is still returned", async () => {
  const { prisma } = fakePrisma(COUNTS, { ledger: { capCredits: 2000, spentCredits: 0 } });
  const r = await getContactCoverage(deps(prisma, { enabled: () => false }));
  assert.equal(r.apollo.enabled, false);
  assert.equal(r.rooftops.contactGap, 180, "gap is still visible while the paid tier is off");
});

test("empty database reports zeros rather than throwing", async () => {
  const zero: Counts = {
    dealersTotal: 0, dealersWithRooftop: 0, dealersPending: 0,
    prospectsTotal: 0, prospectsWithRooftop: 0, prospectsPending: 0,
    rooftopsTotal: 0, rooftopsWithContact: 0, rooftopsGap: 0,
    profilesTotal: 0, profilesSendSafe: 0,
  };
  const { prisma } = fakePrisma(zero, { ledger: null, reveals: [] });
  const r = await getContactCoverage(deps(prisma, { remaining: (async () => 0) as CoverageDeps["remaining"] }));
  assert.equal(r.rooftops.total, 0);
  assert.equal(r.apollo.revealsThisCycle, 0);
});
