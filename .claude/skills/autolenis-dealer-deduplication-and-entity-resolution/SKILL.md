---
name: autolenis-dealer-deduplication-and-entity-resolution
description: Prevents duplicate dealerships and contacts and resolves entities across sources — matches dealerships on normalized name/DBA/domain/main-phone/address/Places-id/manufacturer-id/license-id/parent-group/lat-long, and people on name/dealership/role/business-email/business-phone/profile. Handles exact/probable/possible matches, parent-child rooftops, multi-rooftop groups, shared management, mergers, acquisitions, renames, and closures. Never auto-merges ambiguous records — routes uncertain matches to human review. Use before ingestion to avoid duplicates and mis-merges in the dealer database.
---

# AutoLenis Dealer Deduplication & Entity Resolution

## Purpose & authority
Keeps the dealer database clean and correctly linked. Runs before ingestion; ambiguous matches go to
`autolenis-dealer-prospect-review-queue`, never auto-merged. Reuses existing normalization
(`lib/services/utils/phone` for phones; domain/name normalizers) and `DealerProspect`/`Dealer`/
`DealerIntelligence`/`DealerDiscovery`.

## Dealership match signals (combine, weighted)
Normalized name · DBA · website domain · main phone · address · Google/Places id · manufacturer id ·
dealer-license id · parent dealer group · lat/long.

## People match signals
Full name · dealership · role · public business email · public business phone · professional-profile
URL.

## Supported relationships
Exact · probable · possible matches · parent-child rooftop relationships · multi-rooftop dealer
groups · shared management personnel · mergers · acquisitions · renamed dealerships · closed
dealerships.

## Core rules
1. **Never auto-merge ambiguous records.** Only exact/high-confidence matches merge automatically;
   probable/possible route to human review with the candidate pair + evidence.
2. **Preserve the stronger record.** Merges keep verified data over unverified and record previous
   values (no silent overwrite — see ingestion rule "avoid overwriting stronger verified data").
3. **Groups are modeled, not flattened** — a rooftop keeps its parent-group link; shared managers are
   linked, not duplicated.

## Prohibited behavior
Auto-merging low-confidence matches; overwriting verified data with weaker data; collapsing distinct
rooftops; deleting evidence during a merge.

## Testing & acceptance criteria
Duplicate-detection, multi-location-group, rename/merger/closure, shared-management, and
ambiguous-match-routing tests. Done = duplicates prevented, groups preserved, uncertainty reviewed.

## Cross-skill links
`autolenis-dealer-prospecting-orchestrator` · `-contact-verification` ·
`-dealer-database-ingestion` · `-dealer-prospect-review-queue`.
