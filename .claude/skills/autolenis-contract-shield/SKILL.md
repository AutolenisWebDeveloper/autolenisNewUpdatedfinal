---
name: autolenis-contract-shield
description: >-
  Authoritative rules for AutoLenis Contract Shield — the junk-fee / packing / disclosure
  scanner that reads a dealer's real signed contract PDF, scores it, and classifies it
  PASS / WARNING / FAIL. Use this skill when working on anything under
  lib/services/contract-shield/, lib/services/contract/, contract scanning, the
  ContractScanRule engine, ContractScanRuleType rules (FEE_CAP, JUNK_FEE_KEYWORD,
  APR_VALIDATION, PAYMENT_PACKING, DISCLOSURE_CHECK, FINANCE_MARKUP), ContractScan /
  ContractVersion / ViolationPatternRecord models, the contract-shield cron, dealer
  violation-pattern tracking, human-review escalation, or the buyer/admin contract-shield
  surfaces. It governs the factual-discrepancy-vs-legal-advice boundary and fail-closed
  behavior.
---

## Purpose & Authority

This skill owns Contract Shield: extracting text from the dealer's uploaded contract,
running the built-in heuristics plus DB-configured `ContractScanRule`s against it, scoring
it, classifying the result, recording versioned scan evidence, tracking repeat dealer
violations, and escalating to human review. It is the source of truth for how contracts are
scored, what counts as a finding, and — critically — the hard line between reporting a
**factual contract discrepancy** and rendering a **legal conclusion**. Where generic advice
would have you "just approve if the parse fails" or "tell the buyer this fee is illegal",
the rules here override: Contract Shield fails closed and never gives legal advice.

## When this skill activates

- Files: `frontend/lib/services/contract-shield/contract-shield.service.ts`,
  `frontend/lib/services/contract-shield/violation-pattern.service.ts`,
  `frontend/lib/services/contract-shield/extract-text.ts`,
  `frontend/lib/services/contract/contract-comparison.service.ts`,
  `frontend/lib/services/contract/contract-upload.service.ts`,
  `frontend/lib/services/dealer/dealer-contract.service.ts` (`scanContractVersion`).
- Routes: `app/api/cron/contract-shield/`, `app/api/admin/contract-shield/**`
  (`[reviewId]`, `rules`, `rules/[ruleId]`), `app/api/buyer/contract-shield/[dealId]/`,
  `app/api/dealer/contracts/upload/`, `app/api/dealer/contracts/upload-file/`,
  `app/api/buyer/deals/[dealId]/contract/download/`,
  `app/api/admin/contracts/[versionId]/signed-url/`.
- Models: `ContractScan`, `ContractScanRule`, `ContractScanRuleHistory`,
  `ContractScanHistory`, `ContractVersion`, `ViolationPatternRecord`.
- Keywords: Contract Shield, junk fee, payment packing, doc fee cap, APR validation,
  finance markup, disclosure, PASS/WARNING/FAIL, contract scan, violation pattern, dealer
  scorecard, human review escalation.

## Architecture & key files

- **Scan pipeline:** `lib/services/contract-shield/contract-shield.service.ts` —
  `scanContract(dealId, contractText, dealerId)` runs built-in heuristics
  (`runBuiltinHeuristics`) then active `ContractScanRule`s, computes a score, classifies via
  `getContractShieldResult`, persists a versioned `ContractScan`, updates
  `Deal.contractShieldScore`/`contractShieldStatus`, tracks violation patterns, and notifies
  the buyer. `overrideContractShield(dealId, adminId, reason)` records an admin PASS override
  as a new scan version.
- **Text extraction:** `lib/services/contract-shield/extract-text.ts` —
  `extractContractText(documentUrl)` pulls the real PDF from the private Supabase bucket
  `dealer-contracts` (or an http URL) via `unpdf`. Empty/image-only extraction (< 20 chars)
  **throws** so the caller fails closed.
- **Version orchestration:** `lib/services/dealer/dealer-contract.service.ts` —
  `scanContractVersion(id)` drives the `ContractVersion` workflow status:
  `UPLOADED → SCANNING → APPROVED` (PASS) or `→ REJECTED` (WARNING/FAIL), and on any
  extraction/scan error resets to `UPLOADED` (retryable). Never auto-approves an unread doc.
- **Violation patterns:** `lib/services/contract-shield/violation-pattern.service.ts` —
  `trackViolationPattern`, `getDealerViolationSummary`, `computeJunkFeeRatio`. Upserts
  `ViolationPatternRecord` (unique `[dealerId, ruleId]`); ≥ `PATTERN_THRESHOLD` (3)
  occurrences flips `flagged` and raises a `SYSTEM_ALERT` notification.
- **Rules (DB-configured):** `ContractScanRule` (`ruleType`, `severity`, `isActive`,
  `config` JSON). `ContractScanRuleType` enum = **`FEE_CAP`, `JUNK_FEE_KEYWORD`,
  `APR_VALIDATION`, `PAYMENT_PACKING`, `DISCLOSURE_CHECK`, `FINANCE_MARKUP`**. Rule edits are
  audited to `ContractScanRuleHistory` (`field`, `oldValue`, `newValue`, `changedBy`).
- **Thresholds & classification:** `lib/constants.ts` — `CONTRACT_SHIELD_PASS_THRESHOLD =
  85`, `CONTRACT_SHIELD_WARNING_MIN = 70`, `CONTRACT_SHIELD_WARNING_MAX = 84`,
  `CONTRACT_SHIELD_FAIL_MAX = 69`. `getContractShieldResult(score)`:
  `≥85 → PASS`, `70–84 → WARNING`, `<70 → FAIL`. Score starts at 100 and is deducted per
  finding, floored at 0.
- **Cron:** `app/api/cron/contract-shield/route.ts` — cron-authenticated batch that scans up
  to 20 `ContractVersion`s in `UPLOADED` status via `scanContractVersion`.

## Core rules & invariants

1. **Scan the real contract, never a placeholder.** Findings come from the actual extracted
   PDF text (`extractContractText`). Do not scan a stub, a summary, or client-supplied text.
2. **Fail closed on unreadable documents.** An empty, image-only, or unfetchable contract
   throws; the caller must treat a throw as "scan could not run" and **never** classify it
   PASS. `scanContractVersion` resets such rows to `UPLOADED` (retryable), never `APPROVED`.
3. **Report factual discrepancies — never legal conclusions.** Every finding is a factual,
   evidence-anchored statement: what value was found, what threshold/expectation it exceeds,
   and a neutral "how to fix" (negotiate down, itemize, decline, remove). Do **not** write
   that a fee is "illegal", "unlawful", "a violation of law", "fraud", or advise the buyer of
   their legal rights or remedies. Contract Shield surfaces facts; it does not practice law.
4. **Score deterministically from findings.** Start at 100, subtract per finding
   (`JUNK_FEE_KEYWORD` severity HIGH −20 / MEDIUM −10 / LOW −5; built-in doc-fee −20;
   add-on packing −18; disclosure-only −8), `Math.max(0, score)`, then classify with
   `getContractShieldResult`. Never hardcode a PASS/FAIL bypassing the threshold function.
5. **Every scan is versioned and evidence-retaining.** Persist a `ContractScan` with an
   incremented `version`, the full `fixList` (found value, expected value, how-to-fix, ruleId),
   `status`, and `scannedAt`. Scans are append-only history — never mutate or delete a prior
   scan; a re-scan is a new version. Mirror to `ContractScanHistory` where used.
6. **Built-in heuristics always run**, independent of DB rules, so common junk-fee patterns
   (doc-fee cap $150, mandatory add-on / packing cap $300, etch/paint/fabric protection) are
   always caught. DB `FEE_CAP` is skipped only when the built-in already flagged that doc fee
   (no double deduction).
7. **Rule changes are authored and audited.** `ContractScanRule` edits go through the admin
   rules routes and must write a `ContractScanRuleHistory` row. Rules are the tuning surface;
   never inline magic thresholds that belong in a rule `config`.
8. **Repeat violations escalate.** `trackViolationPattern` increments per `(dealerId,
   ruleId)`; hitting `PATTERN_THRESHOLD` (3) flags the dealer and raises a `SYSTEM_ALERT`.
   This feeds the dealer scorecard (`computeJunkFeeRatio`) — do not bypass it.
9. **WARNING and FAIL both hold the deal for human review.** Only PASS advances a
   `ContractVersion` to `APPROVED`. WARNING/FAIL → `REJECTED` with the findings as the
   rejection reason; the dealer must fix and re-upload, and/or a `COMPLIANCE_ADMIN` reviews.
   Deal contract stages (`CONTRACT_PENDING → CONTRACT_REVIEW → CONTRACT_APPROVED`) never
   auto-advance past review on a non-PASS scan.
10. **Admin override is explicit and recorded.** A human PASS override
    (`overrideContractShield`) writes a new scan version (score 100, PASS) with the admin id
    and reason — it is an auditable human decision, never a silent flag flip.

## Workflows

### Dealer uploads a contract → automated scan
1. Dealer uploads the PDF to the private `dealer-contracts` bucket; a `ContractVersion` is
   created `status: UPLOADED` with `documentUrl` (bare storage path or http URL).
2. `scanContractVersion(id)` flips `UPLOADED → SCANNING`, calls
   `extractContractText(documentUrl)` (throws on empty/image-only → fail closed).
3. `scanContract(dealId, text, dealerId)` runs built-in heuristics + active
   `ContractScanRule`s, computes score, classifies, persists a versioned `ContractScan`, and
   updates `Deal.contractShieldScore`/`contractShieldStatus`.
4. Terminal: PASS → `ContractVersion APPROVED`; WARNING/FAIL → `REJECTED` with findings as
   `rejectionReason`. Error → reset to `UPLOADED` (retryable next cron pass).
5. `trackViolationPattern(dealerId, fixList)` updates dealer pattern records / raises alerts.
6. Buyer notified: PASS → contract-approved email; WARNING/FAIL → Contract Shield alert email
   with the issue count (factual, no legal characterization).

### Batch / self-healing scan (cron)
- `GET /api/cron/contract-shield` (cron-authenticated) finds up to 20 `UPLOADED`
  `ContractVersion`s and calls `scanContractVersion` on each. Transient failures left as
  `UPLOADED` are retried on the next tick — the manual/backfill path is this same cron.

### Human review & override
- A `WARNING`/`FAIL` (or a scan that couldn't run) is surfaced in the admin Contract Shield
  view (`app/api/admin/contract-shield/[reviewId]`). A `COMPLIANCE_ADMIN` inspects the signed
  contract (`admin/contracts/[versionId]/signed-url`) and the `fixList` evidence, then either
  requires a re-upload or applies `overrideContractShield(dealId, adminId, reason)` — recorded
  as a new PASS scan version.

## Boundaries — do / never

**Do**
- Scan the real extracted PDF text; fail closed when it can't be read.
- Emit factual, evidence-anchored findings (found value, threshold, neutral how-to-fix).
- Classify strictly via `getContractShieldResult` and the constant thresholds.
- Append a new `ContractScan` version every scan; audit rule edits to `ContractScanRuleHistory`.
- Route WARNING/FAIL to human review; record admin overrides with actor + reason.
- Tune detection through `ContractScanRule.config`, using the exact `ContractScanRuleType` enum.

**Never**
- Never auto-approve (or default to PASS) a contract that could not be extracted/scanned.
- Never render a legal conclusion — no "illegal", "unlawful", "fraud", "you have a claim",
  no legal advice or remedies. Report the discrepancy, not its legality.
- Never mutate or delete a prior `ContractScan`; never bypass version history.
- Never hardcode a PASS/FAIL that skips the threshold function or the human-review gate.
- Never add a rule type outside the `ContractScanRuleType` enum, or an unaudited rule edit.
- Never advance the deal's contract stage past review on a non-PASS scan.

## Best practices & examples

A finding is a fact plus a neutral remedy — never a legal judgment:
```ts
// GOOD — factual discrepancy + neutral how-to-fix
fixList.push({
  item: "Documentation fee",
  foundValue: "$399",
  expectedValue: "≤ $150",
  reason: "Documentation fee exceeds the $150 consumer-protection threshold.",
  howToFix: "Negotiate the documentation fee down to $150 or less, or have the dealer remove it.",
  ruleId: "BUILTIN_DOC_FEE_CAP",
});
// NEVER — legal conclusion / advice
// reason: "This fee is illegal and the dealer is violating the law; you can sue."
```

Fail-closed extraction (the caller must not swallow this into a PASS):
```ts
const text = await extractContractText(cv.documentUrl); // throws on empty/image-only
const result = await scanContract(cv.dealId, text, dealerId);
// only PASS → APPROVED; everything else holds for human review
```

Classify only through the constant thresholds — PASS ≥ 85, WARNING 70–84, FAIL < 70 — via
`getContractShieldResult(score)`; never inline the numbers.

## Acceptance criteria

- [ ] Findings scan the real extracted PDF text; unreadable docs fail closed (never PASS).
- [ ] Every finding is factual + neutral; no legal conclusions or advice anywhere in output.
- [ ] Score deducted from 100, floored at 0, classified only via `getContractShieldResult`.
- [ ] Each scan writes a new `ContractScan` version with full `fixList` evidence; history is
      append-only.
- [ ] Rule types stay within the `ContractScanRuleType` enum; rule edits write
      `ContractScanRuleHistory`.
- [ ] WARNING/FAIL routes to human review; PASS is the only auto-`APPROVED` path.
- [ ] Repeat-violation tracking (`ViolationPatternRecord`, threshold 3) is preserved and feeds
      the dealer scorecard.
- [ ] Admin overrides are recorded with actor id + reason as a new scan version.

## Cross-skill links

- `autolenis-master` / `autolenis-system-architecture` — repo-wide standards and the
  service/portal boundaries this scanner lives within.
- `autolenis-domain-model` — `ContractScanRuleType`, `ContractVersionStatus`, `DealStatus`
  and model relations.
- `autolenis-dealer-marketplace` — dealer scorecard, violation patterns, contract upload.
- `autolenis-buyer-journey` — where the contract scan sits in the deal (`CONTRACT_*` stages).
- `autolenis-payments-and-ledger` — the fee/insurance stages preceding contract review.
- `autolenis-auth-security-privacy` — `COMPLIANCE_ADMIN` authorization and private-bucket
  access for human review.
- `autolenis-communications-consent` — buyer Contract Shield alert/approved emails.
