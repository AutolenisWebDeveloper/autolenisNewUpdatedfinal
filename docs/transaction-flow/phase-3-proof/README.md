# Phase 3 migration package

**One migration. Not applied by this branch, and not applicable by it.**

Phase 3 adds exactly one piece of schema: the enum label `DepositStatus.DISPUTED`. Everything else
the phase needs already shipped in the Phase 1 wave — `deposits.vehicle_request_id`, the
dispute/refund hold triple (`disputed_at`, `hold_reason`, `hold_released_at`), `plan_snapshots`,
`sourcing_cases`, `vehicle_request_due_diligence_checkpoints`, `service_fee_payments`, `commissions`
with `REVERSED`, `queue_items` with `PAYMENT_EXCEPTION`, and `VehicleRequestStatus.PAYMENT_REQUIRED`.
`sourcing_cases.status` is unconstrained `TEXT`, so writing `ACTIVE_SOURCING` needs no DDL.

## The files

| File | Bytes | SHA-256 |
| --- | ---: | --- |
| `frontend/prisma/migrations/20261111000000_deposit_status_disputed/migration.sql` | 3203 | `c91b2b173069c7fc771307131f873cd571d67fd6d8c4bc9971eb0f71758cea2a` |
| `frontend/prisma/migrations/20261111000000_deposit_status_disputed/rollback.sql` | 1922 | `f72a9d7a8e71c0167db2634dd65df53aac6675c1d76b34c86adf3687444a3749` |

The body is one statement:

```sql
ALTER TYPE "DepositStatus" ADD VALUE IF NOT EXISTS 'DISPUTED';
```

## Why it is alone in its own directory

PostgreSQL refuses to USE a new enum label in the transaction that added it —
`55P04 unsafe use of new value of enum type` — and Prisma wraps each `migration.sql` in one
transaction. So a migration that adds the label and then references it in a `CHECK`, a default, or a
`WHERE` fails on a live database while passing on an empty one. The Phase 1 wave split its enums out
for the same reason. Proved on PostgreSQL 17.6 by `run-proof.sh`, not assumed.

## There is no schema rollback, and `rollback.sql` says so

PostgreSQL cannot drop an enum label. `rollback.sql` states that plainly rather than pretending, and
leaves the only data-level reversal — `UPDATE deposits SET status='PAID' WHERE status='DISPUTED'` —
**commented out**, because moving a deposit off DISPUTED asserts that a dispute did not happen. That
is a human decision about money, not a script.

## The proof

`run-proof.sh` runs seven steps against a throwaway loopback PostgreSQL 17.6:

1. restore the committed production baseline;
2. apply the full Prisma chain;
3. census and digest the schema;
4. apply this migration;
5. re-digest and compare **every field except `enums_d`** — the one field this migration exists to
   move (a helper strips it; comparing the full digest would have compared the change against
   itself, which is how the first run of step 5 failed);
6. assert the enum change exactly: 544 → 545 labels, and `DepositStatus` gains `DISPUTED` and
   nothing else;
7. re-apply and assert idempotency.

Last run: **PASSED, exit 0**, on PostgreSQL 17.6.

## Applying it is the owner's

Through the per-run protocol in `CLAUDE.md` → *Production database access*, and only after
`preflight.sql` is shown complete in chat with no `BLOCK` row. This session holds no production
credential and ran nothing against production.

The order is the one §8.1a.2 fixes, including "step 4 precedes the application deploy". Both halves
are verified afterwards — the physical schema (`pg_enum` for `DepositStatus`) **and**
`_prisma_migrations` — because neither alone is sufficient.
