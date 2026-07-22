---
name: autolenis-dealership-discovery
description: Discovers dealerships using approved sources — Search/Places APIs, Google Maps (authorized), manufacturer dealer locators, dealer-group sites, public state license records, directories, and licensed business-data providers — with filters for state/city/ZIP/radius/county/metro/brand/type/inventory/reviews/website/YouTube/social/distance-from-buyers/network-status. Captures the full dealership record (name, DBA, type, brands, address, phone, public email, website, Places id, lat/long, YouTube, socials, affiliations, parent group, source URLs + dates, verification status, confidence). Extends the existing gemini-maps + compound-search discovery, never a parallel scraper. Use when finding dealerships to prospect.
---

# AutoLenis Dealership Discovery

## Purpose & authority
Finds dealerships via approved sources and writes into `DealerProspect`/`DealerDiscovery` with
provenance. Extends `lib/services/acquisition/gemini-maps.service.ts` and
`compound-search.service.ts` — do not add a raw Google-SERP or YouTube scraper.

## Existing architecture to extend
- `gemini-maps.service.ts` → `DiscoveredDealer` (uses Maps grounding + `groundingChunks` for source
  provenance/confidence). `compound-search.service.ts`, `scoring.service.ts`, `SearchCache`
  (dealer_discovery cache), `DealerDiscovery`, `DealerProspect`, `DealerIntelligence`.
- Approved integrations to route through typed adapters (`autolenis-integrations`): Google Places
  API, an approved Search API (Serper/etc.), Firecrawl for structured extraction of official pages.

## Discovery filters
State · city · ZIP · radius · county · metro · franchise brand · independent · new/used · dealer
group · inventory size · review volume · rating · website availability · YouTube presence · social
presence · distance from target buyers · AutoLenis network status.

## Required dealership fields (map to DealerProspect/DealerIntelligence + provenance)
Legal/operating name · DBA · dealer type · franchise brands · street/city/state/ZIP/county · main
phone · public business email · website · Google Places id (authorized) · lat/long · YouTube channel
· social profiles · manufacturer affiliations · parent dealer group · **source URLs · source dates ·
verification status · confidence score**.

## Core rules
1. **Approved sources only.** Use Places/Search APIs and licensed providers; use Firecrawl only on
   permitted official pages. Never scrape Google SERPs directly or violate robots/terms.
2. **Provenance on every record** (source type, URL, retrieval date, confidence). Discovered records
   start at `DISCOVERED` and flow through verification before any outreach.
3. Cache via `SearchCache` (respect TTL) to control cost + rate limits; run as background jobs.

## Prohibited behavior
Direct SERP/YouTube scraping; bypassing robots/terms/paywalls/CAPTCHAs; fabricating dealership
fields; storing discovery output straight to production without verification + ingestion.

## Testing & acceptance criteria
Discovery normalization, source-provenance capture, filter, and cache/rate-limit tests. Done =
dealerships discovered from approved sources with provenance, ready for verification.

## Cross-skill links
`autolenis-dealer-prospecting-orchestrator` · `-public-business-contact-enrichment` ·
`-contact-verification` · `-dealer-deduplication-and-entity-resolution` ·
`-dealer-database-ingestion`; `autolenis-integrations`.
