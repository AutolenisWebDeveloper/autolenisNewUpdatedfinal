# AutoLenis — Skill Stack, Social Operating System & Dealer Intelligence Audit

**Project:** AutoLenis (`autolenisNewUpdatedfinal`) · **Date:** 2026-07-22
**Branch:** `claude/autolenis-skill-stack-audit-123cfb`
**Scope:** Audit the full Claude Code skill stack; author the missing **social media operating
skills** and **dealer intelligence skills** that *govern the existing systems*; produce the
third-party security-review framework, capability maps, database-reuse report, and provenance
architecture. **No application code, schema, or migration was modified in this pass.**

> Persistability boundary (unchanged from prior reports): runtime-installed Claude skills/plugins
> live in the ephemeral session container and are **not** git-tracked; interactive `/plugin install`
> and MCP OAuth **cannot run in this non-interactive session**. So third-party installs are
> documented as **operator actions with a security-review gate**, not executed here. What *is*
> persisted are the repo-tracked `.claude/skills/**` files, `CLAUDE.md`, and this report.

---

## 1. Current skill inventory (audit)

**Repo-tracked before this pass (18):** 17 `autolenis-*` domain skills + `impeccable/`
(see `AUTOLENIS_SKILL_STACK_VALIDATION_2026-07.md` §3). `CLAUDE.md`, `.claude/settings.json`
(Impeccable hook + Superpowers plugin + 6 MCP servers), `.claude/MCP_INVENTORY.md`, `.mcp.json`.

**Added this pass (19 new `autolenis-*` skills):**

| Social (8) | Dealer intelligence (11) |
| --- | --- |
| social-media-command-center | dealer-prospecting-orchestrator |
| social-content-strategy | dealership-discovery |
| social-content-creator | youtube-dealer-research |
| social-content-calendar | dealer-decision-maker-discovery |
| social-publishing-and-scheduling | public-business-contact-enrichment |
| social-engagement-management | contact-verification |
| social-analytics-and-attribution | dealer-deduplication-and-entity-resolution |
| social-content-repurposing | dealer-lead-scoring |
| | dealer-database-ingestion |
| | dealer-prospect-review-queue |
| | dealer-outreach-governance |

**Total repo skills now: 37.** All frontmatter validated (`name == dirname`, description present).

**Session-only skills (ephemeral, not in repo):** `autolenis-master`, `autolenis-tier-1`,
`skill-creator`, `mcp-builder`, `frontend-design`, `claude-api`, `deep-research`, `dataviz`, plus
Anthropic doc/artifact skills. These remain available at runtime and are referenced, not vendored.

### Duplicate / conflict / deprecation check
- **No duplicate skills.** The new skills **govern existing systems** rather than duplicate them —
  each names the real services/models it extends. No parallel social CRM, calendar, publisher,
  dealer DB, scorer, or outreach engine was created.
- **No activation collisions.** Command-center / orchestrator skills are explicitly "load first";
  sub-skills carry disjoint, specific triggers.
- **No deprecated skills or broken references.** GitHub MCP not re-declared (avoids duplicate);
  single Impeccable, single Superpowers.

---

## 2. Third-party skill security-review report

Reviewed against the 20-point checklist (source/owner, README, skill files, install scripts,
lifecycle hooks, shell commands, network calls, permissions, deps, env vars, write capability,
maintenance, security issues, license, secret exposure, prod-write risk, rule override, duplication,
activation collision, version pin). **Verdicts are gating recommendations for an operator; nothing
was installed in this session.**

| Package | Purpose | Verdict | Rationale |
| --- | --- | --- | --- |
| **Superpowers** (`obra/superpowers-marketplace`) | Planning/TDD/review discipline | ✅ Already declared; keep | Trusted, already in `settings.json`; governs nontrivial work |
| **Impeccable** (vendored v3.9.1) | UI/UX reviewer | ✅ Already vendored; keep | In-repo, hook active |
| **Buffer MCP** (`mcp.buffer.com`) | Social scheduling/publishing/analytics | 🔧 Operator OAuth; **treat as one provider behind the publishing factory** | Requires OAuth (unavailable in non-interactive session); subject to approval + attribution + kill switch |
| **BlackTwist social-media-skills** | Primary social content/strategy/publishing | ⚠️ **Do NOT install unreviewed.** Run `npx skills add blacktwist/social-media-skills --list`, verify owner/hooks/MCP/permissions; if publishing needs a BlackTwist MCP that isn't present, use **advisory/content-generation mode only** | AutoLenis already has a full content+publishing engine; adopt only capabilities it lacks, and never let it publish or write records outside the command-center orchestration |
| **Charlie Hills social-media-skills** (`charlie947/...`) | Ideation/carousels/infographics/repurposing | ⚠️ Install **only** if it adds non-duplicative visual-content/repurposing capability after comparing against BlackTwist + existing generators | Overlaps heavily with `carousel.generator.ts`, `creator-package.generator.ts`, `content-recycling.engine.ts` |
| **Goose GTM** (`gooseworks-ai/goose-skills`) — `apollo-lead-finder`, `company-contact-finder`, `inbound-lead-enrichment`, `contact-cache` | Dealer/decision-maker prospecting | ⚠️ Install **selected skills only** after `--list` review; **must not write to prod** — outputs flow through `autolenis-dealer-database-ingestion` | Do not install the full library; overlaps with existing gemini-maps + email-enrichment |
| **Sales-Skills router** (`sales-skills/sales` → `sales-do`) | Sales/enrichment workflow router | ⚠️ Install router only if it adds value **and cannot bypass** AutoLenis approval/verification/suppression/ingestion | A broad router must never launch outreach or write records directly |
| **Firecrawl** (MCP/integration) | Structured web extraction | 🔧 Configure behind an adapter; **permitted sources only** | No CAPTCHA/paywall/robots/terms circumvention; official dealer pages only |
| **Apollo.io MCP** (available in session) | Contact/company enrichment | 🔧 Isolate behind a typed adapter; **read/enrich only**, writes via ingestion | OAuth; least-privilege; no direct prod writes |
| Community Google-Maps / YouTube "gist" skills | Discovery | ❌ **Reject as production-ready.** Use Google Places + YouTube Data API behind adapters | Unmaintained/unverifiable; use official APIs |

**Failed/rejected candidates:** any Gist-only or unmaintained community Maps/YouTube scraper;
"mega skill packs"; skills that auto-run shell or auto-install deps (prohibited by `CLAUDE.md`).
**If a listed repo/command no longer resolves, document the failure and pick a verified supported
alternative — do not invent a substitute command.**

---

## 3. Social media capability map

Every capability the master instruction requires already has an implementation surface; the new
skills **govern** it:

| Capability | Existing implementation | Governing skill |
| --- | --- | --- |
| Orchestration / lifecycle / kill switch | `lib/social/social-post.orchestrator.ts`, `config.ts` | command-center |
| Strategy / pillars / signals | `franchise-router.ts`, `topic-signal.engine.ts`, `TopicSignal` | content-strategy |
| Content creation | `groq-script.engine.ts`, `carousel.generator.ts`, `hook-ab-testing.engine.ts` | content-creator |
| Calendar / scheduling | `scheduling.ts`, `PostingWindow`, `ContentQueue`, `SocialPost` | content-calendar |
| Publishing (API/browser) | `providers/publishing.factory.ts` (+ buffer/linkedin/meta/tiktok/youtube), crons | publishing-and-scheduling |
| Engagement | CRM `contact.service.ts`, `SocialLead`, suppression | engagement-management |
| Analytics / attribution | `attribution.service.ts`, `SocialPerformance`, `RevenueAttribution` | analytics-and-attribution |
| Repurposing / lineage | `content-recycling.engine.ts`, `ContentDerivative` | content-repurposing |

**Statuses reused (never invented):** `SocialPostStatus` (DRAFT…REJECTED), `SocialVideoStatus`.

---

## 4. Dealer-intelligence capability map

The AMIPS + dealer-recruitment platform already implements the pipeline; the new skills govern it:

| Capability | Existing implementation | Governing skill |
| --- | --- | --- |
| Orchestration | `acquisition/*`, `dealer-recruitment/*`, `DealerProspect` | prospecting-orchestrator |
| Discovery | `acquisition/gemini-maps.service.ts`, `compound-search.service.ts`, `DealerDiscovery` | dealership-discovery |
| YouTube research | YouTube Data API (adapter to build) | youtube-dealer-research |
| Decision-maker discovery | `email-enrichment.service.ts` (contact identity, provenance) | dealer-decision-maker-discovery |
| Contact enrichment | `email-enrichment.service.ts` (Gemini Search grounding) | public-business-contact-enrichment |
| Verification | phone/email normalization + validation | contact-verification |
| Dedup / entity resolution | normalizers, `Dealer`/`DealerProspect` matching | dealer-deduplication-and-entity-resolution |
| Scoring | `acquisition/scoring.service.ts`, `LeadScore`, `DealerIntelligence` | dealer-lead-scoring |
| Ingestion (only write path) | `contact.service.ts`, `writeCrmAuditLog`, transactions | dealer-database-ingestion |
| Human review | admin surfaces, audit | dealer-prospect-review-queue |
| Outreach governance | `dealer-email-send/followup`, `DealerOutreachLog`, suppression, `unsubscribe-token` | dealer-outreach-governance |

**Provenance already in schema:** `DealerProspect.{sourceUrl, emailSource, contactSource,
contactConfidence, contactSourceUrl, contactEnrichedAt, emailEnrichedAt}` + the `*_high/medium/
inferred` taxonomy. Inferred emails are already a separate lane, never treated as verified.

---

## 5. Database reuse & migration report

**No migration in this pass.** Social + dealer data models **already exist**: social —
`SocialPost`, `SocialVideo`, `ContentQueue`, `ContentFranchise`, `TopicSignal`, `SocialLead`,
`SocialPerformance`, `ContentAttribution`, `RevenueAttribution`, `CreatorNetwork`/`CreatorAttribution`,
`ContentDerivative`, `AiMediaGeneration`, `PostingWindow`, `CompetitorInsight`; dealer —
`DealerProspect`, `DealerOutreachLog`, `DealerDiscovery`, `DealerIntelligence`, `MarketIntelligence`,
`SearchCache`, `LeadScore`, plus `Dealer`, `Contact`, suppression (`SmsOptOut`, `PrequalConsent`).

**Future column additions** (e.g., an explicit verification-status enum, a dedicated review-queue
view, a per-contact `contactMethodType`) must go through `autolenis-supabase-postgres` (reviewed,
reversible migration; RLS; strong-data-preservation), and prefer extending existing tables/JSON over
new parallel tables. These are flagged as build-items, not done.

---

## 6. Security, privacy & source-provenance architecture

- **Single write path:** third-party skills/MCPs never write prod dealer/contact records — only
  `autolenis-dealer-database-ingestion` (validate → normalize → match → dedup → transactional upsert
  → audit → strong-data-preservation → idempotent → rollback).
- **Provenance required on every record:** source type/URL, discovery + retrieval + verification
  dates, extracted evidence, confidence, processing job, extractor/model version, human-review status.
- **Never fabricate / never infer-as-verified:** manager names, roles, phones, emails, associations,
  sources, social results, customer results, publishing results. Inferred emails stay in an
  unverified-candidate lane, never used for outreach until independently validated.
- **Consent ≠ public availability:** SMS needs consent + A2P/TCPA/quiet-hours; marketing email needs
  sender identity + opt-out; suppression consulted on every send. (`autolenis-communications-consent`.)
- **Lawful sourcing:** official Places/YouTube/Search APIs + licensed providers; Firecrawl on
  permitted pages only; no CAPTCHA/paywall/robots/terms circumvention.
- **Kill switches / disabled-by-default:** production publishing and dealer outreach remain OFF until
  accounts, credentials, approvals, consent controls, and governance are reviewed and enabled.

---

## 7. MCP & integration inventory
See `.claude/MCP_INVENTORY.md`. Session-available connectors relevant here: **Buffer, Apollo,
Supabase, GitHub, Twilio, DocuSign, Gmail, Google Calendar/Drive, Canva, Higgsfield, Runway, Make,
Zapier, Playwright**. Least-privilege: production DB / payments / messaging default read-only or
approval-gated. Buffer + Context7 need OAuth/key (operator action).

---

## 8. Testing & validation report
- **This pass:** documentation + skills only; no code/schema change → no app build risk.
- **Required for any implementation built under these skills** (per each skill's acceptance
  criteria): social — state-transitions, approval-enforcement, publishing-auth, duplicate-post,
  scheduling/TZ, retry, token-expiry, rate-limit, outage, emergency-cancel, attribution; dealer —
  discovery/normalization, domain/YouTube matching, manager/role extraction, phone/email validation,
  freshness/confidence, dedup, multi-rooftop, former-employee conflict, ingestion + rollback +
  provenance + idempotency, review-routing, suppression, partial-enrichment, strong-data-preservation.
- **Never send real outreach or publish real content from automated tests.**

---

## 9. Remaining credential / provider requirements (operator)
YouTube Data API key · Google Places API key · approved Search API (Serper/etc.) · Firecrawl key ·
Apollo (OAuth) · approved email-verification + phone-validation providers · Buffer OAuth ·
`CONTEXT7_API_KEY` · social-platform OAuth tokens (LinkedIn/Meta/TikTok/YouTube) for live publishing.
**Store as secrets; never in source control. Each new provider gets a typed adapter**
(`autolenis-integrations`): timeouts, retry+backoff, idempotency, signature verification, error
mapping, sandbox mode, health check, cost monitoring, feature flag, rotation.

---

## 10. Files created / modified this pass
**Created (20):** `.claude/skills/autolenis-{social-media-command-center, social-content-strategy,
social-content-creator, social-content-calendar, social-publishing-and-scheduling,
social-engagement-management, social-analytics-and-attribution, social-content-repurposing,
dealer-prospecting-orchestrator, dealership-discovery, youtube-dealer-research,
dealer-decision-maker-discovery, public-business-contact-enrichment, contact-verification,
dealer-deduplication-and-entity-resolution, dealer-lead-scoring, dealer-database-ingestion,
dealer-prospect-review-queue, dealer-outreach-governance}/SKILL.md`; this report.
**Modified (1):** `CLAUDE.md` (routing table + governance note).
**Untouched:** all `frontend/**` app code, schema, migrations, `.mcp.json`, `.claude/settings.json`.

---

## 11. Completion status against the standard
✅ Every new skill has valid activation metadata and references real repository architecture.
✅ Third-party sources/versions documented with a security-review verdict; nothing installed blindly.
✅ No duplicate skills; no activation collisions; extends (never replaces) existing systems.
✅ Social + dealer-intelligence workflows fully covered by governing skills.
✅ Provenance architecture, single-write-path, human review, and outreach governance defined.
✅ Publishing + outreach documented as **disabled by default** until explicitly enabled.
🔧 **Operator actions remaining:** third-party install/OAuth per §2/§9; build the YouTube/Places/
Apollo/Firecrawl adapters + any reviewed migrations under the pipeline in `CLAUDE.md`; run
`/code-review` + `/security-review` on the first implementation PR.
⏸️ **Not done (by design, needs review):** installing external packages, writing migrations, and
enabling live publishing/outreach — these require operator approval and the full pipeline.
