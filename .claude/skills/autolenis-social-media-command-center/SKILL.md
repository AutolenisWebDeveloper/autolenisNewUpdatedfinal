---
name: autolenis-social-media-command-center
description: Central orchestration skill for all AutoLenis social media operations — the content calendar, production queues, draft→review→approve→schedule→publish→analyze lifecycle, media-asset management, approval + publishing permissions, lead/campaign attribution, retry/failure handling, audit logs, human override, feature flags, and the production-publishing kill switch. Use this skill FIRST for any social media task, and whenever work touches lib/social/**, app/api/admin/social/**, app/api/cron/social-*, or the SocialPost/ContentQueue/SocialLead/SocialPerformance/ContentAttribution models. It orchestrates the installed third-party social skills (Buffer MCP, BlackTwist/Charlie Hills content skills) as subordinate capability providers and owns all data, permissions, and publishing eligibility.
---

# AutoLenis Social Media Command Center

## Purpose & authority
This is the orchestration authority for AutoLenis social media. AutoLenis **already has a full
Social Engine** (`frontend/lib/social/*` — 30+ engine/service libs, `frontend/lib/social/providers/*`
— 13 providers, `frontend/app/api/admin/social/*` — 33 routes, `frontend/app/api/cron/social-*` —
10 crons, plus an admin dashboard). **Extend it — never build a parallel social CRM, calendar,
queue, or publisher.** Third-party social skills (Buffer MCP, BlackTwist, Charlie Hills) supply
*content-generation and advisory capabilities only*; AutoLenis owns orchestration, data models,
approvals, publishing eligibility, attribution, and audit.

Authority order: existing implementation → `CLAUDE.md` → this skill → generic guidance.

## Activation
Load first for: social strategy/content/calendar/scheduling/publishing/analytics/engagement/
repurposing work; any change under `lib/social/**`, `app/api/admin/social/**`,
`app/api/cron/social-*`, `app/api/public/social-*`; or touching `SocialPost`, `SocialVideo`,
`ContentQueue`, `ContentFranchise`, `TopicSignal`, `SocialLead`, `SocialPerformance`,
`ContentAttribution`, `RevenueAttribution`, `CreatorNetwork`, `AiMediaGeneration`, `PostingWindow`,
`ContentDerivative`, `SocialIntelligenceCache`, `CompetitorInsight`.

## Existing architecture to extend — READ BEFORE WRITE
- **Lifecycle state machine:** `SocialPostStatus` = `DRAFT · PENDING_REVIEW · APPROVED · SCHEDULED ·
  PUBLISHING · PUBLISHED · FAILED · SKIPPED · REJECTED` (`prisma/schema.prisma`). Video:
  `SocialVideoStatus`. Never invent new statuses — reuse these.
- **Orchestrator:** `lib/social/social-post.orchestrator.ts` — `publishApprovedPost()` uses an
  **atomic claim** (`updateMany` with a status precondition; only `count === 1` proceeds) to prevent
  the double-publish race. All new publish paths MUST use this claim pattern.
- **Publishing providers:** `lib/social/providers/publishing.factory.ts` selects per-platform
  providers (`buffer`, `linkedin`, `meta`, `tiktok`, `youtube`); factories degrade to no-op on
  missing credentials. Video: `video-generation.factory.ts` (`runway`, `higgsfield`).
- **Config & gates:** `lib/social/config.ts` — `AUTO_PUBLISH_FRANCHISES`, `PLATFORM_LIMITS`,
  feature flags. `content-quality.gate.ts` scores content before it can advance.
- **Crons (`vercel.json`):** `social-generate`, `social-publish-queue`, `social-status-sync`,
  `social-analytics-sync`, `social-optimize`, `social-signal-scan`, `social-market-index`,
  `social-lead-nurture`, `social-video-generate/queue`. All use the uniform cron-auth pattern.
- **Admin surface:** `app/api/admin/social/*` — gate mutating/expensive actions behind
  `getAdminWithRole(request, OPERATIONAL_ROLES)`, not authentication alone (per SOCIAL_ENGINE_AUDIT).
- **Buffer MCP** is available for cross-platform scheduling; treat it as one provider behind the
  factory, subject to the same approval + attribution rules.

## Core rules
1. **Approval before publish, always.** No `APPROVED → PUBLISHING` transition without a recorded
   human approval unless the post's franchise is on `config.AUTO_PUBLISH_FRANCHISES` AND the account
   and campaign are explicitly enabled for auto-publish. Default is preview + human approval.
2. **Kill switch respected.** A production-publishing flag/kill switch disables all live sends; when
   off, skills operate in advisory/draft mode only and MUST NOT represent output as published.
3. **Idempotent, atomic publishing.** Claim rows atomically; store the platform post id; never
   double-publish. Re-queuing an in-flight/live post returns `409`.
4. **Attribution is first-class.** Every published post carries UTM params and links to
   `ContentAttribution`/`RevenueAttribution`; leads land in `SocialLead` (never a new lead table).
5. **Audit everything.** Approvals, overrides, publishes, failures, kill-switch toggles are logged.

## Prohibited behavior
- Building a parallel social calendar/queue/CRM/attribution store or duplicating the strongest
  third-party content capabilities. Auto-publishing without explicit account+campaign enablement.
- Letting a third-party skill or MCP publish or write social records outside this orchestration +
  approval layer. Representing advisory-mode drafts as live published posts.

## Testing & acceptance criteria
- State-transition, approval-enforcement, publishing-authorization, duplicate-post-prevention,
  scheduling/time-zone, platform-validation, retry, failed-publish, token-expiration, rate-limit,
  provider-outage, and emergency-cancellation tests (extend `lib/social/__tests__`).
- Done = extends the existing engine, respects the kill switch + approval gates, attribution wired,
  audit written, `pnpm typecheck && pnpm lint && pnpm test` green, draft PR opened.

## Cross-skill links
`autolenis-social-content-strategy` · `-content-creator` · `-content-calendar` ·
`-publishing-and-scheduling` · `-engagement-management` · `-analytics-and-attribution` ·
`-content-repurposing`; `autolenis-integrations` (Buffer/Higgsfield/Runway adapters);
`autolenis-communications-consent` (SMS distribution); `autolenis-ai-safety-and-orchestration`
(Groq content-gen guardrails); `autolenis-system-architecture`.
