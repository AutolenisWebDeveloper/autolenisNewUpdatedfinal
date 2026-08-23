// lib/services/monitoring/cron-schedule.ts
//
// CRON_STALENESS — the explicit source-of-truth registry of every SCHEDULED cron
// (mirrors vercel.json) and its expected cadence. Dead-cron detection compares a
// cron's most-recent recorded run against this cadence and flags it OVERDUE when
// it should have run but didn't. A registry entry with no run record at all is
// NEVER_RUN (informational only — e.g. a cron not yet wired through withCronRun);
// only OVERDUE alerts.
//
// `intervalMinutes` is the WORST-CASE normal gap between two consecutive
// scheduled fires (not the average). For day-of-week crons that means the real
// weekend/weekly gap — e.g. a Mon–Fri cron's Fri→Mon gap is 72h, a weekly cron's
// is 7 days — so a normal quiet weekend never reads as dead. A cron test
// (cron-schedule.test.ts) pins this registry to vercel.json in both directions, so
// a newly-scheduled cron cannot silently escape monitoring and a de-scheduled one
// cannot linger here.
//
// This module is intentionally DB-free (pure data + pure classifier) so it can be
// imported by both the server-side detector (dead-cron.service) and the Supabase-
// backed ops widget (operations.service) without pulling in Prisma.

export interface CronStalenessEntry {
  /** Worst-case normal gap between consecutive scheduled fires, in minutes. */
  intervalMinutes: number;
  /** Optional explicit override; otherwise derived from the grace policy below. */
  maxAgeMinutes?: number;
}

// Minute constants for readability.
const M = 1;
const HOUR = 60 * M;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

export const CRON_STALENESS: Record<string, CronStalenessEntry> = {
  // ── every 5 minutes ──
  "auction-close": { intervalMinutes: 5 },
  "intake-reconcile": { intervalMinutes: 5 },
  "deposit-activation-reconcile": { intervalMinutes: 5 },
  "content-publisher": { intervalMinutes: 5 },
  "content-generation-drain": { intervalMinutes: 5 }, // migrated off Inngest content workers
  "health-check": { intervalMinutes: 5 },
  "workflow-automation": { intervalMinutes: 5 },
  "social-publish-queue": { intervalMinutes: 5 },
  // ── every 10 / 15 / 30 minutes ──
  "holds": { intervalMinutes: 10 },
  "social-video-queue": { intervalMinutes: 10 },
  "coverage-hold-reconcile": { intervalMinutes: 15 },
  "dlq-drain": { intervalMinutes: 15 },
  "inventory-stale-sweep": { intervalMinutes: 30 },
  "sla-check": { intervalMinutes: 30 },
  // ── hourly ──
  "pickup-confirmation-nudge": { intervalMinutes: HOUR },
  "affiliates": { intervalMinutes: HOUR },
  "contract-shield": { intervalMinutes: HOUR },
  "dealer-invitation-reminder": { intervalMinutes: HOUR },
  "inventory-sync-priority": { intervalMinutes: HOUR },
  "trust-check": { intervalMinutes: HOUR },
  "vehicle-offer-expire": { intervalMinutes: HOUR },
  "inactivity-scan": { intervalMinutes: HOUR }, // migrated off Inngest cron `0 * * * *`
  // ── multi-hour ──
  "social-status-sync": { intervalMinutes: 2 * HOUR },
  "prequal-message-delivery": { intervalMinutes: 4 * HOUR },
  "sessions": { intervalMinutes: 6 * HOUR },
  "inventory-sync-full": { intervalMinutes: 6 * HOUR },
  "saved-search-match": { intervalMinutes: 6 * HOUR }, // migrated off Inngest cron `0 */6 * * *`
  "amips-generate": { intervalMinutes: 8 * HOUR }, // 06,14,22 → 8h max gap
  // ── daily ──
  "apollo-ledger-rollover": { intervalMinutes: DAY },
  "prequal-ibv-reminders": { intervalMinutes: DAY },
  "prequal-stale-cleanup": { intervalMinutes: DAY },
  "prequal-sla-escalation": { intervalMinutes: DAY },
  "prequal-purge": { intervalMinutes: DAY },
  "analytics-snapshot": { intervalMinutes: DAY },
  "analytics-refresh": { intervalMinutes: DAY }, // migrated off Inngest cron `0 2 * * *`
  "morning-briefing": { intervalMinutes: DAY },
  "amips-tier-f": { intervalMinutes: DAY },
  // In-app nurture dispatchers scheduled in B-F5 (gated by CRM_INAPP_ENGINE_ENABLED).
  "lead-magnet-sequence": { intervalMinutes: DAY },
  "social-lead-nurture": { intervalMinutes: DAY },
  "amips-snapshot": { intervalMinutes: DAY },
  "social-signal-scan": { intervalMinutes: DAY },
  "social-generate": { intervalMinutes: DAY },
  "social-analytics-sync": { intervalMinutes: DAY },
  // ── weekday-only (Mon–Fri): Fri→Mon is a 72h gap ──
  "dealer-followup": { intervalMinutes: 3 * DAY },
  // ── weekly ──
  "affiliate-digest": { intervalMinutes: WEEK },
  "affiliate-inactive": { intervalMinutes: WEEK },
  "dealer-inactive": { intervalMinutes: WEEK },
  "faith-verse-rotation": { intervalMinutes: WEEK },
  "dealer-scorecard-snapshot": { intervalMinutes: WEEK },
  "amips-search-sync": { intervalMinutes: WEEK },
  "amips-lifecycle": { intervalMinutes: WEEK },
  "amips-digest": { intervalMinutes: WEEK },
  "social-optimize": { intervalMinutes: WEEK },
  "social-market-index": { intervalMinutes: WEEK },
};

// Grace policy: a cron is OVERDUE only after ~two full missed intervals plus a
// fixed jitter allowance. Conservative by design — this is a monitoring floor, so
// we accept catching a dead cron a little late over crying wolf on a cold start,
// a deploy gap, or scheduler jitter.
export const OVERDUE_GRACE_MINUTES = 10;

export function maxAgeFor(entry: CronStalenessEntry): number {
  return entry.maxAgeMinutes ?? entry.intervalMinutes * 2 + OVERDUE_GRACE_MINUTES;
}

export type CronLivenessState = "OK" | "OVERDUE" | "NEVER_RUN";

export interface CronLiveness {
  cronName: string;
  state: CronLivenessState;
  lastRunAt: Date | null;
  ageMinutes: number | null;
  maxAgeMinutes: number;
}

/**
 * Classify one cron's liveness from its most-recent run timestamp.
 * - unknown cron (not in the registry) → OK (not monitored, never alerts)
 * - registry cron with no run row      → NEVER_RUN (informational)
 * - last run older than maxAge         → OVERDUE (alerts)
 * - otherwise                          → OK
 */
export function classifyCronLiveness(
  cronName: string,
  lastRunAt: Date | null,
  now: Date = new Date(),
): CronLiveness {
  const entry = CRON_STALENESS[cronName];
  if (!entry) {
    return { cronName, state: "OK", lastRunAt: lastRunAt ?? null, ageMinutes: null, maxAgeMinutes: 0 };
  }
  const maxAgeMinutes = maxAgeFor(entry);
  if (!lastRunAt) {
    return { cronName, state: "NEVER_RUN", lastRunAt: null, ageMinutes: null, maxAgeMinutes };
  }
  const ageMinutes = Math.floor((now.getTime() - lastRunAt.getTime()) / 60_000);
  const state: CronLivenessState = ageMinutes > maxAgeMinutes ? "OVERDUE" : "OK";
  return { cronName, state, lastRunAt, ageMinutes, maxAgeMinutes };
}
