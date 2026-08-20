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
| 2 | `20261005000000_phase5_block3_credit_application` | B3 | Table `credit_applications` (guarded status machine; PII columns store AES-256-GCM ciphertext only) + enum `CreditApplicationStatus`. FKs → `deals` (CASCADE), `buyers` (RESTRICT). RLS deny-all. **Requires `FINANCING_ENCRYPTION_KEY` (64-char hex) in prod env.** |

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
```

