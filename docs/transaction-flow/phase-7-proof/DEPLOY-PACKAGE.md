# Phase 7 — migration deploy package

**Two migrations. Authored and proved on a throwaway loopback Postgres; NEITHER HAS BEEN APPLIED TO
PRODUCTION.** Applying them is the owner's, under the per-run protocol in `CLAUDE.md` — each command
stated in chat with its sanitized target, approved for that run, and refused unless both
`pnpm db:report-target` reports read `classification: PRODUCTION` **and**
`project ref: aieybibvewmvrubcpthm`.

Branch: `claude/txflow-07-reaffirmation`. Head at the time of writing:
`c252ffba61d5cdce1f9daa412d083c15e83bc221`.

Every `psql` example below uses `-P pager=off`. Every read runs inside a **server-enforced**
read-only transaction — proved, not asserted: `CREATE TABLE` inside one fails with
`ERROR: cannot execute CREATE TABLE in a read-only transaction`.

---

## 1. The two migrations, verbatim

### 1a. `frontend/prisma/migrations/20261116000000_financing_status_default/migration.sql`

- **3,362 bytes**
- **SHA-256** `42a5607142dc05bb2362bedeff610259fff9bb2a2936f0580f318146e299223b`

The whole executable content is one statement; the rest of the file is the header explaining why:

```sql
ALTER TABLE "financing" ALTER COLUMN "status" SET DEFAULT 'NOT_STARTED';
```

**Why.** §13-D18 ruled that the four legacy `FinancingStatus` values stay in the Postgres enum and
that CODE REFUSES TO WRITE THEM. A column default is not code. The column carried
`DEFAULT 'PENDING'` — a legacy label — since `20260423180146_complete_schema:206`, so an INSERT that
omitted `status` wrote a legacy value **from the database**, and D18's guarantee was untrue by
construction: the refusal could be perfect and the legacy value still land. Parity row
`deal-early/D4a` specified this default as part of the Phase 1 wave; the wave added the enum labels
and the columns but not the default. This is that missed half.

**Blast radius.** `ALTER COLUMN … SET DEFAULT` rewrites one catalogue entry (`pg_attrdef`). No table
rewrite, no row touched, no lock beyond the ACCESS EXCLUSIVE of the ALTER itself. Production holds
**zero** `financing` rows, so there is nothing to touch either way.

**Core Rule 11 does not apply.** It narrows no unique index, no CHECK and no foreign key, so there is
no prior guarantee for callers to have relied on and nothing to re-derive.

**Rollback.** `ALTER TABLE "financing" ALTER COLUMN "status" SET DEFAULT 'PENDING';` — exact,
no data step, no ordering constraint.

### 1b. `frontend/prisma/migrations/20261116000100_identity_firewall_revocation/migration.sql`

- **4,767 bytes**
- **SHA-256** `78eca257185209ff49a9b4006fbaca0dff470c5bd745b5a95b135f6e0a9f97c0`

```sql
ALTER TABLE "identity_firewall_entries" ADD COLUMN IF NOT EXISTS "revoked_at" TIMESTAMP(3);
ALTER TABLE "identity_firewall_entries" ADD COLUMN IF NOT EXISTS "revoked_by" TEXT;
```

**Why.** §13-D38 ruled **OPTION C**: the lift is append-only. A release that ends is *revoked*, never
flipped back to `WITHHELD`, because "this rooftop was given the buyer's details at time T" is the
§25.2 evidence the table exists to hold and a state flip overwrites it.

**Revocation is not a recall.** The lift's purpose is the secure handoff — at reaffirmation the
buyer's and co-buyer's contact details and the trade packet are *sent*. No option recalls what was
sent. Revocation is a **portal-surface control**: it stops `app/dealer/**` and `app/api/dealer/**`
rendering identity, and nothing more. The control on a dealership's conduct after the handoff is
§25.2 anti-circumvention, not this column.

**`deal_id` and `scope` are deliberately NOT added.** D38's register row proposed them, on evidence
that was stale by the time Phase 7 opened (it cited `schema.prisma:2755-2765`, which is
`admin_support_notes`; the model is at `3254-3275`). Phase 5 had already landed two-thirds of the
proposal under different names — `auction_id`, `rooftop_id`, `state`, `lifted_at`, `lifted_by` and
`@@unique([auctionId, rooftopId])`. A Deal's entry is `(deal.auction_id, deal.rooftop_id)`: fully
derivable and already uniquely indexed, so a second key would be a second way to be wrong. `scope`
models a partial release that §25.1 does not define.

**Blast radius.** Both columns nullable, no default, so every pre-existing row (production holds
**zero**) is valid unchanged and `revoked_at IS NULL` reads as "not revoked" without a backfill.
`@@unique([auctionId, rooftopId])` is untouched — Core Rule 11 does not apply.

**Rollback.**
`ALTER TABLE "identity_firewall_entries" DROP COLUMN IF EXISTS "revoked_at", DROP COLUMN IF EXISTS "revoked_by";`
— but read the ordering note below first: the asymmetry runs in reverse too.

---

## 2. Deploy ordering — which code paths break if the app goes first

| Migration | Order | What breaks if the application deploys first |
| --- | --- | --- |
| `20261116000000_financing_status_default` | **Either order is safe** | Nothing. Every Phase 7 write of `financing` goes through `recordFinancingCheckpoint`, whose `status` argument has no default, so no code path reads the column default in either direction. The only behaviour that differs is a manual `INSERT` typed by a human without a status — not a path this codebase has. |
| `20261116000100_identity_firewall_revocation` | **MIGRATION FIRST — asymmetric** | `dealerIdentityVisible()` (`frontend/lib/services/deal/identity-firewall.service.ts`) selects `revoked_at` on **every dealer surface that renders buyer identity**. Without the column every such read raises `42703 undefined_column`. The predicate **fails closed**, so that surfaces as "identity withheld" rather than as a leak — safe, but **every winning dealership loses the buyer's contact details, the co-buyer block and the trade packet until the migration lands**. Concretely: the dealer deal page's Buyer Contact block, the trade-in packet, the Finance Manager page, and `GET /api/dealer/deals/[dealId]`. |

Migration-first is harmless in the other direction: nothing writes either column until the
application ships.

**On rollback the asymmetry reverses.** Dropping the columns while the application is still deployed
re-creates the fail-closed outage. **Revert the application first, then the columns.**

---

## 3. Preflight — run this, read every row, then decide

`docs/transaction-flow/phase-7-proof/preflight.sql` — 9,116 bytes, SHA-256
`5d8dc6db55c8da7a720a7bdb745f2f250e978266ed5f28505fa417956f2ec01b`.

**Contract.** PASS ⟺ no row has `status = 'BLOCK'`. Exactly one `CHECKED` row reports how many
preconditions ran. `INFO` rows are for reading, not for stopping.

**A silent zero-row result is NOT a pass** — it means the query did not run, and that is a stop.

It evaluates eight preconditions:

1. **Ledger health** — a rolled-back migration with no successful attempt. `migrate deploy` refuses
   to run while one exists, so this is a BLOCK rather than a surprise mid-deploy.
2. **Baseline count** — exactly **111** applied migrations. A migration counts as applied when it
   FINISHED and was not rolled back; the count is over DISTINCT names, because Prisma appends a row
   per attempt and **a rolled-back row beside a success is retry history, not a failure** (reported
   as INFO).
3. **Phase 6 present** — `20261115000000_phase6_relaunch_partial_unique` is applied. Asserted rather
   than assumed: at STOP 1 the working assumption was that Phase 6 had applied nothing, and you
   corrected it. Asserting the baseline is why that cost a sentence instead of a failed deploy.
4. `financing` table exists · 5. its `status` column exists · 6. the `FinancingStatus` enum carries
   the `NOT_STARTED` label — the only way statement 1a can fail, and Prisma runs the file in one
   transaction, so it would roll back the whole thing.
7. `identity_firewall_entries` exists · 8. whether the two new columns are already present
   (`IF NOT EXISTS` makes that a no-op, so INFO, not BLOCK).

### What the output means

| You see | Do this |
| --- | --- |
| `CHECKED` + only `INFO` rows | **Proceed** to step 4. |
| Any `BLOCK` row | **Stop.** Each carries its own remedy. Reconcile by an owner-run audited change — never by migration SQL. |
| No `CHECKED` row / zero rows | **Stop.** The query did not run. |
| `INFO … already recorded` | You are re-running. That migration will be skipped; nothing applies for it. |
| `INFO … current default is 'PENDING'::"FinancingStatus", over 0 row(s)` | Expected. This is the state your production census reported. |

---

## 4. Commands, in execution order

Run from `frontend/`. Each is a separate per-run approval in chat, with the sanitized target stated
first and nothing else on the command line.

```bash
# ── STEP 0 — identify the target. Neither report prints the DSN. ────────────────────────────────
git checkout claude/txflow-07-reaffirmation
git pull --ff-only origin claude/txflow-07-reaffirmation

cd frontend
pnpm db:report-target DATABASE_URL
pnpm db:report-target DIRECT_URL
```

**Fail closed.** Refuse to continue unless BOTH reports read `classification: PRODUCTION` **and**
`project ref: aieybibvewmvrubcpthm`. Unset, unparseable, a different reference, or `PRODUCTION`
inferred from a database name alone is a refusal.

```bash
# ── STEP 1 — PREFLIGHT (read-only, server-enforced) ─────────────────────────────────────────────
psql "$DIRECT_URL" -P pager=off -X -v ON_ERROR_STOP=1 --single-transaction \
  -c "SET TRANSACTION READ ONLY" \
  -f ../docs/transaction-flow/phase-7-proof/preflight.sql
```

Show the **complete** result in chat. A `BLOCK` row stops the run. No `CHECKED` row also stops it.

```bash
# ── STEP 2 — what will apply, before anything applies ───────────────────────────────────────────
pnpm exec prisma migrate status
```

Expected: exactly two pending —
`20261116000000_financing_status_default` and `20261116000100_identity_firewall_revocation`.
**Anything else pending means this package does not describe your deploy. Stop.**

```bash
# ── STEP 3 — APPLY ─────────────────────────────────────────────────────────────────────────────
pnpm exec prisma migrate deploy
```

Expected: `2 migrations applied`, both named. A non-zero exit, or a count other than 2, stops the
run and goes straight to step 4 to find out what landed.

```bash
# ── STEP 4 — VERIFY, BOTH HALVES. Neither alone is sufficient. ─────────────────────────────────
psql "$DIRECT_URL" -P pager=off -X -v ON_ERROR_STOP=1 --single-transaction \
  -c "SET TRANSACTION READ ONLY" \
  -f ../docs/transaction-flow/phase-7-proof/verify.sql
```

**Step 4 precedes the application deploy** (`IMPLEMENTATION-WORKFLOW.md` §8.1a.2, binding).

```bash
# ── STEP 5 — the application deploy (owner's, separately authorized) ────────────────────────────
```

---

## 5. Post-deploy verification — both halves

`docs/transaction-flow/phase-7-proof/verify.sql` — 7,029 bytes, SHA-256
`2f7dc665edbd179e474ef05d6ec3142636aec78fe01f0f9f0edaf5a8f6367dd7`.

**Contract.** PASS ⟺ no row has `status = 'MISSING'`. Exactly one `CHECKED` row. A silent zero-row
result is not a pass.

It checks the **physical schema** *and* `_prisma_migrations`, because the two can disagree in both
directions and each disagreement means something different:

| Disagreement | What it means | The repair |
| --- | --- | --- |
| schema PRESENT, ledger MISSING | DDL applied **out of band** | An owner-approved `prisma migrate resolve --applied <name>`. **Never more DDL.** |
| ledger PRESENT, schema MISSING | The ledger is lying | **Report it.** Do not reapply DDL by hand; the repair is a new forward migration. |

This is not hypothetical for this project: six migrations once went unrecorded and enum labels came
to exist with no ledger row. That is why both halves are here and why a `MISSING` row is *reported*,
never repaired in place.

The ledger half deliberately counts successes and rollbacks separately, so a name with a rolled-back
attempt **and** a success is reported as retry history rather than as a failure.

If you prefer the raw ledger query rather than the file:

```bash
psql "$DIRECT_URL" -P pager=off -X -v ON_ERROR_STOP=1 --single-transaction \
  -c "SET TRANSACTION READ ONLY" \
  -c "SELECT migration_name, started_at, finished_at, rolled_back_at, applied_steps_count FROM _prisma_migrations WHERE migration_name IN ('20261116000000_financing_status_default','20261116000100_identity_firewall_revocation') ORDER BY started_at"
```

---

## 6. What was actually proved, and where

On a throwaway loopback Postgres **16.13** at `127.0.0.1:55437` (17.6 was unreachable — no Docker
daemon; CI's 17.6 `migrations` job is the authority, and you accepted the degraded proof
environment). **Record the version you actually saw: 16.13.**

| Proof | Result |
| --- | --- |
| Full chain applied to an empty database | 113 migrations, both Phase 7 migrations included |
| Re-applied a second time | No-op, as CI's idempotency pass requires |
| `pnpm db:check-drift` | At baseline 344, no functional drift |
| `verify.sql` against the migrated database | 4 `PRESENT` + 1 `CHECKED`, **0 `MISSING`**, exit 0 |
| `preflight.sql` against a pre-Phase-7 state | 1 `CHECKED` + 2 `INFO`, **0 `BLOCK`**, exit 0 — and the baseline assertion found exactly 111, independently matching your production census |
| `preflight.sql` against an already-migrated database | **`BLOCK  baseline mismatch: 113 migrations applied, expected 111`** plus two `already recorded` INFO rows — the BLOCK branch fires |
| `verify.sql` against a pre-Phase-7 state | **5 `MISSING`** — the MISSING branch fires |
| `verify.sql` against DDL applied **out of band** (schema changed, ledger untouched) | **2 `MISSING` on the ledger half, 2 `PRESENT` on the schema half** — it catches precisely the failure mode that produced six unrecorded migrations |
| Read-only transaction | `ERROR: cannot execute CREATE TABLE in a read-only transaction` — server-enforced, not a promise about the SQL |

**NOT VERIFIED, and named:** nothing in this package has run against production. No production
credential was held at any point in this session, and none was requested.
