---
name: autolenis-social-analytics-and-attribution
description: Measures AutoLenis social performance and ties content to real business outcomes — impressions, reach, views, watch time, completion, engagement, CTR, follower growth, leads, buyer requests, dealer applications, refinance leads, appointments, deposits, revenue, cost-per-lead, conversion, content-assisted conversion, and campaign/platform ROI. Associates performance with campaign, post, platform, landing page, UTM params, contact, lead, buyer request, dealer prospect, and conversion event via the existing SocialPerformance/ContentAttribution/RevenueAttribution/SocialLead models. Rejects vanity-only reporting. Use for social analytics, attribution, and ROI work.
---

# AutoLenis Social Analytics & Attribution

## Purpose & authority
Owns social measurement and attribution against the **existing** attribution stack. Reuse
`SocialPerformance`, `ContentAttribution`, `RevenueAttribution`, `SocialLead`, `CreatorAttribution`
and the attribution service — do not build a parallel analytics store.

## Existing architecture to extend — READ BEFORE WRITE
- `lib/social/attribution.service.ts` + `attribution-hook.ts` + `analytics-mapping.ts`;
  public capture `app/api/public/social-click`; internal `app/api/internal/social-attribution`
  (fail-closed auth, exact-equality secret compare — SOCIAL_ENGINE_AUDIT).
- Analytics sync: `app/api/cron/social-analytics-sync` passes `post.platform` to `getAnalytics` so
  Facebook posts are not misrouted to Instagram. Provider `getAnalytics` checks `res.ok`.
- Models: `SocialPerformance`, `ContentAttribution`, `RevenueAttribution`, `SocialLead`,
  `CreatorNetwork`/`CreatorAttribution`, `SearchIntelligence` (GSC), `MarketplaceIntelligence`.

## Metrics
Impressions · reach · views · watch time · completion rate · engagement rate · CTR · follower
growth · leads · buyer requests · dealer applications · refinance leads · appointments · deposits ·
revenue · cost per lead · conversion rate · content-assisted conversion · campaign ROI · platform ROI.

## Attribution rules
1. **Require ≥1 post-identifying UTM** (`utm_campaign`/`utm_content`/`utm_hook`) before matching a
   click/lead to a post — never collapse to "most recent PUBLISHED" (fixed defect; keep it fixed).
2. **Platform hint required** on analytics sync to route metrics to the correct platform surface.
3. Tie performance to campaign · post · platform · landing page · UTM · contact · lead · buyer
   request · dealer prospect · conversion event — down to deposits/revenue, not just vanity metrics.
4. Internal/attribution endpoints stay **fail-closed** (deny when the secret is unset).

## Prohibited behavior
Vanity-only reporting; attributing without a post-identifying UTM; misrouting cross-platform
metrics; failing open on the attribution endpoint; inventing a second analytics store.

## Testing & acceptance criteria
Attribution-matching tests (UTM required), platform-routing tests, fail-closed auth tests,
revenue-linkage tests. Done = performance ties to real outcomes with correct, auditable attribution.

## Cross-skill links
`autolenis-social-media-command-center` · `-content-strategy` · `-content-calendar`;
`autolenis-observability-sre` · `autolenis-accessibility-performance-seo` (SEO/GSC) ·
`autolenis-payments-and-ledger` (deposit/revenue linkage).
