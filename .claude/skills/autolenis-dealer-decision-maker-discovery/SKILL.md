---
name: autolenis-dealer-decision-maker-discovery
description: Identifies relevant PUBLIC-FACING dealership decision-makers (Dealer Principal, Owner, GM, GSM, Sales/Used/New/Internet-Sales managers, BDC/E-commerce/Digital/Marketing/Finance directors, Controller, Dealer Relations) from approved sources — official staff/leadership pages, public YouTube, press releases, manufacturer announcements, public business/professional profiles, state records, licensed providers. Captures name, current public role, dealership, group, public business phone/email, professional profile, source URL + date, verification date, and confidence + employment-status + contact-status scores. Never fabricates an email or stores an inferred email pattern as verified. Use for decision-maker discovery in the dealer pipeline.
---

# AutoLenis Dealer Decision-Maker Discovery

## Purpose & authority
Finds public-facing decision-makers with evidence and confidence, extending the existing contact
enrichment (`email-enrichment.service.ts` already extracts an Internet Sales Manager identity as a
first-class, provenance-tracked field). Reuse that pattern; do not fork a contacts store.

## Target roles
Dealer Principal · Owner · President · GM · Managing/Operating Partner · GSM · Sales Manager · Used
Car Manager · New Car Manager · Internet Sales Director · BDC Director · E-commerce Director ·
Digital Retail Director · Marketing Director · Finance Director · Controller · Dealer Relations.

## Approved sources
Official staff/leadership pages · public YouTube · public press releases · manufacturer
announcements · public business profiles · state business records · public professional profiles ·
licensed business-info providers (Apollo behind an adapter).

## Captured per person
Full name · current public role · dealership · dealer group · public business phone · public
business email · public professional profile · source URL · source date · verification date ·
confidence score · **employment-status confidence · contact-status confidence**.

## Core rules
1. **Never fabricate an email.** An inferred email pattern may only be stored in a **separate
   unverified-candidate field** and NEVER used for outreach until independently validated
   (mirrors the `emailSource`/`contactSource` = `*_inferred` taxonomy on `DealerProspect`).
2. **Evidence + freshness on every role.** No current-employment claim without a fresh source or
   corroboration; conflicting titles route to `HUMAN_REVIEW_REQUIRED`/`CONFLICTING`.
3. Public-facing business roles only — no personal/home/private data.

## Prohibited behavior
Fabricating a name/role/email; storing inferred email as verified; inferring current employment
without evidence; collecting unrelated private personal data; direct prod writes (use ingestion).

## Testing & acceptance criteria
Manager-extraction, role-extraction, inferred-vs-verified email separation, and conflict-routing
tests. Done = decision-makers captured with evidence + confidence and inferred emails quarantined.

## Cross-skill links
`autolenis-dealer-prospecting-orchestrator` · `-public-business-contact-enrichment` ·
`-contact-verification` · `-youtube-dealer-research` · `-dealer-database-ingestion`.
