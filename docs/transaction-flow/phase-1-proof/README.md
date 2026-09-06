# Phase 1 migration proof — against production's physical schema

This directory holds the executable proof that the two Phase 1 migration directories apply cleanly,
produce every object they are supposed to produce, and are idempotent — **starting from the physical
schema production actually has today**, not from an empty database replayed through the repository's
migration chain.

Run it with `./run-proof.sh` against a disposable PostgreSQL **17.6** server on loopback. The script
refuses any non-loopback host, any database name outside `autolenis_prodbase` / `autolenis_e2e*`, and
any server that is not PostgreSQL 17.x. It never reads a production DSN and never writes to
production.

**It also runs in CI.** The `phase1-proof` job in `.github/workflows/ci.yml` stands up a
`postgres:17.6` service, asserts the major version, restores this baseline, asserts the eight digests
below, and then runs `run-proof.sh` end to end. Until that job existed the strongest verification in
this repository ran only when someone remembered to run it locally. The job reads no secret: its
database is created and destroyed inside the run, on the runner's loopback interface.

The digest assertion lives in the workflow rather than in this file, so it executes rather than being
a claim in prose. If the committed baseline ever stops reproducing production, that job fails and says
which of the eight definitions moved.

## Why the baseline had to change

An earlier version of this proof began from `prisma migrate deploy` on an empty database. That proves
the **repository's migration chain** is internally consistent. It does not prove the migrations are
compatible with **production's current physical schema**, and the two are measurably different:

| | chain replay | production |
| --- | ---: | ---: |
| tables | 223 | **249** |
| columns | 2,684 | **2,976** |
| indexes | 576 | **679** |
| enum types | 89 | **88** |
| triggers | 5 | **29** |
| policies | 0 | **23** |
| materialized views | 0 | **1** |

That gap is not cosmetic. Four of the tables this wave adopts (`comms_outbox`,
`lifecycle_touch_schedule`, `idempotency_keys`, `jobs_dead_letter`) **already exist in production** but
do **not** exist in a chain replay. Against the chain, `CREATE TABLE IF NOT EXISTS` creates them from
the migration's own definition and everything downstream matches trivially. Against production it is a
no-op and the migration must cope with the columns, constraints and indexes production already has.
Only the production baseline exercises that path.

## What this proves, and what it does not

**PROVES.** Both directories apply, in order, each inside a single transaction (the way Prisma runs
them), against production's physical schema; all 368 expected objects exist afterwards; **no CHECK
constraint stopped admitting a value production admits**; a second application of both directories
changes nothing — neither the object census nor the *definitions* of tables, columns, indexes,
constraints, enums, triggers, policies or functions (compared by digest).

**DOES NOT PROVE.** Anything about `_prisma_migrations`. The restore deliberately carries **no
ledger**. Ledger correctness is a separate question, addressed in §6 of the implementation workflow,
and nothing in this directory should be read as evidence about it.

## How the baseline was obtained

`pg_dump` could not be used: this session holds no production DSN, and the only available client is
16.13, which refuses to dump a 17.6 server. The baseline was therefore synthesised **read-only** from
production's `pg_catalog` via `SELECT`s, and every generated statement is committed here under
`production-baseline/`. No row of application data, no role password and no connection string appears
anywhere in these files — there is not a single `INSERT` or `COPY`.

**Zero objects were denied.** Every function body, trigger definition, policy expression, constraint
and index definition was readable. Two Supabase-platform extensions are **NOT RESTORABLE** on a stock
PostgreSQL server and are recorded as such in `production-baseline/01-extensions-enums.sql` rather than
silently dropped:

- `pg_stat_statements` 1.11 (schema `extensions`)
- `supabase_vault` 0.3.1 (schema `vault`)

Neither is referenced by any column default, constraint or index in the application schema, so their
absence does not change the objects this proof applies to.

`production-baseline/42-roles-auth-stub.sql` is **restore scaffolding, not production**. Production's
policies reference the Supabase-managed roles (`service_role`, `authenticated`, `anon`) and the
`auth` schema, none of which live in `public` and none of which this proof reproduces. Without stubs
the 23 policies could not be stored at all. The stubs are excluded from every census and are not
evidence about production's auth implementation.

## Fidelity of the baseline

The restored database is compared with production on eight independent digests over the full `public`
schema — not counts, but the sorted definitions themselves. All eight match:

| digest | value |
| --- | --- |
| tables | `20a57af430e216a81e3f78037f2e8710` |
| columns (name, type, nullability, default) | `9cbd2c69756985508661eb5df43b929c` |
| indexes (full `indexdef`) | `e70929fd3a3f35b05ada4dd6c94b3da3` |
| constraints (full `pg_get_constraintdef`) | `3cb59e667290ee423a36bb46c01252f4` |
| enum labels (in sort order) | `b3da03427662d577eeeec93be5f6a950` |
| triggers (full `pg_get_triggerdef`) | `6ae2e83c90749678d184e61fc8edac4d` |
| policies (cmd, roles, USING, WITH CHECK) | `0b3104b3280862b0c442f588f931224f` |
| functions (full `pg_get_functiondef`) | `55b65dd6d0c412dc24a910338b2aa01b` |

Reproduce with `production-baseline/digests.sql`, which is written to run unchanged against either
side.

## Baseline freshness — a MANUAL pre-deploy step, not an automated gate

Those eight digests were true when the baseline was captured. They are not self-maintaining. If
production changes and the committed baseline does not, `run-proof.sh` keeps proving the Phase 1
migrations against a schema production no longer has — and it stays green while doing it. **A green
proof over a stale baseline is the failure mode this section exists to prevent.**

`check-baseline-freshness.sh` re-derives the census and all eight digests from production
**read-only**, restores the committed baseline into a scratch database, and compares the two. It
fails on any digest divergence and names which of the eight diverged and by how many objects —
including the case people misread, where a digest changes while the object count does not, which
means a *definition* changed rather than anything being added or removed.

```bash
PROD_READONLY_URL='postgresql://…' docs/transaction-flow/phase-1-proof/check-baseline-freshness.sh
#   exit 0  baseline fresh — all 8 digests match
#   exit 1  DRIFT — the report names which digests and the object deltas
#   exit 2  refused / misconfigured — nothing was compared
```

**This is deliberately NOT wired into CI, and that is not an oversight.** Automating it would
require a production credential in the CI environment. No usable `DATABASE_URL` secret is configured
for this repository — `pnpm db:report-target` reports `configured: no … classification: UNUSABLE` —
and adding one to make this check automatic is a worse trade than running it by hand. **Baseline
freshness is therefore a manual step, to be run before relying on the proof for a deploy decision.**
Treat a green `run-proof.sh` as conditional on a freshness check that someone actually ran.

Safety properties, since this is the one script here that touches production:

- Production is opened with `default_transaction_read_only=on`, and is only ever queried through
  `production-baseline/digests.sql` and `production-baseline/census.sql` — the same two committed
  files `run-proof.sh` uses, invoked rather than reimplemented, so the two can never drift apart.
  Both are pure `SELECT`s over `pg_catalog` / `information_schema`.
- No DSN, user, or password is ever printed; all output is scrubbed first.
- It reads `PROD_READONLY_URL`, deliberately a different variable from `DATABASE_URL`, so the
  application's read-write DSN is never used here by accident.
- The scratch restore is destructive and so refuses any host but loopback and any database name it
  did not create itself — the same guards `run-proof.sh` uses.
- Digests are major-version sensitive, so it refuses to compare unless both sides are PostgreSQL
  17.x; comparing across majors would report drift that is not drift.

## Baseline census

```
enum_types=88   enum_labels=464   tables=249   columns=2976
pk=248          unique=35         check=29     fk=135
indexes=679     matviews=1        functions=12 triggers=29
policies=23     rls_enabled=249
```

## What the proof found

Running against the production baseline with the §13-D11 / §13-D24 corrections applied (2026-09-06)
confirmed each of them in the database rather than only in the DDL: both `assigned_admin_id` foreign
keys resolve to `admins(id) ON DELETE SET NULL`; `queue_items.owner_role` is `QueueOwnerRole` with
its 8 members and neither `SUPPORT` nor `CONCIERGE`; `QueueItemType` holds 20 labels including
`LINEAGE_ORPHAN`; `queue_items_owner_role_status_idx` exists; `comms_outbox` carries `delivered_at`
and a `status` CHECK admitting eight values. Run against the *pre*-correction database the same
`verify.sql` reports 17 `MISSING` rows naming exactly those objects — the assertions fail first, so
they are not decorative.

Running against the production baseline caught a defect the chain-based proof had not: the four
`ALTER TABLE` statements that add `ip_unavailable_reason` / `consent_ip_unavailable_reason` were each
missing the comma terminating the preceding clause, so `20261106000100` was **syntactically invalid**
and would have failed on deploy. Fixed, and the proof re-run from a clean restore.

It had earlier caught a second dependency the plan had missed: `audit_logs.action` is the
`AdminActionType` **enum**, not text, so the legacy-path partial index needs `LEGACY_PATH_WRITE`
committed by the first directory before the second can reference it in a predicate.

## Why two directories

PostgreSQL will not let a transaction use an enum label that the same transaction added
(`unsafe use of new value`). Prisma wraps each migration file in one transaction. Every new label
therefore lands in `20261106000000_transaction_spine_enums`, and everything that *uses* those labels —
defaults, `CHECK`s, index predicates — lands in `20261106000100_transaction_spine_foundation`.

Relatedly, `CREATE INDEX CONCURRENTLY` is illegal inside a transaction and so can never appear in a
Prisma migration; the enforcement indexes here are plain `CREATE INDEX`.

## The CHECK preservation gate — why a rewritten CHECK gets its own step

A rewritten `CHECK` is the one statement in this wave that can **narrow production silently**.
`DROP CONSTRAINT IF EXISTS` + `ADD CONSTRAINT` succeeds whether the new predicate is weaker or
stronger than the old one. A narrowing does not fail at deploy; it fails later, as a `23514` on a
value production used to accept — and by then the migration is in the chain and CLAUDE.md forbids
editing it, so the correction is a *new forward migration* and the wrong definition stays in the
chain permanently.

The concrete case: `lifecycle_touch_sequence_allowed` carries `deposit_reminder_5` and
`deposit_reminder_6`. Dropping either would break the six-touch $99 recovery cadence (PAY-19, B1) at
touch five.

So the wave restates production's current values in full before adding any, and step **4b** of
`run-proof.sh` *measures* that rather than trusting it. Three assertions, in this order, because the
third is a valid proof for one predicate shape only:

**(i) Nothing may vanish.** A CHECK production has must still be there afterwards. A constraint
dropped and never re-added contributes no values, so the value comparison in (iii) would not notice
it going.

**(ii) The method has to fit the predicate.** Enumerating accepted values proves preservation for a
*finite list of literals* and for nothing else. A range, an arithmetic expression, a conditional or a
cross-column relationship contributes no literals at all — so a rewrite that narrowed one would sail
through a value comparison reporting "nothing lost". This schema already holds eight such predicates
(the `*_ip_unavailable_reason_exclusive` pair rules, `a IS NULL OR b IS NULL`), so the shape is not
hypothetical. `production-baseline/check-defs.sql` classifies every CHECK as `ENUMERABLE` or
`OPAQUE` against the two canonical finite-list forms PostgreSQL prints, and the run **fails** if any
constraint whose definition changed is not `ENUMERABLE` on both sides. The message says what to do
instead: demonstrate the implication old ⇒ new explicitly and record it, or do not ship the rewrite.
The classifier is deliberately strict — misreading an opaque predicate as enumerable is the failure
that matters, and an unfamiliar-but-safe shape costs only one explicit demonstration.

Current classification: **38 ENUMERABLE, 8 OPAQUE**, and all three CHECKs this wave rewrites are
ENUMERABLE on both sides, so enumeration is a valid proof for each of them — established, not
assumed.

**(iii) No admitted value may be lost.** For those finite lists,
`production-baseline/check-sets.sql` emits every `(constraint, admitted value)` pair after the
baseline is restored and **before** anything is applied, again after both directories are applied,
and any pair present before and absent after fails the run and is printed.

The "before" side is therefore re-derived from the committed baseline on every run, not transcribed
into an expectation that can rot. `verify.sql` independently asserts the values each of five CHECKs
must admit, so a narrowing cannot pass by being quietly deleted from one list — it would have to be
deleted from both, and the run-proof comparison does not read `verify.sql`'s list at all.

Measured on 2026-09-06 against the PostgreSQL 17.6 restore:

| constraint | before | after | delta |
| --- | --- | --- | --- |
| `comms_outbox_channel_check` | `{email, sms}` | `{email, sms, in_app}` | +1, none lost |
| `comms_outbox_status_check` | `{pending, sending, sent, failed, suppressed, skipped}` | those six + `{delivered, cancelled}` | +2, none lost |
| `lifecycle_touch_sequence_allowed` | 19 sequences | the same 19 — `pg_get_constraintdef` byte-identical | +0, none lost |
| 9 further CHECKs | no production predecessor | their own sets | new |
| 27 CHECKs | — | unchanged | — |

168 admitted `(constraint, value)` pairs before, 215 after, **0 lost**. All 29 CHECKs in the
baseline classify as ENUMERABLE, so nothing production has needed an explicit implication argument
this time.

### The gates fail first

A gate that has never been seen to fail is a gate nobody has tested. Each was exercised on
2026-09-06 by temporarily editing the wave and confirming `run-proof.sh` exits non-zero, then
reverting:

| probe | gate that fired | exit |
| --- | --- | ---: |
| drop `campaigns_type_check` and never re-add it | (i) `VANISHED: campaigns.campaigns_type_check` | 1 |
| rewrite `campaigns_type_check` from a finite list to `length(type) BETWEEN 3 AND 5` | (ii) *"was rewritten but is not a finite-list predicate (before=ENUMERABLE after=OPAQUE)"* | 1 |
| drop `deposit_reminder_5`/`_6` from the sequence CHECK | step 4 — `verify.sql`'s own value assertions | 1 |
| drop them from the CHECK **and** from `verify.sql`'s list, the way an author narrowing "consistently" would | (iii) `LOST: … deposit_reminder_5`, `… deposit_reminder_6` | 1 |

The last row is the one that matters: it is the proof that the two lists are independent. Step 4b
re-derives its "before" side from the committed baseline and never reads `verify.sql`, so narrowing
both in lockstep does not hide the narrowing.

A fifth probe deliberately did **not** fire, and should not have: rewriting
`vehicle_requests_ip_unavailable_reason_exclusive` — an OPAQUE predicate — passed, because that
constraint has no production predecessor. The wave creates it, so there is nothing to preserve. The
gate is about production's constraints, not the wave's own.

## `preflight.sql` — the two statements that validate against DATA, not schema

Everything else in this directory reasons about *schema*, which the committed baseline reproduces
exactly. Two statements in the wave instead validate against **rows**, and rows are not in the
baseline:

- `vehicle_requests_one_open_per_buyer_key` cannot be created while any buyer holds more than one
  open request (§13-D2);
- `vehicle_requests_assigned_admin_id_fkey → admins(id)` validates existing data, so every non-NULL
  `assigned_admin_id` must already resolve there (§13-D11 correction 1).

Both are inside `prisma migrate deploy`'s single transaction, so either one failing rolls the whole
wave back.

**A row count read during review does not bind at deploy time.** §5.7 records
`vehicle_requests.assigned_admin_id` as holding 0 non-NULL rows *when it was read on 2026-09-05*.
That is a measurement, not a property of the column: one admin assignment between then and the
deploy makes `ADD CONSTRAINT` fail. So the safety argument is not the zero — it is `preflight.sql`,
run read-only against production in the same maintenance window as the deploy, immediately before
it. Same contract as `verify.sql`:

```
PASS  <=>  no row has status = 'BLOCK'
```

with exactly one `CHECKED` row proving it executed. Each `BLOCK` row names a record to reconcile by
an owner-run audited change first — never by migration SQL, because a migration that repairs its own
preconditions with an `UPDATE` is a migration that hides them.

`run-proof.sh` step **4c** runs it against the restore. That proves only that the file is valid SQL
and honours its contract; the baseline carries no rows, so it says **nothing** about whether
production is clean. That is precisely why the check belongs at deploy time.

One ordering detail the proof caught: the D2 predicate compares `status::text`, not `status`. The
preflight runs *before* `prisma migrate deploy`, so `VehicleRequestStatus` does not yet carry
`DRAFT`, `PAYMENT_REQUIRED` or `RADIUS_AUTHORIZATION_REQUIRED` — directory 1 adds them. Comparing the
enum against a label it does not have yet is a `22P02` that aborts the whole preflight, so the one
query meant to protect the deploy would fail to run at all. The index in directory 2 keeps the enum
comparison, because by then directory 1 has committed the labels.

Exercised both ways on a disposable restore: clean baseline → only the `CHECKED` row; seeded with an
`assigned_admin_id` holding a `User.id` and a buyer holding three open requests → one `BLOCK` row
each, then rolled back.

## Phase 1 is additive

`verify.sql` asserts, among the 368 expected objects, that `e_sign_envelopes_deal_id_key` is **still
present** after the wave. Replacing that live constraint is the signatures-phase
expand/backfill/verify/cutover/contract sequence, not this one. If a future edit to Phase 1 drops it,
the verifier fails.

## The verifier's contract

`verify.sql` returns one row per problem, plus exactly one `TOTAL` row reporting how many objects it
checked.

```
PASS  <=>  no row has status = 'MISSING'
```

A silent zero-row result is **not** a pass — it means the query did not run. `run-proof.sh` enforces
both halves.
