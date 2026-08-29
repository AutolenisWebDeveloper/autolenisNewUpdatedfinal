> [!CAUTION]
> # ⛔ DO NOT RUN — PREMISE INVALID as of 2026-08-29
>
> **This runbook's central premise was disproven by a read-only inspection of the
> live database. Do not execute any write step (01, 02, 03, 05) until it is
> corrected.** Step 00 (inspection) remains safe and is how the findings below
> were obtained.
>
> **The premise was wrong.** This runbook assumes production is *unbaselined* —
> no `_prisma_migrations` table, `prisma migrate deploy` refusing pre-flight with
> `P3005`. Production in fact **has** `_prisma_migrations` with **67 migrations
> recorded, 67 finished, 0 rolled back**, most recent applied
> **2026-08-29 22:01**. `migrate deploy` does **not** refuse with `P3005`. The
> production analogue the steps were rehearsed against did not represent
> production, so the rehearsal validated the wrong thing.
>
> ### Step 1 would destroy an owner-gated compliance boundary
>
> Step 1 baselines every migration `< 20261017000000` as applied. That range
> includes **`20261014000000_esign_envelope_history`** and
> **`20261015000000_esign_consent_and_executed_artifact`**, which are
> **verified NOT recorded in production, and their objects verified absent**:
> the `e_sign_envelope_history` table does not exist, and
> `e_sign_envelopes.executed_document_key` does not exist.
>
> They are **deliberately unapplied pending attorney/compliance review** — see
> `lib/services/esign/esign-schema-gate.ts`, which states ESIGN/UETA legal
> sufficiency is NOT VERIFIED and the consent policy is blocked. Recording them
> as applied would erase that boundary, silently assert a compliance-blocked
> migration had shipped, and strand the runtime gate that currently keeps
> `esign-artifact-reconcile` green.
>
> ### Steps 3 and 5 are unnecessary, not merely risky
>
> - **Step 3 (template seeds) — not needed.** All nine seeds already exist in
>   production (`abandonment_touch_1..3`, `exit_intent_recovery`,
>   `welcome_d0/d1/d3/d5/d7`); 52 templates total. The premise that files 05/08
>   never applied there is false.
> - **Step 5 (stale impersonations) — moot.** `admin_impersonations` has
>   **0 rows**. There is nothing to close.
>
> ### The rehearsal environment did not match production
>
> The analogue ran **PostgreSQL 16.4**; production runs **17.6**.
>
> ### What a corrected runbook must do
>
> Baseline only the migrations genuinely applied (verify per-migration rather
> than by timestamp cutoff), explicitly **exclude** `20261014` and `20261015`
> and assert they stay excluded, drop step 3, drop step 5, and decide
> separately whether `ai_action_intents` (table absent, migration
> `20261016000000` unrecorded, no compatibility gate) should be applied or
> gated the way e-sign is.

---

# Production runbook — adopt the migration chain, backfill the missing seeds

**Status: PREPARED AND DRY-RUN VERIFIED — not executed against production.**
Every step below was executed end-to-end against a production analogue (a
database built the way production was built: `prisma db push` + the CRM SQL
files as they historically applied, i.e. **without** 05/08's seeds), then
re-executed to prove idempotency. Production execution is an owner action;
nothing in this repo holds production credentials.

## Why this runbook exists

Production was provisioned with `prisma db push` and hand-run SQL — it has no
`_prisma_migrations` table. Three consequences, established in Batches 6–7:

1. **The chain cannot be adopted naively.** `prisma migrate deploy` against a
   non-empty database with no migrations table refuses **pre-flight** with
   `P3005` (verified — it changes nothing when it refuses). Until production is
   baselined, no future schema change can ship through the chain.
2. **Nine email templates are missing.** `migrations/05` carried an
   `ON CONFLICT` arbiter that can never match its own partial unique index, so
   it aborted and rolled back on every database it ever touched — production
   included; `migrations/08` failed downstream. Repaired in PR #360; the seeds
   (four LP-abandonment/recovery templates + five `welcome_d*` nurture
   templates) still need to be applied wherever the originals failed.
3. **One security-advisor finding**: `amips_intelligence_snapshots` has RLS
   disabled wherever it was created by `db push` (which does not apply RLS).
   Migration `20261017` closes it, behaviour-neutrally.

## Order of execution

| Step | Script | Writes? | What it does |
| --- | --- | --- | --- |
| 0 | `00-inspect.sh <url>` | no | Captures state: schema dump, seed counts, RLS, `conversations` shape, ACTIVE impersonations, and the REAL production drift vs `schema.prisma` |
| 1 | `01-baseline-chain.sh <url> --yes` | migrations table only | Marks every migration `< 20261017000000` (94) as applied — they were authored against the live DB and must not re-run |
| 2 | `02-deploy-post-baseline.sh <url> --yes` | yes | `migrate deploy` applies the executable tail (20261017 reconciliation, 20261018 shape-guarded orphan retirement, 20261101×2 affiliate), then proves a second deploy is a no-op |
| 3 | `03-backfill-template-seeds.sh <url> --yes` | yes | Applies repaired 05 + 08; +9 templates on first run, +0 after |
| 4 | `04-verify.sh <url>` | no | Asserts: 98/98 recorded, 0 unfinished, 4+5 seeds present, RLS on, no orphan, functional drift 0/0/0 |
| 5 | `05-close-stale-impersonations.sql` | owner decision | Lists stranded ACTIVE impersonation sessions; the closing UPDATE stays commented until a cutoff date is filled in |

Without `--yes`, every write step prints exactly what it would do and exits —
run each once without the flag first and read the output.

## Dry-run evidence (production analogue, 2026-08-29)

- Naive `migrate deploy` → refused, `P3005`, nothing created. (The failure this
  runbook's design prevents.)
- Step 1: `baselined 93, skipped 1 already recorded` (the skip path is real —
  one migration had been resolved during rehearsal). Re-run: `baselined 0,
  skipped 94`.
- Step 2: applied exactly the four post-cutoff migrations; second deploy `No
  pending migrations to apply`, both on first execution and on re-run.
- Step 3: templates 46 → 55 (+9: `abandonment_touch_1..3`,
  `exit_intent_recovery`, `welcome_d0/d1/d3/d5/d7`); re-run delta 0.
- Step 4: all checks green, functional drift `0/0/0`.
- The analogue's drift vs `schema.prisma` after the runbook: **39 DDL
  statements**, essentially the DROP proposals for the deliberately
  non-Prisma-managed CRM/manual tables — far below the 345 pinned for
  chain-built CI databases. `00-inspect.sh`'s `drift-vs-schema.sql` produces
  the same artifact for REAL production; that file is the input to any future
  decision about closing residual drift, and nothing in this runbook acts on
  it.

## Expected effects on production, exhaustively

Writes: `_prisma_migrations` created and populated (98 rows); RLS enabled on
`amips_intelligence_snapshots`; nine `email_templates` rows inserted; the
`20261018` retirement **no-ops** (production's `conversations` is the live
CRM table — the migration is shape-guarded and touches only a table with
`session_id` and without `contact_id`); the two `20261101` affiliate
migrations apply their guarded/additive DDL (policy + columns already present
from `db push` → no-ops). Nothing else. No data is modified or deleted by
steps 0–4.

## Rollback

Step 1: `delete from _prisma_migrations` (or drop the table) returns
production to the pre-runbook state — the table is bookkeeping, not schema.
Step 2: each applied migration documents its own rollback; `20261017` ships
`rollback.sql` alongside. Step 3: `delete from email_templates where
template_key in (...)` for the nine keys above (they are new rows, not
updates). Step 5's UPDATE names its rows in the audit trail it modifies.

## What this runbook deliberately does NOT do

- Close the residual structural drift (index renames/reshapes, FK re-creation,
  CRM table DROP proposals). That requires reading `00-inspect.sh`'s output
  from REAL production and making destructive decisions — a separate, reviewed
  change, never a side effect of adoption.
- Run `prisma db seed`, create storage buckets, or touch Supabase config —
  see `prisma/MIGRATIONS.md` and `DEPLOYMENT_CHECKLIST.md`.
