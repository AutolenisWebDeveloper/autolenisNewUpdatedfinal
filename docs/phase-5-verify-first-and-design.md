# Phase 5 — Financing / Lender Decisioning — verify-first findings & locked design

Branch: `claude/phase-5-financing-lender-decisioning` (off merged main incl. Phase 4).
Tooling: Superpowers **unavailable** (marketplace not installed) → repo-local fallbacks
(`autolenis-testing-quality-gates`, `autolenis-code-verification`, `autolenis-system-architecture`,
`autolenis-domain-model`, `autolenis-supabase-postgres`, `autolenis-auth-security-privacy`,
`autolenis-deal-lifecycle`, `autolenis-ui-design-system`); **Impeccable** vendored + active.

## Verify-first findings (running code wins)

1. **Financing code — PARTIAL, not greenfield.** Existing: `Financing` (1-per-Deal, `dealId @unique`
   — the *resolved outcome*: path/lender/apr/term/monthly/status), `FinancingScenario` (pre-deal
   payment calculator), `ExternalPreApproval` (+`ExternalPreApprovalDocument`) = buyer brings their
   own lender letter. Enums `FinancingStatus`(PENDING/SELECTED/APPROVED/DECLINED),
   `FinancingPath`(DEALER/EXTERNAL/CASH), `FinancingScenarioType`. Also a separate `refinance`
   lead-gen product (unrelated). **No** credit-application submission, **no** lender adapter, **no**
   decisioning lifecycle, **no** adverse-action/TILA/FCRA, **no** rule-injection layer.
   → **Resolution:** Phase 5's decisioning engine is a NEW `CreditApplication` sub-lifecycle that
   *feeds* the existing `Financing` outcome (updates it on APPROVED) rather than duplicating it.

2. **Deal hook — `DealStatus.FINANCING_PENDING` already exists** (`ACTIVE → FINANCING_PENDING →
   FEE_PENDING`), guarded by `deal.service.ts` `TRANSITIONS` table + pure `canTransition(from,to)` +
   `advanceDealStatus(dealId, status, {force,reason,data})` + `recordStatusTransition`.
   → **Resolution / mismatch with brief:** the brief says "add the financing states to the Deal
   machine." Running code already has the umbrella `FINANCING_PENDING` state and a rich `Financing`
   model. Domain-model invariant = "one status per owning entity." So I DO NOT explode `DealStatus`
   with lender sub-states. Instead the lender decisioning is a **new `CreditApplication` entity with
   its OWN guarded status machine** (same `TRANSITIONS`/`canTransition` idiom, CAS-safe), living
   inside the Deal's `FINANCING_PENDING` window. `FINANCING_PENDING → FEE_PENDING` stays the single
   Deal hop and is gated on the application reaching a terminal-approved state (or external/cash
   path). Recorded here as the verify-first adjustment.

3. **PII encryption — AES-256-GCM pattern exists** in `lib/services/prequal/microbilt.service.ts`
   (`PREQUAL_ENCRYPTION_KEY`, 64-char hex, fail-fast no-default, lazy validation). No generic shared
   helper. → **Resolution:** build ONE canonical `lib/security/field-encryption.ts` (AES-256-GCM,
   same fail-fast discipline, new `FINANCING_ENCRYPTION_KEY`) for Phase-5 SSN/income/employment/DOB.
   Do not refactor microbilt (out of scope). New sensitive tables get RLS deny-all (server-only access).

4. **DocuSign/e-sign — exists** (`lib/services/esign/*`: `createEnvelope/sendEnvelope/
   handleEnvelopeCompleted/voidEnvelope`, `isDocuSignConfigured()`, webhook-driven + idempotent).
   → **Resolution:** signed financing disclosures reuse this adapter; no second e-sign path.

5. **Audit infra — exists.** `AuditLog` (AdminActionType-typed), `AdminAuditLog` (append-only via
   `20260902000000` trigger: block UPDATE/DELETE), `ComplianceEvent` (buyer-scoped, string
   eventType, Json metadata). → **Resolution:** Phase-5 trail = a dedicated **tamper-evident,
   hash-chained, append-only `FinancingAuditEvent`** (mirrors the block-UPDATE/DELETE trigger idiom
   + adds a prev_hash→hash chain), authoritative for every decision/notice/override/rule-applied;
   mirror key events to `ComplianceEvent` for the existing compliance surface.

6. **Admin review queue — exists** (`app/admin/manual-reviews/`, `admin-queue.service.ts`, the
   prequal OFAC manual-review + `SYSTEM_ALERT` idempotent-notification pattern). → **Resolution:**
   the human-in-loop stip/adverse-action queue reuses this idiom (a `FinancingReviewTask` entity +
   an admin page mirroring manual-reviews + the CRM UI kit).

## THE ONE HARD RULE (enforced structurally)
No regulatory content authored/guessed/hardcoded. Every regulated point = an **empty-by-default,
well-tested config slot** (`ComplianceRule` rows, Json content + template body). Engine ENFORCES
whatever it's given; when a rule is absent it **FAILS CLOSED** (no decision, no notice) and flags
for human review. The "RULES NEEDED FROM COMPLIANCE" list is the single artifact for the advisor.

## Block order (each its own reviewable, red-first batch)
1. Rule-injection layer + tamper-evident audit trail (foundation).
2. Lender-integration adapter (pluggable; mock-tested; fail-closed on missing creds).
3. Credit application flow + Deal/CreditApplication guarded state machine + encrypted PII.
4. Human-in-the-loop review queue (stips / adverse-action / edge declines).
5. Application UI (buyer app + admin review queue) — Impeccable + design system.

## Migration discipline
Additive/nullable-first; enums append-only (`ALTER TYPE ADD VALUE`); never a required FK in the
same migration that adds it; RLS deny-all on new tables; each migration has rollback + verification
query; tracked in `docs/phase-5-pre-merge-migrate-deploy.md` and the PR body. Vercel does NOT run
migrations.
