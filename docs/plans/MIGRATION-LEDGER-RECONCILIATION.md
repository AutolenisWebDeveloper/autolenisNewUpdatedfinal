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

---

# 7. §5.1 execution attempt, 2026-08-31 — HALTED. Six stale checksums found.

**Nothing was written to production.** This section was produced by a session asked to
execute §5.1. It re-verified the audit's premises (all still true), then found a
condition §1–§6 did not record, and stopped before any write. The Supabase MCP's
read-only-for-production designation (`.claude/MCP_INVENTORY.md:27`) was honoured
throughout; every statement below came from a `SELECT`, from `sha256sum`, or from `git`.

## 7.1 Why the §5.1 sequence did not run

Two reasons, in order of importance.

1. **Six already-recorded migrations have a stored checksum that no longer matches
   their repo file.** §5.3.5's stated post-condition — "`prisma migrate status` should
   report only the three excluded migrations as pending" — is **already unachievable**,
   before the 29 are touched. Detail in §7.3.
2. **The named instrument cannot connect from a Claude Code session.** There is no
   `DATABASE_URL`/`DIRECT_URL` in the session environment (`frontend/.env.example` only),
   so `prisma migrate resolve --applied` has no production target. The only production
   channel available is the Supabase MCP, which is designated **read-only for prod**.
   Substituting a hand-written `INSERT` for the named instrument was considered and
   **rejected by the owner**; the read-only designation stands.

The §5.1 sequence itself is still correct. §7.2 re-verifies it.

## 7.2 Re-verification of the audit's premises (2026-08-31, read-only)

The audit was written 2026-08-31. Confirming nothing changed:

| Check | Audit | Re-verified | Result |
| --- | --- | --- | --- |
| Ledger row count | 67 | 67 | **unchanged** |
| Unfinished / rolled back | 0 / 0 | 0 / 0 | **unchanged** |
| §1b probe objects for the 29 (28 direct probes) | all PRESENT | **28 of 28 PRESENT** | **unchanged** |
| `20261013000000` extras — `ESignStatus.EXPIRED`, `e_sign_envelopes_document_version_id_idx` | PRESENT | PRESENT | **unchanged** |
| `20261102000000` extras — `apollo_enrichment_runs`, `dealer_outreach_log_live_attempt_key` | PRESENT | PRESENT | **unchanged** |
| `20261018000000` guard shape — `conversations` has `contact_id`, lacks `session_id`, 10 cols; `acquisition_conversations` exists | verified no-op | `contact_id`=true, `session_id`=false, 10 cols, `acquisition_conversations`=true | **still a verified no-op** |
| Any of the 29 already recorded | 0 | 0 | **unchanged** |
| §4 drift — `e_sign_envelope_history`, `e_sign_envelopes.executed_document_key`, `ai_action_intents` | all PRESENT | all PRESENT | **drift persists** |

**The 29 remain factually correct to record.** Nothing in §5.1 needs revision.

## 7.3 The six stale checksums

Prisma stores `_prisma_migrations.checksum` as the SHA-256 of `migration.sql`.
**Method proof:** recomputing it for all 67 recorded migrations reproduces the stored
value for **61**. The 6 below are the exceptions, and in each case the repo file was
edited *after* the migration was recorded — so the ledger's checksum is a fossil of the
pre-edit file.

| # | Migration | `applied_steps_count` | Stored checksum (ledger) | Current file checksum | File edited after apply? |
| --- | --- | --- | --- | --- | --- |
| 1 | `20260507000000_add_prequal_consent_accepted_at` | 1 | `a09e083de0bf67e6…cee2754d` | `d842256d5e577bd1…0025a004` | **Yes** |
| 2 | `20260702000000_add_admin_mfa_rate_limit` | 0 | `9910a58db7535217…f17c426a` | `636dcba9d1672c61…fbb93f34` | **Yes** |
| 3 | `20260703000000_add_admin_pending_recovery_codes` | 0 | `1650510530b5acee…75e1923f` | `f6d278bae9d44e80…b280bb2c4` | **Yes** |
| 4 | `20260703000000_add_pending_recovery_codes` | 0 | `871edd0862ddf712…077a6ac690` | `3185ff8775c1b82f…890918d18e` | **Yes** |
| 5 | `20260801000005_affiliate_onboarding` | 0 | `b47a1af251221fc1…c7ca74f2268f` | `fc6927793889d755…e1898a9c4a` | **Yes** |
| 6 | `20260911000000_add_acquisition_system` | 1 | `4a84c5454786399d…d994ae08c10` | `4b522ab8d95f1d2a…4b13f396e23db` | **Yes** |

Full values are recoverable with `sha256sum frontend/prisma/migrations/<name>/migration.sql`
and `SELECT migration_name, checksum FROM _prisma_migrations`.

This violates the standing rule in `.claude/skills/autolenis-supabase-postgres`
("Never edit an already-applied migration; add a new one"). It was not caught because
nothing compares repo checksums to ledger checksums — CI cannot see it (§7.5).

### 7.3.1 Editing commits, authorship, and the 2026-08-29 → 2026-08-31 window

| Migrations | Commit | Author | Authored (UTC) | Subject |
| --- | --- | --- | --- | --- |
| 1, 2, 3, 4, 5 | `f2032cf` | `Claude <noreply@anthropic.com>` | **2026-08-29T00:29:12Z** | `fix(prisma): make the migration chain able to build the database from zero` |
| 6 | `599b5a8` | `Claude <noreply@anthropic.com>` | **2026-08-29T01:01:44Z** | `fix(prisma): make the FULL provisioning runbook work from zero, not just the chain` |

**Do these commits fall in the attribution window? Stated plainly: yes by date, no by
content — they are not the mechanism.**

- Both are dated **2026-08-29**, the opening day of the window in which
  `e_sign_envelope_history` and the seven gated `e_sign_envelopes` columns appeared on
  production outside the migration trail (§4).
- **Neither commit touches `20261014000000`, `20261015000000`, or `20261016000000`.**
  `f2032cf` edits migrations 1–5 above plus `20261017000000`; `599b5a8` edits migration 6
  plus `20261018000000`. The three gated directories were last modified on
  **2026-08-26/27** (`015ec91`, `a1bd6f8`, `be41e53`), before the window opened.
- Both are **repo file edits, not production DDL**. Editing a `migration.sql` in git
  cannot create a table in Supabase.

**The window narrows, and the real lead is elsewhere.** `4f2e3a6`
(*"docs(ops): disable the production runbook — its premise was disproven"*,
**2026-08-29T22:58:29Z**) still asserts the gated objects were ABSENT. The audit found
them PRESENT on 2026-08-31. So the objects appeared **between 2026-08-29T22:58Z and the
2026-08-31 audit** — *after* both editing commits.

Two facts bound who could have done it:

1. **A session with production write access existed on 2026-08-29.** The ledger's two
   newest rows — `20261101000000_affiliate_correctness` (`finished_at`
   2026-08-29T21:57:59.717039Z) and `20261101000001_affiliate_rls`
   (2026-08-29T22:01:41.770409Z) — were genuinely applied, ~18 minutes after `961e03a`
   authored them against "VERIFIED live production state". That session predates the
   22:58 absence claim, so it is **not** the cause, but it establishes that a working
   production `DATABASE_URL` was in circulation that day.
2. **The same out-of-band signature appears again inside the narrowed window.**
   `20261102000000_dealer_outreach_apollo_operational` was authored on
   **2026-08-31T01:54–02:05Z** (`7e537d2`, `2c67005`, `5fb4314`, `45c419e`). Its objects
   — `apollo_person_candidates`, `apollo_enrichment_runs`, the outreach columns and
   indexes — are **PRESENT in production and UNRECORDED in the ledger**. That is the same
   pattern as the gated e-sign objects: DDL reached production without a ledger row,
   inside the same window.

**This is the only attribution lead available, and it is circumstantial.** It shows a
practice of applying DDL to production outside the migration trail during 2026-08-29 →
2026-08-31; it does not identify the operator or the command. Establishing that requires
Supabase logs for the window, which this session did not query.

## 7.4 Do the six block `migrate deploy` and `migrate status` independently of the 29?

**Yes — the two problems are independent, and the six are the harder blocker.**

| | The 29 unrecorded | The 6 stale checksums |
| --- | --- | --- |
| What Prisma sees | migrations pending | migrations *modified after being applied* |
| Fixed by | `migrate resolve --applied` | **no Prisma CLI command exists** (§7.6) |
| `migrate status` | lists them as pending | reports them as modified; non-zero exit |
| `migrate deploy` | would try to run them, and abort at `20260920000000` on a bare `ADD COLUMN` for a column that exists (§2a) | fails on the checksum mismatch |

Consequences:

- **Recording the 29 does not clear `migrate status`.** After a successful §5.1, status
  would report 3 pending (the gated ones, as intended) **plus 6 modified**. §5.3.5's
  expected clean result cannot be reached by §5.1 alone.
- **The six are already blocking today**, before any reconciliation, and would keep
  blocking after it.

> **Evidence class.** The checksum divergence is **VERIFIED** (61/67 reproduce, 6 do not;
> recomputed this session). The `migrate status` / `migrate deploy` *consequences* are
> stated from Prisma's documented behaviour and are **NOT VERIFIED** here — no production
> `DATABASE_URL` exists in this environment, so neither command was run. §2a's
> abort-at-`20260920000000` prediction carries the same caveat it always did.

## 7.5 Production ledger facts (owner-supplied; not re-derived here)

Recorded so later readers have them in one place. Where the snapshot this session
captured adds precision, that is noted — it is not a contradiction of the figures.

| Fact | Value |
| --- | --- |
| Ledger rows | **67** |
| Unfinished (`finished_at IS NULL`) | **0** |
| Rolled back | **0** |
| Duplicate `migration_name` | **0** |
| Rows with `applied_steps_count = 0` | **13** |
| Rows sharing `finished_at` to the microsecond | **12** at `2026-06-20T03:15:16.662615Z` |
| Rows with a non-null `logs` value | **25** |
| Do names track application order? | **No** |
| Name-prefix collisions | `20260703000000`, `20260915000000` |

Three refinements from the captured snapshot:

1. **The 25 rows with `logs` split cleanly into two populations**, and the split is
   informative: **13** carry an empty string `''` — and they are *exactly* the 13 rows
   with `applied_steps_count = 0`; the other **12** carry prose from the 2026-06-20
   schema audit. So "has logs" is not one phenomenon but two.
2. **The 2026-06-20 audit touched 12 rows, of which 11 share the microsecond.** Eleven
   carry `Reconciled by schema audit 2026-06-20: … (equivalent to prisma migrate resolve
   --applied)` at `03:15:16.662615Z`; the twelfth, `20260918000000_enable_rls_manual_tables`,
   carries `Applied via schema audit 2026-06-20: enabled RLS on 9 out-of-band tables` at
   `03:23:45.319623Z` — it actually ran DDL, which is why its timestamp differs.
3. **There is a third name-prefix collision:** `20260702000000` (`_add_admin_mfa_lockout`
   and `_add_admin_mfa_rate_limit`), alongside the two listed. The CI workflow already
   names this one as a known defect class (`.github/workflows/ci.yml:162`).

**Precedent worth naming:** those 12 rows are hand-written reconciliation, not CLI
output — `logs` says so explicitly. Raw-SQL reconciliation of this table is an
established practice in this repository. That is context for §7.6, **not** a licence for
an agent session to write production; the owner's instruction is that the read-only
designation stands and reconciliation is run by a human with a real `DATABASE_URL`.

## 7.6 Re-baseline, or keep patching?

13 of 67 rows are already resolve-only. §5.1 would add 29 more, taking the ledger to
**42 of 96 rows** (`applied_steps_count = 0`) that assert an application which never ran
against this database — plus the 12 hand-written rows that claim
`applied_steps_count = 1` without having run either. **54 of 96 rows would be attestation
rather than record.** That is the honest framing of the question.

### Option A — patch: resolve the 29, realign the 6 checksums

- **Migration count:** 99 directories, 96 recorded, 3 gated pending. Unchanged shape.
- **Blast radius:** the `_prisma_migrations` table only. No schema change, no DDL, no
  application behaviour. Reversible by deleting 29 rows and restoring 6 checksum values —
  both single statements, and the pre-change snapshot exists.
- **CI empty-DB chain job:** **unaffected.** The job provisions a fresh `postgres:16.4`,
  asserts zero `public` tables, then runs `prisma migrate deploy` from empty
  (`ci.yml:145-160`). It builds its own ledger, so it computes checksums fresh and can
  never observe the production ledger's staleness. It is green today and stays green.
- **Cost:** leaves 54/96 rows as attestation. The §5.3.2 hazard is unchanged — the next
  `migrate deploy` targets exactly the 3 gated migrations.

### Option B — revert the six file edits

- **Migration count:** unchanged.
- **Blast radius:** **breaks CI.** `f2032cf` and `599b5a8` exist precisely to make the
  chain build from zero; the CI job exists precisely to gate that
  (`ci.yml:85-92`: *"`prisma migrate deploy` failed at migration 22 of 94 on a fresh
  provision"*). Reverting restores checksum agreement by reintroducing the defect the
  gate was built to catch.
- **CI empty-DB chain job:** **goes red.**
- **Verdict: disqualified.** It trades a working chain for tidy metadata.

### Option C — re-baseline against current production schema

- **Migration count:** 99 → **1** baseline (generated from live schema), plus whatever
  follows. A ~98-file archive.
- **Blast radius:** **highest, and it dissolves the compliance boundary.** A baseline
  generated from *current production* necessarily contains
  `e_sign_envelope_history`, the seven gated `e_sign_envelopes` columns, and
  `ai_action_intents` — because §4 established they are physically present. Re-baselining
  would absorb all three owner-gated migrations into an "already applied" baseline,
  silently converting the deliberate exclusion in §5.2 into a fait accompli. §4 records
  that the boundary's defence-in-depth is already down from two layers to one
  (`ESIGN_EXECUTED_ARTIFACT_ENABLED`); this would remove the paper trail as well.
- **CI empty-DB chain job:** survives mechanically but **loses its purpose.** It would
  validate that one squashed file applies to an empty database — which is nearly
  tautological — instead of that 99 historical migrations apply in order. The
  "migration 22 of 94" defect class becomes undetectable. The `migrations/*.sql` CRM
  runbook steps (`ci.yml:183-198`) are unaffected either way.
- **Verdict: rejected**, primarily on the compliance-boundary point, secondarily on
  losing the chain gate.

### Recommendation — one, not a menu

> **Take Option A. Resolve the 29 and realign the 6 ledger checksums to the current
> files. Do not re-baseline, and do not revert the file edits.**

Reasoning, in order:

1. **Re-baselining is disqualified on compliance grounds, not on effort.** Any baseline
   taken from current production swallows the three gated migrations. Until the owner has
   deliberately decided the e-sign boundary is over, re-baselining decides it by accident.
2. **The chain has real, currently-enforced value.** CI proves 99 migrations build a
   database from zero and that the result does not drift from `schema.prisma`. That is a
   stronger guarantee than a squashed baseline, and it was expensive to earn.
3. **Realign checksums toward the files, not the files toward the checksums.** The edited
   files are the *correct* SQL — they are what makes the chain work from zero, and they
   are idempotent. The ledger checksum records "what we ran"; production already has the
   objects either way. Making the ledger agree with the repo is the change that makes
   `migrate status` usable again.
4. **54/96 attestation rows is a real cost, and Option A does not fix it.** It is
   accepted deliberately: the alternative that *would* fix it is Option C, and Option C
   costs the compliance boundary. Revisit re-baselining only after the owner has settled
   the e-sign gate (§4) — at that point it becomes a clean decision rather than a
   side effect.

## 7.7 The consolidated write — for an owner with a real `DATABASE_URL`

Fixes the checksums and the unrecorded rows together. `20261014` / `20261015` /
`20261016` stay excluded in both forms. **Neither has been executed.**

**Take a snapshot first** (§5.3.4). One statement, and it is the whole undo:

```sql
CREATE TABLE _prisma_migrations_backup_20260831 AS SELECT * FROM _prisma_migrations;
```

### 7.7.1 SQL — single atomic statement, guarded

Guards abort the whole block rather than leaving a partial state. Substitute the real
checksums (`sha256sum frontend/prisma/migrations/<name>/migration.sql`) for the six
`<sha256-of-…>` placeholders; the 29 `INSERT` checksums must be generated the same way.

```sql
DO $reconcile$
DECLARE before_ct int; after_ct int; upd_ct int; ins_ct int;
BEGIN
  SELECT count(*) INTO before_ct FROM _prisma_migrations;
  IF before_ct <> 67 THEN
    RAISE EXCEPTION 'ledger not at verified baseline 67, found %', before_ct;
  END IF;

  IF EXISTS (SELECT 1 FROM _prisma_migrations WHERE migration_name IN (
      '20261014000000_esign_envelope_history',
      '20261015000000_esign_consent_and_executed_artifact',
      '20261016000000_ai_action_intent_lifecycle')) THEN
    RAISE EXCEPTION 'an owner-gated migration is already recorded — stop and investigate';
  END IF;

  -- (a) Realign the six stale checksums to the current repo files.
  UPDATE _prisma_migrations SET checksum = v.sum
  FROM (VALUES
    ('20260507000000_add_prequal_consent_accepted_at',   '<sha256-of-file>'),
    ('20260702000000_add_admin_mfa_rate_limit',          '<sha256-of-file>'),
    ('20260703000000_add_admin_pending_recovery_codes',  '<sha256-of-file>'),
    ('20260703000000_add_pending_recovery_codes',        '<sha256-of-file>'),
    ('20260801000005_affiliate_onboarding',              '<sha256-of-file>'),
    ('20260911000000_add_acquisition_system',            '<sha256-of-file>')
  ) AS v(name, sum)
  WHERE _prisma_migrations.migration_name = v.name;
  GET DIAGNOSTICS upd_ct = ROW_COUNT;
  IF upd_ct <> 6 THEN RAISE EXCEPTION 'updated % checksums, expected 6', upd_ct; END IF;

  -- (b) Record the 29 verified-present migrations. One row per §5.1 entry.
  INSERT INTO _prisma_migrations
    (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
  VALUES
    (gen_random_uuid(), '<sha256-of-file>', now(), '20260828000000_dealer_invitation_token_hash',
     'Reconciled per MIGRATION-LEDGER-RECONCILIATION.md 5.1: objects verified physically present; equivalent to prisma migrate resolve --applied.',
     NULL, now(), 0)
    -- … the remaining 28 rows from the §5.1 list, same shape …
  ;
  GET DIAGNOSTICS ins_ct = ROW_COUNT;
  IF ins_ct <> 29 THEN RAISE EXCEPTION 'inserted % rows, expected 29', ins_ct; END IF;

  SELECT count(*) INTO after_ct FROM _prisma_migrations;
  IF after_ct <> 96 THEN RAISE EXCEPTION 'post-write count %, expected 96', after_ct; END IF;

  RAISE NOTICE 'ledger reconciled: % -> % (% checksums realigned, % rows recorded)',
    before_ct, after_ct, upd_ct, ins_ct;
END
$reconcile$;
```

`applied_steps_count` is set to **0**, which is what `migrate resolve --applied`
records — deliberately *not* the `1` the 2026-06-20 rows used, so these rows are honest
about never having run a step.

**Undo:**

```sql
DELETE FROM _prisma_migrations WHERE migration_name IN ( /* the 29 names */ );
UPDATE _prisma_migrations m SET checksum = b.checksum
  FROM _prisma_migrations_backup_20260831 b
 WHERE b.migration_name = m.migration_name AND m.migration_name IN ( /* the 6 names */ );
```

### 7.7.2 Prisma CLI — covers the 29 only

```bash
# From frontend/. Export the production URL once; do not paste it into shell history.
#   export DB="postgresql://…"
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

> **Prisma has no command that repairs a checksum.** `migrate resolve` only takes
> `--applied` and `--rolled-back`; neither rewrites the stored checksum of a row that is
> already applied. The `--rolled-back` → `--applied` pair is *not* a substitute: it leaves
> a rolled-back row behind and, between the two commands, a `migrate deploy` would attempt
> to **re-run** the migration against production. **Step (a) must be the SQL `UPDATE`.**
> Run (a) first, then this loop, or run the single statement in §7.7.1 — do not run this
> loop and leave the checksums for later.

### 7.7.3 Verification after the write

```bash
DATABASE_URL="$DB" DIRECT_URL="$DB" pnpm exec prisma migrate status
```

Expected: **96** ledger rows, **0** unfinished, **0** rolled back, **no** "modified after
applied" report, and exactly **three** pending —
`20261014000000_esign_envelope_history`,
`20261015000000_esign_consent_and_executed_artifact`,
`20261016000000_ai_action_intent_lifecycle`.

**§5.3.2 still applies, and matters more once status is clean:** the next
`migrate deploy` would target exactly those three, all effectively idempotent, and would
record them as applied — flipping the compliance boundary in the ledger as a near-no-op.
**`ESIGN_EXECUTED_ARTIFACT_ENABLED` remains the enforcement mechanism. The ledger cannot
hold that line.**

## 7.8 What this session did not do

- **No production write of any kind.** No `INSERT`, `UPDATE`, `DELETE`, or DDL. The
  Supabase MCP was used read-only, per `.claude/MCP_INVENTORY.md:27`.
- **No `prisma migrate` command was run** — not `resolve`, not `deploy`, not `status`.
  No production `DATABASE_URL` exists in this environment.
- **The three gated migrations were not touched**, recorded, or reasoned about beyond
  confirming their objects are still present (§7.2) and that no editing commit reached
  them (§7.3.1).
- **The six stale checksums were not repaired**, and the files were not reverted.
- **Attribution was not established.** §7.3.1 narrows the window and names the only
  available lead; identifying the operator needs Supabase logs for
  2026-08-29T22:58Z → 2026-08-31, which were not queried.
