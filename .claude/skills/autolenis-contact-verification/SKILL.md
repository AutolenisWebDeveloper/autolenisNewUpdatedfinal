---
name: autolenis-contact-verification
description: Verifies dealership and contact records before outreach — confirms dealership existence, website-domain association, phone-number association, and public individual↔dealership linkage; evaluates source freshness; detects conflicting titles and former employees; validates email format and (where configured) uses approved email-verification providers; normalizes phone numbers and identifies shared switchboards; assigns confidence + quality scores; records all evidence. Drives the verification status machine (DISCOVERED→ENRICHMENT_PENDING→ENRICHED→VERIFICATION_PENDING→VERIFIED/PARTIALLY_VERIFIED/CONFLICTING/STALE/INVALID/SUPPRESSED/HUMAN_REVIEW_REQUIRED). Use before any dealer record becomes outreach-eligible.
---

# AutoLenis Contact Verification

## Purpose & authority
Gatekeeper between enrichment and outreach eligibility. No dealer/contact becomes outreach-eligible
without passing here. Reuses `DealerProspect` provenance fields and the approved phone/email
providers behind adapters.

## Verification status machine
`DISCOVERED → ENRICHMENT_PENDING → ENRICHED → VERIFICATION_PENDING → VERIFIED | PARTIALLY_VERIFIED |
CONFLICTING | STALE | INVALID | SUPPRESSED | HUMAN_REVIEW_REQUIRED`. Persist as a status field +
evidence; map to/extend `DealerProspectStatus` and provenance columns rather than a parallel enum
where practical (add via reviewed migration — `autolenis-supabase-postgres`).

## Verification requirements
Confirm dealership existence · website-domain association · phone-number association · public
individual↔dealership linkage · evaluate source freshness · detect conflicting titles · detect
former employees · validate email format · use approved email-verification providers where
configured · normalize phone numbers (`lib/services/utils/phone`) · identify shared switchboards ·
detect disconnected/invalid numbers (where authorized) · assign confidence + quality scores ·
record all evidence.

## Core rules
1. **Fail toward review, not outreach.** Conflicts/staleness/low confidence → `CONFLICTING`/`STALE`/
   `HUMAN_REVIEW_REQUIRED`, never silently `VERIFIED`.
2. **Evidence recorded** for every status change (source, date, verifier, result).
3. **Suppressed records stay suppressed** — verification never resurrects a suppressed contact.
4. Verification is a background job; provider calls are timed out, retried with backoff, rate-limited.

## Prohibited behavior
Marking `VERIFIED` without evidence; promoting stale/conflicting data; overriding suppression;
using unapproved verifiers; treating inferred data as verified.

## Testing & acceptance criteria
Domain-matching, phone-normalization, email-validation, source-freshness, confidence-scoring,
former-employee-conflict, and review-routing tests. Done = only evidenced, fresh, non-conflicting
records reach `VERIFIED`; everything else routes to review or suppression.

## Cross-skill links
`autolenis-dealer-prospecting-orchestrator` · `-public-business-contact-enrichment` ·
`-dealer-deduplication-and-entity-resolution` · `-dealer-prospect-review-queue` ·
`-dealer-outreach-governance`; `autolenis-communications-consent` · `autolenis-integrations`.
