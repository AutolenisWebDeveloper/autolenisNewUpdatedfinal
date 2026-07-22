---
name: autolenis-youtube-dealer-research
description: Researches dealership YouTube channels and videos via the YouTube Data API and public metadata to identify official/dealer-group channels, channel URL/id/name, dealership association, public description + website/phone/email where displayed, upload frequency/recency, subscriber count, content focus, and NAMED public-facing personnel with stated roles — each with an evidence source + timestamp + freshness/confidence score. Never infers current employment from an old video without current corroboration. Use for YouTube-based dealership research within the dealer-prospecting pipeline.
---

# AutoLenis YouTube Dealer Research

## Purpose & authority
Adds YouTube-sourced evidence to dealer prospects using approved mechanisms. Feeds the existing
prospecting pipeline; captures evidence with dates + confidence. **Never assume current employment
from an old video.**

## Approved mechanisms only
YouTube Data API · public channel metadata (About/links) · public video titles/descriptions ·
public captions/transcripts where authorized · official dealership websites/staff pages · public
dealership social profiles · Apollo/licensed enrichment for corroboration. Route the API through a
typed adapter (`autolenis-integrations`). Do **not** scrape YouTube in violation of its terms or
infer private data.

## Captured fields (all with source + timestamp + confidence)
Official channel · dealer-group channel · channel URL/id/name · dealership association · public
description · public website/phone/email where displayed · relevant video URLs · upload frequency ·
recent activity · subscriber count (where available) · content focus · named public-facing personnel
· stated roles · **evidence source · evidence timestamp · freshness score · confidence score ·
verification status**.

## Core rules
1. **Freshness gating.** Employment/role evidence receives a source date, freshness score, and
   confidence; a role from an old video is `CONFLICTING`/`STALE` until current corroboration exists.
2. **Official-channel determination is evidence-based**, not assumed from name similarity.
3. Store personnel identity with provenance mirroring the email/contact taxonomy already used in
   `email-enrichment.service.ts`; never write directly to prod (use the ingestion layer).

## Prohibited behavior
Inferring current employment without corroboration; treating an unofficial channel as official;
scraping YouTube against terms; storing inferred contact info as verified.

## Testing & acceptance criteria
Channel-matching, personnel-extraction, role-extraction, and freshness/confidence-scoring tests.
Done = YouTube evidence attached with dates + confidence and no stale employment claims promoted.

## Cross-skill links
`autolenis-dealer-prospecting-orchestrator` · `-dealer-decision-maker-discovery` ·
`-contact-verification` · `-dealer-database-ingestion`; `autolenis-integrations`.
