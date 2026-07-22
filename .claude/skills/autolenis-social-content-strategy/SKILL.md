---
name: autolenis-social-content-strategy
description: Creates platform-specific AutoLenis social strategies tied to real business objectives — brand awareness, buyer acquisition, dealer recruitment, refinance lead generation, affiliate recruitment, and education (negotiation, dealer fees, financing, Contract Shield, Best Price Report). Defines audience, objective, funnel stage, platform, content pillar, format, CTA, landing page, tracking parameters, cadence, and measurement. Use when planning what to post, why, and how success is measured; pairs with autolenis-social-content-calendar for scheduling and autolenis-social-media-command-center for orchestration.
---

# AutoLenis Social Content Strategy

## Purpose & authority
Turns AutoLenis business goals into measurable, platform-specific content strategy. Strategy MUST
map to the existing funnel and data model (buyer, dealer, affiliate, refinance) and feed the
existing `ContentQueue`/`SocialPost` pipeline — do not invent a parallel planning store.

## Activation
Use for content strategy/planning, content pillars, campaign objectives, funnel mapping, cadence
decisions, and defining measurement criteria for social work.

## Existing architecture to reuse
- Business model & funnel: `autolenis-buyer-journey`, `autolenis-dealer-marketplace`,
  `autolenis-best-price-report`, `autolenis-contract-shield`, `autolenis-payments-and-ledger`.
- Franchise routing & signals: `lib/social/franchise-router.ts`, `topic-signal.engine.ts`,
  `trending-intelligence.engine.ts`, `daily-signal.generator.ts`, `ContentFranchise`/`TopicSignal`.
- Programmatic SEO landing targets: `lib/services/seo/*`, `ContentArticle` (city/state guides) —
  strategy CTAs should point to real landing pages, respecting the noindex boundary for private
  portals (`autolenis-accessibility-performance-seo`).

## Every strategy entry defines
Audience · objective · funnel stage (awareness/consideration/decision/retention) · platform ·
content pillar · content format · call to action · landing page (real URL) · tracking parameters
(UTM: source/medium/campaign/content/hook) · publishing cadence · measurement criteria (the metric
in `SocialPerformance`/`SocialLead`/`RevenueAttribution` that proves it worked).

## Objectives supported
Brand awareness · buyer acquisition · dealer recruitment · refinance lead gen · affiliate
recruitment · education (vehicle shopping, negotiation, dealer/junk fees, financing, Contract
Shield, Best Price Report) · customer success stories · product launches · local/state/city
campaigns.

## Core rules
1. Every strategy line ties to a measurable outcome and a real landing page + UTM scheme that
   `attribution.service.ts` can resolve (require ≥1 post-identifying UTM — see analytics skill).
2. No fabricated claims — savings figures, dealer participation, approval rates, testimonials, and
   market statistics must be substantiated (see `autolenis-social-content-creator` prohibitions and
   FTC substantiation rules). When unproven, frame as educational, not a promise.
3. Dealer-recruitment strategy coordinates with `autolenis-dealer-outreach-governance` and
   `autolenis-communications-consent` — social is top-of-funnel, not a bypass of consent controls.

## Prohibited behavior
Inventing a separate strategy/planning database; promising outcomes AutoLenis cannot substantiate;
setting CTAs to non-existent pages or private noindex portals.

## Testing & acceptance criteria
Strategy artifacts are reviewable, map each objective to a metric + landing page + UTM scheme, and
hand off cleanly to the content calendar. Done = every entry is measurable and substantiated.

## Cross-skill links
`autolenis-social-media-command-center` · `-content-calendar` · `-content-creator` ·
`-analytics-and-attribution`; `autolenis-accessibility-performance-seo`;
`autolenis-dealer-outreach-governance`.
