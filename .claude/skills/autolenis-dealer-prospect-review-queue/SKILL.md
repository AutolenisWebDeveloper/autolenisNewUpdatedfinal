---
name: autolenis-dealer-prospect-review-queue
description: Human-review workflow for uncertain dealer records — ambiguous dealership matches, conflicting manager names/titles, stale sources, unverified emails, suspected personal phone numbers, duplicate contacts, former employees, closed dealerships, low-confidence entity matches, and records without adequate provenance. Reviewers can approve, reject, merge, edit, suppress, request re-enrichment, mark stale, mark invalid, or reassign. Use to route and resolve anything the discovery/verification/dedup pipeline flags as uncertain before it becomes outreach-eligible.
---

# AutoLenis Dealer Prospect Review Queue

## Purpose & authority
The human-in-the-loop backstop for the dealer pipeline. Anything uncertain lands here instead of
becoming outreach-eligible or auto-merging. Reuse the existing admin dealer surfaces and audit
(`app/api/admin/*`, `writeCrmAuditLog`); model queue items on existing status/provenance fields
(add a queue view/columns via reviewed migration if needed).

## Routed into review
Ambiguous dealership matches · conflicting manager names · conflicting job titles · stale sources ·
unverified emails · suspected personal phone numbers · duplicate contacts · former employees ·
closed dealerships · low-confidence entity matches · records without adequate provenance.

## Reviewer actions
Approve · reject · merge · edit · suppress · request re-enrichment · mark stale · mark invalid ·
reassign to another reviewer. Every action writes an audit event and updates verification status.

## Core rules
1. **Uncertain never ships.** A record cannot reach `VERIFIED`/outreach-eligible without a reviewer
   decision when flagged; suppression from review is durable.
2. **Every decision is audited** (who, when, action, evidence considered, previous→new values).
3. **Authorization:** review actions require an operational admin role (`getAdminWithRole(...,
   OPERATIONAL_ROLES)`), not read-only support.

## Prohibited behavior
Auto-clearing flagged records; unaudited merges/edits/suppressions; letting read-only roles mutate
review state; resurrecting suppressed/invalid records without justification.

## Testing & acceptance criteria
Human-review-routing, merge/suppress-audit, authorization, and suppression-durability tests. Done =
all flagged records require a reviewer decision, fully audited, correctly authorized.

## Cross-skill links
`autolenis-dealer-prospecting-orchestrator` · `-contact-verification` ·
`-dealer-deduplication-and-entity-resolution` · `-dealer-database-ingestion` ·
`-dealer-outreach-governance`; `autolenis-auth-security-privacy` · `autolenis-observability-sre`.
