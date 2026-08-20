# Phase 5 — pre-merge / pre-live `prisma migrate deploy` list

**Why:** the Vercel build runs `prisma generate && next build` — it does **NOT** run migrations.
Every Phase 5 migration below must be applied to production with `prisma migrate deploy` **before**
the corresponding code is live. All are additive/nullable-first; enums are append-only
(`ALTER TYPE ADD VALUE`); no new FK is made required in the migration that adds it; new tables are
RLS deny-all. Each carries a rollback block (in the migration file) and a verification query below.

```bash
cd frontend && pnpm exec prisma migrate deploy
```

> **Note on prod ledger:** prod's `_prisma_migrations` has historically been maintained partly
> out-of-band (it trails the repo). Apply these via `migrate deploy` (or the raw SQL + `migrate
> resolve --applied`) and confirm with the verification queries — do not trust the ledger alone.

## Migrations to apply (in order)

| # | Migration | Block | What it adds |
| - | --- | --- | --- |
| 1 | `20261004000000_phase5_block1_rules_audit` | B1 | Tables `compliance_rules` (injected regulatory content — empty by default; partial-unique one ACTIVE per `rule_type`) and `financing_audit_events` (hash-chained, append-only via block UPDATE/DELETE/TRUNCATE trigger). Enums `ComplianceRuleType`, `ComplianceRuleStatus`, `FinancingAuditActorType`, `FinancingAuditEventType`. Both RLS deny-all. |
| 2 | `20261005000000_phase5_block3_credit_application` | B3 | Table `credit_applications` (guarded status machine; PII columns store AES-256-GCM ciphertext only) + enum `CreditApplicationStatus`. FKs → `deals` (CASCADE), `buyers` (RESTRICT). RLS deny-all. **Reuses the existing `PREQUAL_ENCRYPTION_KEY` (64-char hex) already in prod env — no new key required** (financing PII and prequal consumer-report PII are the same security domain and share one platform key). |
| 3 | `20261006000000_phase5_block4_review_queue` | B4 | Table `financing_review_tasks` (human-in-the-loop stip/adverse-action/decline queue) + enums `FinancingReviewTaskType`, `FinancingReviewTaskStatus`. FK → `credit_applications` (CASCADE). RLS deny-all. |
| 4 | `20261007000000_phase5_credit_app_one_active_per_deal` | B5 | Partial-unique index `credit_applications_one_active_per_deal` on `(deal_id) WHERE status <> 'WITHDRAWN'` — at most one non-withdrawn credit application per deal (makes the buyer `apply` route idempotent against double-submit/retry). Index-only; no table/column/enum change. |

## Post-deploy verification

```sql
-- B1 tables present + RLS enabled
SELECT relname, relrowsecurity FROM pg_class
WHERE relname IN ('compliance_rules','financing_audit_events');

-- B1 append-only triggers present
SELECT tgname FROM pg_trigger WHERE tgrelid = '"financing_audit_events"'::regclass AND NOT tgisinternal;

-- B1 partial-unique (one ACTIVE rule per type)
SELECT indexname FROM pg_indexes WHERE indexname = 'compliance_rules_one_active_per_type';

-- B1 rule slots start EMPTY (no regulatory content shipped in code)
SELECT count(*) AS rule_rows FROM compliance_rules;  -- expect 0 until compliance injects rules

-- B3 table + enum + RLS present
SELECT relname, relrowsecurity FROM pg_class WHERE relname = 'credit_applications';
SELECT enum_range(NULL::"CreditApplicationStatus");
-- B3 PII columns exist and are text (ciphertext), never a plaintext ssn column
SELECT column_name FROM information_schema.columns
WHERE table_name='credit_applications' AND column_name IN ('ssn_encrypted','annual_income_encrypted');
SELECT column_name FROM information_schema.columns
WHERE table_name='credit_applications' AND column_name IN ('ssn','annual_income');  -- expect 0 rows

-- B5 idempotency: one-active-application-per-deal partial-unique index present
SELECT indexname FROM pg_indexes WHERE indexname = 'credit_applications_one_active_per_deal';
```

## De-duplication with the existing prequal subsystem

Phase 5 is the **post-acceptance loan-origination stage** (lender submission, decisioning,
adverse-action, e-sign hand-off). The pre-existing `lib/services/prequal/*` subsystem is the
**affordability / consumer-report stage** (MicroBilt soft pull, `maxOtdAmountCents` budget). They are
distinct lifecycle stages, so the `credit_applications` table + lender adapter + rule-injection +
hash-chained audit are genuinely new. Four cross-cutting concerns were refactored to **reuse** prequal
rather than run in parallel:

1. **Encryption key** — financing PII reuses `PREQUAL_ENCRYPTION_KEY` (above); no `FINANCING_ENCRYPTION_KEY`.
2. **Audit mirroring** — `appendFinancingAuditEvent` best-effort mirrors a non-PII breadcrumb into the
   existing `compliance_events` table (keyed by buyer) so financing decisions appear in the same
   per-buyer compliance timeline as prequal. The tamper-evident `financing_audit_events` chain remains
   the source of truth; the mirror is outside its transaction and never carries PII.
3. **Review-queue surface** — open `financing_review_tasks` are surfaced in the existing
   `/admin/manual-reviews` triage hub (which links to the financing resolve queue), not a wholly
   separate discovery page.
4. **Affordability inputs** — the buyer `apply` route gates on `isPrequalValid` and caps the requested
   amount at the prequal `maxOtdAmountCents`; it does **not** re-underwrite.

### Tracked follow-up (deferred, not a Phase 5 blocker)

Prequal (`lib/services/prequal/prequal.service.ts`) hardcodes FCRA §615 adverse-action text and sends
it inline, whereas Phase 5 financing adverse-action uses the **injected** `ComplianceRule` model
(fail-closed when no rule is populated). This is a deliberate, tracked inconsistency: per decision,
the injected-rule model applies to **financing** adverse-action only; prequal's existing hardcoded
notice is left unchanged for now. A future pass should migrate prequal onto the same injected-rule
model so all regulated notices come from one governed source.

