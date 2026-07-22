---
name: autolenis-dealer-prospecting-orchestrator
description: Central orchestration skill for AutoLenis dealer discovery and enrichment — coordinates territory selection, dealership discovery, business + website verification, Google Places/Maps and YouTube discovery, decision-maker discovery, public business-contact enrichment, contact verification, deduplication/entity resolution, dealer scoring, database ingestion, human-review queues, outreach eligibility, and follow-up. Uses the EXISTING AMIPS + dealer-recruitment infrastructure (DealerProspect, DealerDiscovery, DealerIntelligence, DealerOutreachLog, lib/services/acquisition/*, lib/services/dealer-recruitment/*) and invokes third-party skills (Apollo, Firecrawl, Sales-Do) as subordinate capability providers only. Use FIRST for any dealer-prospecting/discovery/enrichment task.
---

# AutoLenis Dealer Prospecting Orchestrator

## Purpose & authority
AutoLenis **already has a dealer-intelligence platform (AMIPS)** and a recruitment pipeline. This
skill orchestrates it end-to-end. Third-party skills (Apollo MCP, Firecrawl, Sales-Do, Goose GTM)
are *capability providers*; AutoLenis owns verification, provenance, scoring, dedup, human review,
ingestion, authorization, and outreach eligibility. **Extend — never build a parallel prospecting
app, CRM, or dealer database.**

## Existing architecture to extend — READ BEFORE WRITE
- **Discovery:** `lib/services/acquisition/gemini-maps.service.ts` (Gemini Maps grounding →
  `DiscoveredDealer`), `compound-search.service.ts`, `scoring.service.ts`,
  `unified-buyer-intake.service.ts`, `post-intake-outreach.service.ts`.
- **Enrichment:** `lib/services/dealer-recruitment/email-enrichment.service.ts` (Gemini Search
  grounding; email + contact provenance/confidence taxonomy), `phone-script-drafter.service.ts`,
  `email-template.service.ts`.
- **Outreach:** `dealer-email-send.service.ts`, `dealer-followup.service.ts`,
  `unsubscribe-token.service.ts`, `account-claim.service.ts`, `prospect-claim.service.ts`.
- **Models (`prisma/schema.prisma`):** `DealerProspect` (+ provenance: `sourceUrl`, `emailSource`,
  `contactSource`, `contactConfidence`, `contactEnrichedAt`), `DealerOutreachLog`, `DealerDiscovery`,
  `DealerIntelligence`, `MarketIntelligence`, `SearchCache`, `LeadScore`, `DealerProspectStatus`.
- **Crons:** `app/api/cron/dealer-followup`, `dealer-inactive`, `dealer-invitation-reminder`.

## Orchestrated pipeline
Territory selection → dealership discovery → business verification → website discovery →
Places/Maps discovery (authorized) → YouTube discovery → social discovery → decision-maker
discovery → public business-contact enrichment → contact verification → deduplication →
dealer scoring → **database ingestion (via `autolenis-dealer-database-ingestion` only)** →
review queues → outreach eligibility (via `autolenis-dealer-outreach-governance`) → follow-up.

## Core rules
1. **No direct third-party writes.** Apollo/Firecrawl/Sales-Do may research and recommend; only the
   AutoLenis ingestion layer writes production dealer/contact records.
2. **Evidence-based, resumable, idempotent, rate-limited, auditable.** Long-running discovery runs
   as background jobs (never in a synchronous page request), with checkpointing + dead-letter.
3. **Public business info or licensed providers only.** No circumventing auth/paywalls/CAPTCHAs/
   robots/terms; no unrelated private personal data; no fabricated or inferred-as-verified contacts.
4. **Outreach stays disabled by default** until governance, consent, and provider credentials are
   reviewed and explicitly enabled.

## Prohibited behavior
Parallel prospecting system/database/CRM; third-party direct writes to prod records; synchronous
long discovery; auto-launching outreach; storing inferred data as verified.

## Testing & acceptance criteria
End-to-end pipeline tests with mocked providers; idempotency, partial-success, rate-limit, and
resume tests. Done = pipeline runs through the existing models with provenance + human review, and
no outreach fires without governance.

## Cross-skill links
`autolenis-dealership-discovery` · `-youtube-dealer-research` · `-dealer-decision-maker-discovery` ·
`-public-business-contact-enrichment` · `-contact-verification` ·
`-dealer-deduplication-and-entity-resolution` · `-dealer-lead-scoring` ·
`-dealer-database-ingestion` · `-dealer-prospect-review-queue` · `-dealer-outreach-governance`;
`autolenis-dealer-marketplace` · `autolenis-integrations` · `autolenis-communications-consent`.
