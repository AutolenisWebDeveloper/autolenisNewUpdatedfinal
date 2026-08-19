# Phase 4 — pre-merge / pre-live `prisma migrate deploy` list

**Why this file exists:** the Vercel build runs `prisma generate && next build` — it does
**NOT** run migrations. Every Phase 4 migration below must be applied to the production
database with `prisma migrate deploy` **before** the corresponding code is live, or the
runtime will hit missing tables/columns/enum values. (This is the discipline that closes
the Phase 3 miss where prod ran without its migrations.)

Run from `frontend/` with prod `DATABASE_URL` + `DIRECT_URL` set:

```bash
cd frontend && pnpm exec prisma migrate deploy
```

All migrations are additive + idempotent (`IF NOT EXISTS` / `ADD VALUE IF NOT EXISTS`), so a
re-run is a no-op. Each migration file carries its own documented rollback block.

## Migrations to apply (in order)

| # | Migration | Block | What it adds |
| - | --- | --- | --- |
| 1 | `20260930000000_add_dealer_availability` | D1 | Tables `dealer_availability`, `dealer_availability_windows`, `dealer_blackout_dates` (RLS deny-all, FK `ON DELETE CASCADE`, indexed FKs). Blackout dates are `@db.Date`. |
| 2 | `20261001000000_pickup_confirm_roundtrip` | D2a | `PickupStatus` += `PROPOSED`, `DEALER_COUNTERED`; `NotificationType` += `PICKUP_PROPOSED`, `PICKUP_COUNTERED`; `pickups` columns `proposed_time`, `proposed_by`, `proposed_at`, `counter_count`, `proposed_reminder_sent_at`, `counter_reminder_sent_at`; index `(status, proposed_at)`. Enum values placed `BEFORE 'SCHEDULED'` / `BEFORE 'PICKUP_SCHEDULED'` to match schema order. |
| 3 | `20261002000000_cron_job_logs_index` | D3a | Index `cron_job_logs(cron_name, started_at)` (`cron_job_logs_cron_name_started_at_idx`). Speeds the dead-cron `groupBy(cron_name) max(started_at)`, the ops-widget latest-per-cron read, and the retention purge scan as the table grows. Index-only, no columns/enums; `CREATE INDEX IF NOT EXISTS` (non-concurrent). |

## Post-deploy verification (prod introspection)

```sql
-- D1 tables present
SELECT table_name FROM information_schema.tables
WHERE table_name IN ('dealer_availability','dealer_availability_windows','dealer_blackout_dates');

-- D2a pickup columns present
SELECT column_name FROM information_schema.columns
WHERE table_name = 'pickups'
  AND column_name IN ('proposed_time','proposed_by','proposed_at','counter_count',
                      'proposed_reminder_sent_at','counter_reminder_sent_at');

-- D2a enum values present
SELECT enumlabel FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
WHERE t.typname = 'PickupStatus' AND enumlabel IN ('PROPOSED','DEALER_COUNTERED');
SELECT enumlabel FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
WHERE t.typname = 'NotificationType' AND enumlabel IN ('PICKUP_PROPOSED','PICKUP_COUNTERED');

-- D3a index present
SELECT indexname FROM pg_indexes
WHERE tablename = 'cron_job_logs' AND indexname = 'cron_job_logs_cron_name_started_at_idx';
```

## Related, pre-existing prod drift (separate audit — NOT introduced by Phase 4)

Prod `NotificationType` is **missing 4 values that `schema.prisma` already declares**:
`SUPPORT_TICKET`, `PAYOUT_REQUESTED`, `PAYOUT_PAID`, `PAYOUT_FAILED`. An earlier
`ADD VALUE` migration never reached prod, so code writing those notification types would
fail at runtime today. This is unrelated to the Phase 4 migrations above (whose `BEFORE`
anchors `SCHEDULED` / `PICKUP_SCHEDULED` both exist in prod), but should be reconciled in a
separate migrate-deploy audit.
