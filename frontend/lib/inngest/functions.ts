// INNGEST FUNCTION REGISTRY — EMPTY.
//
// Every workload that once ran on Inngest has been migrated onto the internal
// Vercel-Cron + Postgres + idempotency substrate. `inngestFunctions` is now an
// empty array; `app/api/inngest/route.ts` serves it (alongside the still-dormant
// intakeFunctions) but Inngest schedules and handles nothing here.
//
// Migration lineage (see docs/inngest-migration-ledger.md):
//   - analyticsRefreshFn / inactivityScannerFn / savedSearchMatcherFn (Batch 3)
//       → analytics-refresh / inactivity-scan / saved-search-match crons
//   - workflowResumeFn (Batch 5)      → workflow-resume-drain cron
//   - emailSendFn / smsSendFn (Batch 6b) → comms-outbox-drain cron
//   - campaignFanoutFn / scheduledCampaignCronFn (Batch 8) → campaign-dispatch cron
//   - dealerAward* (Batch 7)          → dealer-award-dispatch cron
//   - contentPipeline* (Batch 4)      → content-pipeline-drain cron
//   - formAbandonmentFn / exitIntentFn (Batch 9) → lead-nurture-drain cron
//         (lib/services/crm/lead-nurture.service.ts, durable
//          lead_nurture_schedule rows with run_at; the LP form-abandonment and
//          exit-intent triggers now call scheduleLeadNurture instead of
//          inngest.send).
//
// Do NOT reintroduce Inngest here (including via any dead-letter recovery path).
// New periodic/deferred workloads extend the internal cron substrate.

export const inngestFunctions = [];
