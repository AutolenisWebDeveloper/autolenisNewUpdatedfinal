---
name: autolenis-dealer-database-ingestion
description: The ONLY path by which verified dealer intelligence is written into AutoLenis production records. Maps into the existing Dealer/DealerProspect/DealerDiscovery/DealerIntelligence/Contact/DealerOutreachLog models — validating, normalizing (names/addresses/phones/domains), matching existing dealerships + contacts, preventing duplicates, preserving source lineage/timestamps/verification status, upserting transactionally, writing audit events, queuing ambiguous records for review, avoiding overwriting stronger verified data, recording previous values, enforcing authorization on every write, and supporting idempotent reprocessing + rollback + partial-failure reporting. No third-party skill may write dealer/contact records except through this layer. Use for any write of discovered/enriched dealer data.
---

# AutoLenis Dealer Database Ingestion

## Purpose & authority
The single authorized write path for dealer intelligence. Reuses existing models — never a parallel
dealer/contact/source table. **No Apollo/Firecrawl/Sales-Do/Goose skill or MCP writes production
dealer or contact records directly; all writes pass through this layer.**

## Existing architecture to reuse
`prisma/schema.prisma`: `Dealer`, `DealerProspect` (+ provenance fields), `DealerDiscovery`,
`DealerIntelligence`, `DealerOutreachLog`, CRM `Contact` (`lib/services/contact.service.ts`), audit
(`lib/services/admin/crm-audit.ts`, `writeCrmAuditLog`). Normalizers: `lib/services/utils/phone`.
Transactions + idempotency: `autolenis-supabase-postgres`.

## Ingestion workflow (transactional)
1 validate source data · 2 normalize names · 3 normalize addresses · 4 normalize phones · 5
normalize domains · 6 match existing dealerships · 7 match existing contacts · 8 prevent duplicates ·
9 preserve source lineage · 10 preserve source timestamps · 11 preserve verification status · 12
insert/update in a transaction · 13 write audit events · 14 queue ambiguous records for review · 15
never overwrite stronger verified data with weaker · 16 record previous values on important-field
changes · 17 enforce authorization on every write · 18 idempotent reprocessing · 19 rollback support
· 20 partial-failure reporting.

## Provenance (required on every record)
Source type · source URL · discovery date · retrieval date · verification date · extracted evidence
· confidence · processing job · model/extractor version · human-review status.

## Core rules
1. **Third-party skills cannot bypass this layer.** They produce candidate data; ingestion decides
   whether/how it persists.
2. **Strong-data preservation.** A weaker/unverified value never overwrites a stronger verified one;
   changes to important fields record the previous value (auditable).
3. **Idempotent + rollback-safe.** Re-running the same batch produces no duplicates; a mid-batch
   failure rolls back its transaction and reports the partial result.
4. **Authorization on every write** (server-side; RLS where applicable — `autolenis-auth-security-privacy`).

## Prohibited behavior
Any direct third-party write to prod dealer/contact records; non-transactional multi-write;
overwriting stronger verified data; dropping provenance; non-idempotent reprocessing; unauthorized writes.

## Testing & acceptance criteria
Database-ingestion, normalization, duplicate-prevention, transaction-rollback, provenance-
preservation, strong-data-preservation, idempotency, partial-enrichment, and human-review-routing
tests (+ RLS tests). Done = verified data lands transactionally with full provenance and no dupes.

## Cross-skill links
`autolenis-dealer-prospecting-orchestrator` · `-contact-verification` ·
`-dealer-deduplication-and-entity-resolution` · `-dealer-prospect-review-queue`;
`autolenis-supabase-postgres` · `autolenis-auth-security-privacy` · `autolenis-domain-model`.
