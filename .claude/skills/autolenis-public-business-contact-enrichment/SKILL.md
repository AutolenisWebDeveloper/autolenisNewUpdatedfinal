---
name: autolenis-public-business-contact-enrichment
description: Enriches dealership and decision-maker records using PUBLIC business-contact information or authorized providers (Apollo/email-verification/phone-validation behind adapters) — main/department/direct business phones, published business email, contact form, public staff profile, official website + socials, public mailing address. Classifies phones (main/sales/internet-sales/BDC/mobile-business/direct/unknown) and emails (published-verified/published-unverified/provider-verified/inferred-unverified/invalid/suppressed). Never collects personal home addresses, family info, private mobiles, unrelated personal emails, or sensitive personal data. Extends the existing Gemini-Search enrichment. Use to enrich dealer contact data.
---

# AutoLenis Public Business-Contact Enrichment

## Purpose & authority
Adds public business-contact data with strict classification + provenance, extending
`lib/services/dealer-recruitment/email-enrichment.service.ts` (Gemini Search grounding; email +
contact source/confidence taxonomy) — not a new enrichment store. Apollo and email/phone
verification providers are reached only through typed adapters (`autolenis-integrations`).

## May collect (business only)
Main dealership phone · published department phone · published direct business line · published
business email · contact form · public staff profile · official website · official social profiles ·
public mailing address.

## Classification
- **Phone:** main · sales · internet sales · BDC · mobile business · direct business · unknown.
- **Email:** published-verified · published-unverified · provider-verified · inferred-unverified ·
  invalid · suppressed. (Maps to the existing `emailSource`/`contactSource`/`contactConfidence`
  fields on `DealerProspect`.)

## Core rules
1. **Inferred ≠ verified.** Inferred emails live in the unverified-candidate lane and are never used
   for outreach until validated by an approved verifier.
2. **Business-only.** Never collect personal home addresses, family info, private mobiles, personal
   emails unrelated to the business role, or any sensitive personal data.
3. **Provenance + validation.** Store source URL/date and validate email format (`EMAIL_REGEX`) and
   phone normalization before persisting; respect enrichment TTL/cache to control cost.

## Prohibited behavior
Collecting private/sensitive personal data; storing inferred contacts as verified; scraping
prohibited sources; direct prod writes (route through ingestion); bypassing provider adapters.

## Testing & acceptance criteria
Phone-classification, email-classification, format-validation, inferred-quarantine, and
PII-exclusion tests. Done = only public business data enters, classified with provenance, inferred
data quarantined.

## Cross-skill links
`autolenis-dealer-prospecting-orchestrator` · `-dealer-decision-maker-discovery` ·
`-contact-verification` · `-dealer-database-ingestion`; `autolenis-integrations` ·
`autolenis-communications-consent` · `autolenis-auth-security-privacy` (PII classification).
