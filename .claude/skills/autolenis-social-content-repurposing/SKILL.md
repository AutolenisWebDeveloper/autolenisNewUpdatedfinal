---
name: autolenis-social-content-repurposing
description: Converts approved AutoLenis source content into channel-specific derivatives — YouTube→Shorts/TikTok, transcript→blog/LinkedIn, article→carousel, dealer interview→recruitment content, education article→email sequence, webinar→clips/posts — always preserving source attribution and content lineage via the existing ContentDerivative/ContentRecycling engine. Use when transforming or recycling existing content into new formats or channels.
---

# AutoLenis Social Content Repurposing

## Purpose & authority
Repurposes approved content while preserving lineage. Reuse the existing recycling/recombination
engines and lineage model — never fork a second derivative store.

## Existing architecture to reuse
- `lib/social/content-recycling.engine.ts` (unified on `config.AUTO_PUBLISH_FRANCHISES`; preserves
  source `franchiseId` — keep both), `asset-recombination.engine.ts`, `creator-package.generator.ts`.
- Model: `ContentDerivative` (source→derivative lineage). Media jobs: `AiMediaGeneration`.

## Supported transforms
YouTube video → Shorts/TikTok · transcript → blog article · transcript → LinkedIn post · long-form
article → carousel · dealer interview → recruitment content · education article → email sequence ·
webinar → clips + social posts.

## Core rules
1. **Lineage always.** Every derivative records its source via `ContentDerivative`; recycled posts
   keep the source `franchiseId` (never orphan to `franchiseId: null`).
2. Derivatives re-enter the pipeline as `DRAFT` and pass the quality gate + approval — repurposing
   is not a shortcut around review or the kill switch.
3. Auto-publish eligibility uses the single `config.AUTO_PUBLISH_FRANCHISES` allowlist (no divergent
   local allowlist — fixed defect; keep it fixed).
4. Claim safety carries over: derivatives inherit the source's substantiation constraints.

## Prohibited behavior
Losing source attribution/lineage; orphaning franchise; bypassing quality gate/approval; a second
auto-publish allowlist; fabricating claims in the derived asset.

## Testing & acceptance criteria
Lineage-preservation tests; franchise-preservation tests; derivative re-enters DRAFT + gate. Done =
every derivative is traceable to its source and passes the same governance as originals.

## Cross-skill links
`autolenis-social-media-command-center` · `-content-creator` · `-content-calendar` ·
`-analytics-and-attribution`.
