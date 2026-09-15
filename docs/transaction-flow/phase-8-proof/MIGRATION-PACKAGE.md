# Phase 8 — migration package

**For the owner to run. Nothing here has been executed against production by any session.**
No session in this phase held a database credential of any kind, so every claim below about
production state is the owner's own verification (13:43 UTC, quoted in *Preconditions*), not
mine.

Four migrations, in this order. The order is not a preference: 000000 drops a unique index
that 000100's archive column and the whole co-buyer model depend on being gone, and 000300's
token is meaningless until the co-buyer envelopes 000000 enables can exist.

| # | Migration | Adds | Destructive? |
| --- | --- | --- | --- |
| 1 | `20261117000000_phase8_esign_signer_cutover` | drops `e_sign_envelopes_deal_id_key` | **YES — the only one** |
| 2 | `20261117000100_phase8_funding_clearance` | `e_sign_envelope_history.signer_kind`, `e_sign_envelopes_co_buyer_id_idx`, 4 nullable `financing` columns | no |
| 3 | `20261117000200_phase8_executed_copy_storage` | `contract_versions.executed_document_key` | no |
| 4 | `20261117000300_phase8_invited_signer_token` | 3 nullable `e_sign_envelopes` columns + 2 indexes | no |

## Integrity

Verify these before running anything. If a hash does not match, **stop** — the file is not the
one that was proved.

```
bd70a7fa3a65a7fdd73f7dae0ffdea5f643ab98fa5a3077700bb98f506ab7910  20261117000000_phase8_esign_signer_cutover/migration.sql
c7f533368f08e15fbb2fa5c0f8466b4c41bbecb2a0aee0084806175af936946d  20261117000100_phase8_funding_clearance/migration.sql
639393f4b086222ccf12b5f709ca273a84ca7f11b464c8436505a0e2d7cb0b74  20261117000200_phase8_executed_copy_storage/migration.sql
9f536c1d2789c5eacec95ea88174e47c40aa7028ef08bddd97e4ae1c93029797  20261117000300_phase8_invited_signer_token/migration.sql
```

Reproduce with `sha256sum frontend/prisma/migrations/2026111700*/migration.sql`. *(The first
draft of this file abbreviated two of these to a prefix. An integrity section that cannot be
checked without consulting another document is not an integrity section — the same class of
error as the rest of this phase, in the artefact meant to guard against it.)*

## Preconditions — owner-verified 13:43 UTC, and what each one guards

Every one of these is a precondition of migration 1, which is the destructive one. They are
listed with **what breaks if the precondition is false**, because a checklist whose items have
no stated consequence is one people tick.

| Precondition | Verified | Guards |
| --- | --- | --- |
| Both indexes present side by side | yes | 000000's first DO-block **refuses** without the composite replacement — the guarantee is never absent, even for one transaction |
| `e_sign_envelopes` 0 rows | yes | nothing to migrate; no envelope can be orphaned by the drop |
| 0 null `signer_kind` | yes | a null would make `[dealId, signerKind]` non-unique and the composite index unbuildable |
| 0 deals holding two envelopes | yes | 000000's second DO-block refuses; two envelopes before the composite exists is the state the drop must not create |
| Ledger 115 rows / 113 distinct / 0 unfinished | yes | an unfinished row means a prior `migrate deploy` died mid-flight; `prisma migrate deploy` would refuse or compound it |
| `deals` 0 · `funding_cleared_at` set on 0 | yes | no live deal can be caught mid-ladder by the new release gates |
| Production at `12e9b29e`, zero cron failures | yes | the application deploy and the schema are the pair that were proved together |

## The sequence

Each step is its own approval under CLAUDE.md's per-run protocol. **A prior approval never
carries to the next run.** Step 4 precedes the application deploy — §8.1a.2, binding.

```
# 0. Confirm the target, twice, before anything. BOTH must read PRODUCTION and
#    project ref aieybibvewmvrubcpthm, or nothing runs.
pnpm db:report-target DATABASE_URL
pnpm db:report-target DIRECT_URL

# 1. Preflight — show the COMPLETE result. A BLOCK row stops the run;
#    no CHECKED row means the query did not run, which is also a stop.
psql "$DIRECT_URL" -X -P pager=off -v ON_ERROR_STOP=1 --single-transaction \
  -c "SET TRANSACTION READ ONLY" -f docs/transaction-flow/phase-8-proof/preflight.sql

# 2. What will apply, and nothing else.
pnpm exec prisma migrate status

# 3. Apply.
pnpm exec prisma migrate deploy

# 4. Verify BOTH halves. Neither alone is sufficient.
psql "$DIRECT_URL" -X -P pager=off -v ON_ERROR_STOP=1 --single-transaction \
  -c "SET TRANSACTION READ ONLY" -f docs/transaction-flow/phase-8-proof/verify.sql

psql "$DIRECT_URL" -X -P pager=off -v ON_ERROR_STOP=1 --single-transaction \
  -c "SET TRANSACTION READ ONLY" \
  -c "SELECT migration_name, started_at, finished_at, rolled_back_at, applied_steps_count
        FROM _prisma_migrations
       WHERE migration_name LIKE '2026111700%' ORDER BY migration_name"

# 5. THEN deploy the application.
```

A `MISSING` row or an absent ledger row is **reported, never repaired with DDL**. The repair is
a new forward migration or an owner-approved `migrate resolve`.

## What was proved, and the one thing that was not

Proved on a throwaway loopback PostgreSQL **16.13**: all four applied, applied **again**
(idempotent — `IF NOT EXISTS` / `IF EXISTS` throughout), every expected object present, drift
**344 = baseline** with **zero functional drift**, and every rollback exercised in **both**
directions.

**NOT PROVED LOCALLY: PostgreSQL 17.6**, production's major. No Docker daemon is available in
the session and `apt.postgresql.org` returns 403 through the proxy. The version actually seen
is recorded rather than approximated. **CI covers 17.6** — the `migrations` job replays the
whole chain from empty against `postgres:17.6` twice, and `phase1-proof` restores production's
committed baseline and applies against it. Both pass on this branch.

## Rollbacks — each refuses rather than destroys

Every `rollback.sql` is a **guarded** rollback. This is deliberate: a rollback that quietly
takes data with it is worse than one that stops and makes a human decide.

| Migration | Refuses when | Because |
| --- | --- | --- |
| 000000 | any deal holds two envelopes | re-creating the unique index would fail anyway; refusing names the reason instead of erroring on a constraint |
| 000200 | any executed copy is stored | dropping orphans documents all three parties are entitled to, and leaves `executed_document_hash` proving the integrity of something unreachable |
| 000300 | any **live** token exists | dropping silently invalidates outstanding co-buyer links and returns those deals to the SIGNING_PENDING deadlock. A *consumed* token is spent evidence and blocks nothing, so it is not counted |

Each refusal was **observed**, not asserted: seeded the blocking row, ran the rollback, saw
exit 3 and the named message, confirmed the column survived.

## After the deploy

`ESIGN_EXECUTED_ARTIFACT_ENABLED` stays **unset in production**. §13-D4 gates it on
attorney/compliance sign-off that does not yet exist, and the phase was verified with the flag
on **in preview only**. The invited-signer surface additionally fails closed without the flag:
`prepareBuyerSigningEnvelope` throws `ESignSchemaUnavailableError` before writing anything.
