# Migration ledger reconciliation — production vs `frontend/prisma/migrations/`

**Audit date:** 2026-08-31 · **Project:** `aieybibvewmvrubcpthm` · **Read-only.**
Nothing in this document has been executed. No migration was run, no schema changed,
no production row mutated. Every production claim below comes from `to_regclass`,
`information_schema.columns`, `pg_indexes`, `pg_type`/`pg_enum`, or `_prisma_migrations`
via read-only `SELECT`.

---

## 0. Executive summary

Four findings, in order of consequence.

1. **The gap is 32 migrations, not 5.** The ledger holds 67 rows; the repo holds 99
   migration directories. Every ledger row maps to a repo directory (0 orphans), so
   the ledger is a strict subset. The unrecorded set runs from `20260828000000`
   through `20261102000000`.

2. **31 of those 32 are already physically present in production.** The 32nd
   (`20261018000000`) is a verified no-op by design. So the ledger under-reports
   reality across the board — this is a bookkeeping gap, not a backlog of pending
   schema work.

3. **⚠️ The owner-gated e-sign boundary has already been crossed physically.** The
   in-repo runbook asserts (2026-08-29) that `20261014`/`20261015` are unapplied and
   their objects *absent*. As of today their objects are **present**:
   `e_sign_envelope_history` exists with 32 columns, and `e_sign_envelopes` now has
   **35 columns including all 7 gated ones**. Production drifted between 2026-08-29
   and 2026-08-31. The runtime gate is still closed (it is an env var, not a schema
   probe), so nothing is exposed — but the premise written into the runbook and into
   `esign-schema-gate.ts` is now factually stale. **This is an owner decision, not
   something this audit acts on.**

4. **`migrate deploy` against production would fail — but not on `20261102`.**
   `20261102000000` is fully idempotent and would succeed. Deploy never reaches it:
   it aborts at `20260920000000`, the 4th unrecorded migration, on a duplicate
   column.

---

## 1. Which migrations exist in the repo, and are their objects physically present?

### 1a. The five named in the request

All five exist in `frontend/prisma/migrations/`. **All five have their objects
physically present in production.** Evidence is per-object, via `to_regclass` and
`information_schema.columns` — never via the ledger.

| Migration | Exists in repo | Probe objects | Production |
| --- | --- | --- | --- |
| `20261013000000_esign_inhouse_evidence` | ✅ | `e_sign_envelopes.document_version_id`, `.document_hash`, `.consented_to_electronic`, `.certificate_generated_at`, `.expires_at`; enum `ESignStatus.EXPIRED`; index `e_sign_envelopes_document_version_id_idx` | **all PRESENT** |
| `20261014000000_esign_envelope_history` | ✅ | table `e_sign_envelope_history` (32 cols, 0 rows); `e_sign_envelopes.attempt_number`; indexes `…_deal_id_idx`, `…_envelope_id_idx` | **all PRESENT** |
| `20261015000000_esign_consent_and_executed_artifact` | ✅ | `e_sign_envelopes.consent_policy_version`, `.consent_snapshot`, `.executed_document_key`, `.executed_document_hash`, `.executed_generated_at`, `.confirmations_sent_at`; plus `e_sign_envelope_history.consent_policy_version`, `.executed_document_key` | **all PRESENT** |
| `20261016000000_ai_action_intent_lifecycle` | ✅ | type `AiActionIntentStatus`; table `ai_action_intents` (0 rows); indexes `…_idempotency_key_key`, `…_status_idx` | **all PRESENT** |
| `20261102000000_dealer_outreach_apollo_operational` | ✅ | tables `apollo_person_candidates`, `apollo_enrichment_runs` (both 0 rows); 11 cols on `dealer_contact_profiles`; 6 cols on `dealer_outreach_log`; indexes incl. partial `dealer_outreach_log_live_attempt_key` | **all PRESENT** |

44 individual object checks, 44 PRESENT, 0 ABSENT.

### 1b. The wider gap the request did not name

`_prisma_migrations` = 67 rows. `frontend/prisma/migrations/` = 99 directories.
**32 migrations are unrecorded**, not 5. The ledger runs contiguously to
`20260919000004_add_dealer_prospect_claim`, then jumps to
`20261101000000_affiliate_correctness`; `20260828000000` is also missing from the
earlier range.

One probe object per migration, same method:

| # | Migration | Probe | Production |
| --- | --- | --- | --- |
| 1 | `20260828000000_dealer_invitation_token_hash` | `dealer_invitations.token_hash` | PRESENT |
| 2 | `20260919000005_add_esign_envelope_document_key` | `e_sign_envelopes.document_key` | PRESENT |
| 3 | `20260919000006_add_referral_milestone_config` | `referral_milestone_configs` | PRESENT |
| 4 | `20260920000000_add_buyer_opportunity_intake_processed_at` | `buyer_opportunities.intake_processed_at` | PRESENT |
| 5 | `20260921000000_add_funnel_stage_snapshot` | `funnel_stage_snapshots` | PRESENT |
| 6 | `20260922000000_add_dealer_prospect_email_verification` | `dealer_prospects.email_verified_at` | PRESENT |
| 7 | `20260923000000_add_dealer_and_prospect_coordinates` | `dealers.latitude` | PRESENT |
| 8 | `20260924000000_add_dealer_rooftop` | `dealer_rooftops` | PRESENT |
| 9 | `20260925000000_add_dealer_contact_profile` | `dealer_contact_profiles` | PRESENT |
| 10 | `20260926000000_add_apollo_credit_ledger` | `apollo_credit_ledger` | PRESENT |
| 11 | `20260927000000_add_auction_anti_snipe` | `auctions.auto_extension_count` | PRESENT |
| 12 | `20260928000000_add_outside_invite_rooftop_expiry` | `outside_auction_invites.rooftop_id` | PRESENT |
| 13 | `20260929000000_add_vehicle_request_coverage_hold` | `vehicle_requests.coverage_hold_at` | PRESENT |
| 14 | `20260930000000_add_dealer_availability` | `dealer_availability` | PRESENT |
| 15 | `20261001000000_pickup_confirm_roundtrip` | `pickups.proposed_time` | PRESENT |
| 16 | `20261002000000_cron_job_logs_index` | index `cron_job_logs_cron_name_started_at_idx` | PRESENT |
| 17 | `20261003000000_auction_vehicle_request_fk` | `auctions.vehicle_request_id` | PRESENT |
| 18 | `20261004000000_phase5_block1_rules_audit` | `compliance_rules` | PRESENT |
| 19 | `20261005000000_phase5_block3_credit_application` | `credit_applications` | PRESENT |
| 20 | `20261006000000_phase5_block4_review_queue` | `financing_review_tasks` | PRESENT |
| 21 | `20261007000000_phase5_credit_app_one_active_per_deal` | index `credit_applications_one_active_per_deal` | PRESENT |
| 22 | `20261008000000_add_buyer_opportunity_intake_retry_terminal` | `buyer_opportunities.intake_attempts` | PRESENT |
| 23 | `20261009000000_add_deal_dealer_award_dispatch` | `deals.dealer_award_dispatched_at` | PRESENT |
| 24 | `20261010000000_batch1_inventory_matching_truthfulness` | index `inventory_sources_type_name_key` | PRESENT |
| 25 | `20261012000000_add_buyer_request_claim_token` | `buyer_request_claim_tokens` | PRESENT |
| 26 | `20261013000000_esign_inhouse_evidence` | `e_sign_envelopes.document_version_id` | PRESENT |
| 27 | `20261014000000_esign_envelope_history` | `e_sign_envelope_history` | PRESENT |
| 28 | `20261015000000_esign_consent_and_executed_artifact` | `e_sign_envelopes.consent_policy_version` | PRESENT |
| 29 | `20261016000000_ai_action_intent_lifecycle` | `ai_action_intents` | PRESENT |
| 30 | `20261017000000_migration_chain_functional_reconciliation` | `amips_intelligence_snapshots` | PRESENT |
| 31 | `20261018000000_retire_misnamed_conversations_table` | *(drop migration — see below)* | **N/A — verified no-op** |
| 32 | `20261102000000_dealer_outreach_apollo_operational` | `apollo_person_candidates` | PRESENT |

**`20261018000000` is a verified no-op in production, not a pending change.** It
retires an orphaned acquisition table that was misnamed `conversations`, and its
guard is on *shape*, not name: it acts only on a table that has `session_id` and
does **not** have `contact_id`. Measured in production:

```
conversations exists                : true
has contact_id  (CRM inbox shape)   : true      <-- guard requires FALSE
has session_id  (acquisition shape) : false     <-- guard requires TRUE
acquisition_conversations exists    : true
conversations_misnamed_..._bak      : false     (never needed)
```

The guard evaluates false, so the migration correctly does nothing. `conversations`
in production is the **live CRM inbox table** (10 columns), which this migration is
explicitly written to leave alone. Running it would be safe and would change nothing.

---

## 2. Is `20261102000000` idempotent?

**Yes — fully. `migrate deploy` will _not_ fail on it.**

Every DDL statement in its 192 lines is guarded:

- `ALTER TABLE … ADD COLUMN IF NOT EXISTS` × 17 (11 on `dealer_contact_profiles`,
  6 on `dealer_outreach_log`)
- `CREATE TABLE IF NOT EXISTS` × 2 (`apollo_person_candidates`, `apollo_enrichment_runs`)
- `CREATE [UNIQUE] INDEX IF NOT EXISTS` × 9, including the partial
  `dealer_outreach_log_live_attempt_key … WHERE "status" <> 'failed'`

Exactly one statement carries no `IF NOT EXISTS`, and it is wrapped in an exception
handler, which is the repo's established pattern for `ADD CONSTRAINT` (Postgres has
no `ADD CONSTRAINT IF NOT EXISTS`):

```sql
DO $$ BEGIN
    ALTER TABLE "apollo_person_candidates"
      ADD CONSTRAINT "apollo_person_candidates_rooftop_id_fkey"
      FOREIGN KEY ("rooftop_id") REFERENCES "dealer_rooftops"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;
```

Re-running `20261102000000` against today's production is a clean no-op. It also
ships a `rollback.sql`.

### 2a. But `migrate deploy` would still fail — three migrations earlier

This is the operative risk, and it is *not* about `20261102`. `migrate deploy` applies
every unrecorded migration in timestamp order, so it stops at the **first**
non-re-runnable statement. Scanning all 32:

| Migration | Fatal statement | Production state | Result |
| --- | --- | --- | --- |
| **`20260920000000`** | `ALTER TABLE "buyer_opportunities" ADD COLUMN "intake_processed_at" TIMESTAMP(3);` | column **PRESENT** | **aborts, `42701` duplicate_column** |
| `20260921000000` | `CREATE TABLE "funnel_stage_snapshots" (…)` and its `CREATE INDEX` | table **PRESENT** | would abort, `42P07` |
| `20260922000000` | `ADD COLUMN "email_verified_at"`, `ADD COLUMN "email_verification_status"` | columns **PRESENT** | would abort, `42701` |

Every *other* unguarded statement across the 32 is
`ALTER TABLE … ENABLE ROW LEVEL SECURITY`, which is re-runnable without error and is
therefore harmless.

**So: a `migrate deploy` against production today dies on the 4th of 32 migrations,
at `20260920000000`, having applied nothing.** Prisma runs each migration in a
transaction, so the failed migration rolls back — but it lands a `_prisma_migrations`
row with `finished_at` NULL and a `logs` value, putting the ledger into the
*unfinished* state (currently 0). Recovering from that needs
`migrate resolve --rolled-back` before anything else can proceed. This is a reason to
reconcile with `resolve --applied` rather than to attempt a deploy.

---

## 3. What does a deploy pipeline actually run?

**Production migrations are MANUAL. Nothing applies them automatically.**

Searched `frontend/vercel.json`, `frontend/package.json`, `.github/workflows/`, and all
`*.sh`/`*.ts` for `migrate deploy`, `db push`, and `migrate resolve`.

**Vercel — no migration step of any kind.**

```json
"framework": "nextjs",
"buildCommand": "pnpm build",
"installCommand": "pnpm install --frozen-lockfile"
```

`pnpm build` = `prisma generate && next build`, and `postinstall` = `prisma generate`.
`prisma generate` only writes the client from `schema.prisma`; it never touches a
database. `vercel.json` declares 66 crons and no `ignoreCommand`, and nothing in the
cron set runs a migration.

**CI — runs `migrate deploy`, but never against production.** Three invocations, all
in `.github/workflows/ci.yml`, all pointed at ephemeral service containers:

| Line | Job | `DATABASE_URL` |
| --- | --- | --- |
| 159 | Migration chain (empty DB → schema) | `postgresql://autolenis_ci@localhost:5432/autolenis_ci` |
| 165 | same job, "Re-apply (must be a no-op)" | same |
| 267 | E2E (dealer outreach) | `postgresql://autolenis_ci@localhost:5432/autolenis_e2e` |

The chain job asserts the database is empty first, then applies the full chain from
zero, then re-applies to prove a no-op. That is a *correctness gate on the chain*, not
a production deploy. The typecheck/lint/build job uses a placeholder URL and runs no
migration.

**The only production path is manual and currently hard-disabled.**
`frontend/scripts/production-runbook/` holds `00-inspect.sh`, `01-baseline-chain.sh`
(which loops `prisma migrate resolve --applied`), `02-deploy-post-baseline.sh`
(`prisma migrate deploy`), `03-backfill-template-seeds.sh`, `04-verify.sh`, and
`RUNBOOK.md`. Both write scripts refuse to run: each requires
`AUTOLENIS_RUNBOOK_OVERRIDE=i-have-corrected-this` and exits 2 otherwise, because
their premise (that production was unbaselined, `migrate deploy` refusing with P3005)
was disproven on 2026-08-29.

**Consequence:** production schema is currently changed by a human running SQL or a
Prisma command by hand against the production URL. That is how 31 migrations' worth of
objects arrived without ledger rows, and it is the mechanism behind the drift in §4.

---

## 4. ⚠️ Production drifted after the runbook was written — owner decision required

`01-baseline-chain.sh` states, as its reason for refusing to run:

> Both are verified NOT recorded in production AND their objects verified ABSENT: the
> `e_sign_envelope_history` table does not exist, and
> `e_sign_envelopes.executed_document_key` does not exist. They are DELIBERATELY
> unapplied pending attorney/compliance review.

**That is no longer true.** Measured today:

| Runbook claim (2026-08-29) | Measured 2026-08-31 |
| --- | --- |
| `e_sign_envelope_history` does not exist | **exists**, 32 columns, **0 rows** |
| `e_sign_envelopes.executed_document_key` does not exist | **exists**, type `text` |
| `e_sign_envelopes` has 28 columns; 7 gated ones absent | **35 columns; all 7 gated columns present** |

`esign-schema-gate.ts` carries the same now-stale premise in its header comment
("Production reality (verified against the live database): `e_sign_envelopes` has 28
columns … and `e_sign_envelope_history` does not exist at all").

**What is and is not at risk.** The gate is an environment variable
(`ESIGN_EXECUTED_ARTIFACT_ENABLED`, strict `=== "true"`, default OFF), **not** a
schema probe. So the compliance boundary is still enforced at runtime and no gated
behaviour has switched on. Both new tables hold **0 rows**, so no data was written
under an unreviewed consent policy. What changed is that the *physical* boundary is
gone: the gate is now the only thing holding the line, where previously the absent
columns were a second, independent barrier.

**Three consequences the owner should weigh — this audit takes no action on any:**

1. The compliance gate's defence-in-depth is reduced from two layers to one.
2. `esign-schema-gate.ts`'s `LEGACY_ENVELOPE_SELECT` projection still lists only the
   28 pre-migration columns. That remains *correct and safe* (an explicit projection
   never breaks against a superset schema) but it is now conservative rather than
   necessary.
3. Whoever applied those objects between 2026-08-29 and 2026-08-31 did so outside the
   migration trail. Worth establishing who and how before any reconciliation, because
   it bears on whether the ledger can be trusted going forward.

---

## 5. Proposed `prisma migrate resolve --applied` sequence

**Not executed. Do not run any of this without reading §5.3 first.**

`prisma migrate resolve --applied <name>` inserts a `_prisma_migrations` row marking a
migration applied **without running its SQL**. It is the correct instrument when the
objects already exist — which §1 proves for 31 of the 32.

### 5.1 Recommended — 29 migrations

Ordered by timestamp; Prisma requires no particular order, but applying them in chain
order keeps `migrate status` readable. The three owner-gated migrations are
**deliberately excluded** (§5.2).

```bash
# Run from frontend/. DB must be the production URL; export it once:
#   export DB="postgresql://…"   (do NOT paste it into shell history)
#
# Each line is independently safe and idempotent-by-precheck: `resolve --applied`
# ERRORS if the migration is already recorded, so re-running the whole block after a
# partial failure requires skipping the ones that landed (01-baseline-chain.sh does
# this with a `grep -qx` against the recorded set — reuse that loop rather than
# pasting these by hand).

for m in \
  20260828000000_dealer_invitation_token_hash \
  20260919000005_add_esign_envelope_document_key \
  20260919000006_add_referral_milestone_config \
  20260920000000_add_buyer_opportunity_intake_processed_at \
  20260921000000_add_funnel_stage_snapshot \
  20260922000000_add_dealer_prospect_email_verification \
  20260923000000_add_dealer_and_prospect_coordinates \
  20260924000000_add_dealer_rooftop \
  20260925000000_add_dealer_contact_profile \
  20260926000000_add_apollo_credit_ledger \
  20260927000000_add_auction_anti_snipe \
  20260928000000_add_outside_invite_rooftop_expiry \
  20260929000000_add_vehicle_request_coverage_hold \
  20260930000000_add_dealer_availability \
  20261001000000_pickup_confirm_roundtrip \
  20261002000000_cron_job_logs_index \
  20261003000000_auction_vehicle_request_fk \
  20261004000000_phase5_block1_rules_audit \
  20261005000000_phase5_block3_credit_application \
  20261006000000_phase5_block4_review_queue \
  20261007000000_phase5_credit_app_one_active_per_deal \
  20261008000000_add_buyer_opportunity_intake_retry_terminal \
  20261009000000_add_deal_dealer_award_dispatch \
  20261010000000_batch1_inventory_matching_truthfulness \
  20261012000000_add_buyer_request_claim_token \
  20261013000000_esign_inhouse_evidence \
  20261017000000_migration_chain_functional_reconciliation \
  20261018000000_retire_misnamed_conversations_table \
  20261102000000_dealer_outreach_apollo_operational \
; do
  DATABASE_URL="$DB" DIRECT_URL="$DB" pnpm exec prisma migrate resolve --applied "$m"
done
```

**Evidence, per migration.** Rows 1–25 and 30–32 of the §1b table are the evidence for
their own lines: each migration's probe object was measured PRESENT via `to_regclass`
or `information_schema.columns`. Three lines deserve their reasoning spelled out:

| Migration | Why `--applied` is factually correct |
| --- | --- |
| `20261013000000_esign_inhouse_evidence` | All 5 probed columns, the `ESignStatus.EXPIRED` enum label, and `e_sign_envelopes_document_version_id_idx` are PRESENT. **Not owner-gated** — the gate in `esign-schema-gate.ts` names only 20261014 and 20261015. |
| `20261018000000_retire_misnamed_conversations_table` | Its guard requires the acquisition shape (`session_id` present, `contact_id` absent). Production has the inverse (CRM shape). The migration's correct behaviour here is to do nothing, so "applied" and "run to completion" are the same state. |
| `20261102000000_dealer_outreach_apollo_operational` | Both tables, all 17 columns, and all probed indexes PRESENT (§1a). Fully idempotent (§2), so this line could alternatively be satisfied by running it — `resolve` is preferred only because it avoids a deploy that would abort earlier in the chain. |

### 5.2 Excluded — owner-gated, left unrecorded

```
20261014000000_esign_envelope_history                 <-- NOT resolved
20261015000000_esign_consent_and_executed_artifact    <-- NOT resolved
20261016000000_ai_action_intent_lifecycle             <-- NOT resolved
```

Per instruction these stay unapplied. **Note the tension this creates, because it is
not cosmetic:** their objects are physically present (§1a, §4), so the ledger will now
assert something false in the *opposite* direction — recording them as unapplied when
their schema exists. That is a deliberate, documented choice to preserve the
compliance boundary's paper trail, not an oversight.

`20261016000000_ai_action_intent_lifecycle` is grouped here because the runbook
explicitly leaves it undecided ("decide separately whether `ai_action_intents` is
applied or gated the way e-sign is"). Unlike e-sign it has **no** runtime gate — no
equivalent of `esign-schema-gate.ts` exists for it — and its table is present with 0
rows. It is a candidate to move into §5.1 once the owner confirms it carries no
compliance hold; it is held here only because the request named it among the three.

### 5.3 What must be settled before this is run

1. **Resolve the §4 drift first.** Reconciling the ledger while the runbook and
   `esign-schema-gate.ts` still describe a production state that no longer exists will
   bake the stale premise in. Correct those comments, or at minimum record the drift.
2. **A future `migrate deploy` will apply the three excluded migrations.** Once §5.1
   lands, the only unapplied migrations are 20261014/15/16, so the next
   `migrate deploy` targets exactly them. All three are effectively idempotent — their
   `ADD COLUMN`/`CREATE TABLE` statements carry `IF NOT EXISTS` and their only
   unguarded statements are re-runnable `ENABLE ROW LEVEL SECURITY` — so it would
   succeed as a near-no-op and silently flip the compliance boundary in the ledger.
   **The env-var gate must remain the enforcement mechanism; the ledger cannot be
   relied on to hold that line.**
3. **Reuse the existing loop, do not hand-paste.** `01-baseline-chain.sh` already
   implements skip-if-recorded, macOS-bash-safe iteration, and a recorded-total
   assertion. Correcting its cutoff logic (per-migration list instead of a
   `< 20261017000000` timestamp cutoff, which is exactly what its own disabled-header
   demands) is the right change — not a new script.
4. **Take a `_prisma_migrations` snapshot first.** `resolve --applied` has no
   single-command undo; reversing it means deleting rows by hand.
5. **Then verify:** `prisma migrate status` should report only the three excluded
   migrations as pending, and `_prisma_migrations` should read 96 rows
   (67 + 29), 0 unfinished, 0 rolled back.

---

## 6. Verification status

**Verified in this session (read-only SQL against `aieybibvewmvrubcpthm`):** the 67
ledger rows and their names; the 99 repo migration directories; the 32-migration set
difference in both directions; physical presence of 44 objects for the five named
migrations; one probe object for each of the other 27; the `conversations` shape
determination; `e_sign_envelopes` column count (35) and the 7 gated columns; row counts
(all 0) for `e_sign_envelope_history`, `ai_action_intents`, `apollo_person_candidates`,
`apollo_enrichment_runs`.

**Verified by reading the repo:** idempotency of `20261102000000` statement by
statement; the unguarded-DDL scan across all 32; `vercel.json` build configuration;
`package.json` scripts; the three CI `migrate deploy` invocations and their
`DATABASE_URL` values; the runbook scripts' disabled state; `esign-schema-gate.ts`.

**NOT VERIFIED:**

- **Who applied the 20261014/20261015 objects, and when.** The drift is measured; its
  author and mechanism are not. `_prisma_migrations` cannot answer this — the change
  bypassed it. Postgres does not retain DDL history by default; the Supabase
  dashboard's SQL-editor history or database audit logs are where this would be found.
- **Whether `20261016` carries a compliance hold.** No runtime gate exists for it in
  code. Whether the hold is real or an artifact of grouping is an owner question.
- **The exact production values of `_prisma_migrations.logs`/`started_at`** for the 67
  rows beyond `migration_name`, `finished_at`, `applied_steps_count`.
- **Behaviour of the proposed sequence.** Nothing here has been executed against any
  database, production or otherwise. The `42701`/`42P07` failure predictions in §2a are
  derived from statement text plus measured object presence, not from an observed run.
