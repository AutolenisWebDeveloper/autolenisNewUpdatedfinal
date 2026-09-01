// Dealer contact-coverage census — the READ-ONLY ops readout behind
// /admin/dealer-outreach/coverage.
//
// Answers one question for the owner: is the AutoLenis dealer population
// actually covered by a send-safe contact, and what would the backfill (B′) do
// next? Every figure is counted with the SAME predicate the backfill itself
// uses, so the readout can never drift from what the job will really process:
//
//   dealers/prospects.pendingResolution → exactly Phase 0's resolution queue
//     (registered dealers and non-DEAD/ONBOARDED prospects with no rooftop yet).
//   rooftops.contactGap                 → exactly Phase 1's candidate predicate
//     (rooftops with NO send-safe contact profile). This is the standing pool,
//     not one run's workload: a run additionally skips rooftops already
//     attempted this cycle and stops at the budget/iteration cap.
//
// Send-safe is the shared SEND_SAFE_STATUSES ({VERIFIED, ROLE_DERIVED}) — the
// same constant the contact waterfall gates sending on, imported rather than
// restated so the two can't diverge.
//
// Pure counts + one groupBy: no writes, no Apollo calls, no credit spend. This
// module never enables anything; it only reports. Errors propagate to the caller
// so the admin surface can show a real error instead of fabricated zeros.

import type { PrismaClient } from "@prisma/client";
import { prisma as defaultPrisma } from "@/lib/prisma";
import { SEND_SAFE_STATUSES } from "./contact-resolution.service";
import { PROSPECT_RESOLVE_EXCLUDE } from "./dealer-contact-backfill.service";
import { apolloEnabled } from "./apollo.service";
import { remainingCredits, cycleKeyFor } from "./apollo-credit-ledger.service";

export interface PopulationCoverage {
  total: number;
  withRooftop: number;
  /** Records Phase 0 would resolve on its next run. */
  pendingResolution: number;
}

export interface RooftopCoverage {
  total: number;
  withSendSafeContact: number;
  /** Standing paid-reveal candidate pool (no send-safe contact). Not one run's
   *  workload — a run also skips this cycle's attempts and respects the cap. */
  contactGap: number;
}

export interface ApolloCoverage {
  enabled: boolean;
  cycleKey: string;
  capCredits: number;
  spentCredits: number;
  /** Credits backfill may still draw (cap − spent − live reserve floor). */
  backfillRemaining: number;
  revealsThisCycle: number;
  revealedThisCycle: number;
  emptyThisCycle: number;
}

export interface ContactCoverage {
  dealers: PopulationCoverage;
  prospects: PopulationCoverage;
  rooftops: RooftopCoverage;
  contactProfiles: { total: number; sendSafe: number };
  apollo: ApolloCoverage;
  generatedAt: Date;
}

export interface CoverageDeps {
  prisma: PrismaClient;
  now: Date;
  enabled: () => boolean;
  remaining: typeof remainingCredits;
}

// The send-safe contact predicate, shared by the rooftop some/none counts so
// "has a contact" and "is a gap" are exact complements of one another. A factory
// (not a shared literal) so each call site gets its own mutable-typed filter.
const sendSafeContact = () => ({
  email: { not: null },
  emailVerificationStatus: { in: [...SEND_SAFE_STATUSES] },
});

export async function getContactCoverage(deps?: Partial<CoverageDeps>): Promise<ContactCoverage> {
  const prisma = deps?.prisma ?? defaultPrisma;
  const now = deps?.now ?? new Date();
  const enabled = deps?.enabled ?? apolloEnabled;
  const remaining = deps?.remaining ?? remainingCredits;

  const cycleKey = cycleKeyFor(now);

  const [
    dealersTotal,
    dealersWithRooftop,
    dealersPending,
    prospectsTotal,
    prospectsWithRooftop,
    prospectsPending,
    rooftopsTotal,
    rooftopsWithContact,
    rooftopsGap,
    profilesTotal,
    profilesSendSafe,
    ledger,
    revealGroups,
    backfillRemaining,
  ] = await Promise.all([
    // Registered dealers — real ones only; the system placeholder is not a
    // dealership and must never inflate coverage (mirrors the backfill).
    prisma.dealer.count({ where: { isSystemPlaceholder: false } }),
    prisma.dealer.count({ where: { isSystemPlaceholder: false, rooftopId: { not: null } } }),
    prisma.dealer.count({ where: { isSystemPlaceholder: false, rooftopId: null } }),

    prisma.dealerProspect.count(),
    prisma.dealerProspect.count({ where: { rooftopId: { not: null } } }),
    prisma.dealerProspect.count({
      where: { rooftopId: null, status: { notIn: [...PROSPECT_RESOLVE_EXCLUDE] } },
    }),

    prisma.dealerRooftop.count(),
    prisma.dealerRooftop.count({ where: { contacts: { some: sendSafeContact() } } }),
    prisma.dealerRooftop.count({ where: { contacts: { none: sendSafeContact() } } }),

    prisma.dealerContactProfile.count(),
    prisma.dealerContactProfile.count({ where: sendSafeContact() }),

    prisma.apolloCreditLedger.findUnique({ where: { cycleKey } }),
    prisma.apolloReveal.groupBy({ by: ["status"], where: { cycleKey }, _count: { _all: true } }),
    remaining(cycleKey, "backfill", now, { prisma }),
  ]);

  let revealsThisCycle = 0;
  let revealedThisCycle = 0;
  let emptyThisCycle = 0;
  for (const g of revealGroups as Array<{ status: string; _count: { _all: number } }>) {
    const n = g._count._all;
    revealsThisCycle += n; // includes PENDING claims — the honest total
    if (g.status === "REVEALED") revealedThisCycle += n;
    else if (g.status === "EMPTY") emptyThisCycle += n;
  }

  return {
    dealers: { total: dealersTotal, withRooftop: dealersWithRooftop, pendingResolution: dealersPending },
    prospects: { total: prospectsTotal, withRooftop: prospectsWithRooftop, pendingResolution: prospectsPending },
    rooftops: { total: rooftopsTotal, withSendSafeContact: rooftopsWithContact, contactGap: rooftopsGap },
    contactProfiles: { total: profilesTotal, sendSafe: profilesSendSafe },
    apollo: {
      enabled: enabled(),
      cycleKey,
      // No ledger row yet → report zeros rather than implying budget exists.
      capCredits: ledger?.capCredits ?? 0,
      spentCredits: ledger?.spentCredits ?? 0,
      backfillRemaining,
      revealsThisCycle,
      revealedThisCycle,
      emptyThisCycle,
    },
    generatedAt: now,
  };
}
