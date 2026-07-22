---
name: autolenis-dealer-lead-scoring
description: Scores dealer prospects on transparent, non-discriminatory criteria — geographic + franchise relevance, inventory/used-vehicle volume, digital maturity, active website/YouTube/social, review volume + recency, dealer-group size, identified decision-maker, verified phone + business email, AutoLenis buyer demand nearby, prior outreach/response, existing relationship, and suppression status. Stores overall score + components + model version + calculated date + supporting evidence. Never uses protected-class characteristics. Extends the existing scoring services (acquisition/scoring, DealerIntelligence, LeadScore). Use to prioritize which dealers to contact.
---

# AutoLenis Dealer Lead Scoring

## Purpose & authority
Ranks prospects transparently to prioritize outreach. Extends `lib/services/acquisition/
scoring.service.ts`, `lib/services/crm/lead-action-scoring.service.ts`, `DealerIntelligence`
(density/inventory signals), and `LeadScore` — not a new scoring store.

## Scoring factors
Geographic relevance · franchise relevance · inventory volume · used-vehicle volume · digital
maturity · active website · active YouTube · social activity · online reviews · review recency ·
dealer-group size · identified decision-maker · verified phone · verified business email · AutoLenis
buyer demand near the dealership (from `MarketIntelligence`/`DealerIntelligence`) · prior outreach ·
prior response · existing relationship · suppression status.

## Stored per score
Overall score · score components (explainable) · scoring-model version · calculated date ·
supporting evidence.

## Core rules
1. **No protected-class characteristics** (race, ethnicity, religion, sex, national origin, age,
   disability, etc.) — ever, directly or by proxy.
2. **Explainable + versioned.** Every score carries its components, model version, and evidence so
   ranking is auditable and reproducible; recompute on a versioned model change.
3. Suppressed/`DEAD` prospects are de-prioritized/excluded, not silently re-surfaced.

## Prohibited behavior
Protected-class inputs or proxies; opaque/unversioned scores; scoring without evidence; using score
to bypass verification or outreach governance.

## Testing & acceptance criteria
Confidence/score-component, model-version, and evidence-capture tests; a guard test asserting no
protected-class field feeds the model. Done = transparent, versioned, non-discriminatory scores.

## Cross-skill links
`autolenis-dealer-prospecting-orchestrator` · `-contact-verification` ·
`-dealer-database-ingestion` · `-dealer-outreach-governance`.
