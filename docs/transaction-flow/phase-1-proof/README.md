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
them), against production's physical schema; all 311 expected objects exist afterwards; a second
application of both directories changes nothing — neither the object census nor the *definitions* of
tables, columns, indexes, constraints, enums, triggers, policies or functions (compared by digest).

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

## Phase 1 is additive

`verify.sql` asserts, among the 311 expected objects, that `e_sign_envelopes_deal_id_key` is **still
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
