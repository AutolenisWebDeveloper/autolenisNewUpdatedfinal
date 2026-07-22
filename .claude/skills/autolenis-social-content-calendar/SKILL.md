---
name: autolenis-social-content-calendar
description: Creates and maintains the centralized AutoLenis content calendar on top of the existing ContentQueue/SocialPost/PostingWindow models — platform, account, campaign, pillar, type, title, hook, caption, script, asset requirements, owner, reviewer, approval status, scheduled datetime + time zone, publishing status, platform post id, destination URL, UTM params, audience, location, lead source, performance metrics, repurposing lineage, provider integration, publishing attempts, and failure reason. Supports daily/weekly/monthly/quarterly/campaign/evergreen schedules. Use when scheduling, sequencing, or tracking the state of social content.
---

# AutoLenis Social Content Calendar

## Purpose & authority
The calendar is a **view + lifecycle layer over existing models**, not a new table. Reuse
`ContentQueue` (priority backlog), `SocialPost`/`SocialVideo` (items + status), `PostingWindow`
(scheduling slots), `ContentDerivative` (repurposing lineage), and `SocialPerformance`/`SocialLead`
(metrics/attribution).

## Existing architecture to reuse
- `prisma/schema.prisma`: `ContentQueue`, `SocialPost`, `SocialVideo`, `PostingWindow`,
  `ContentFranchise`, `ContentDerivative`, `SocialPerformance`, `SocialLead`, `AiMediaGeneration`.
- Scheduling logic: `lib/social/scheduling.ts`, `PostingWindow`; franchise routing:
  `franchise-router.ts`. Admin surface: `app/api/admin/social/posts`, `compose`.

## Calendar fields (mapped to existing columns where present)
Platform · account · campaign · content pillar · content type · working title · hook · caption ·
script · asset requirements · owner · reviewer · approval status · scheduled date/time · **time
zone** · publishing status (`SocialPostStatus`) · platform post id · destination URL · UTM params ·
target audience · location · lead source · performance metrics · repurposing relationships · source
content · content lineage · provider integration · publishing attempts · failure reason. Where a
field has no existing column, prefer a typed JSON/metadata extension over a new parallel table, and
only add a column via a reviewed migration (`autolenis-supabase-postgres`).

## Core rules
1. **Time zones are explicit.** Store scheduled time with an explicit zone; never assume server
   local time. Reconciliation (`social-status-sync`) keeps calendar status truthful.
2. Supports daily/weekly/monthly/quarterly/campaign-based/evergreen schedules via `PostingWindow` +
   `scheduling.ts` — do not fork a second scheduler.
3. Every calendar item carries owner, reviewer, and approval status; publishing status is driven by
   the orchestrator, never hand-set to `PUBLISHED`.

## Prohibited behavior
Creating a redundant calendar/schedule table; hand-editing publishing status to skip the lifecycle;
scheduling without an explicit time zone; losing repurposing lineage.

## Testing & acceptance criteria
Scheduling + time-zone tests; status-reconciliation tests; lineage-preservation tests. Done =
calendar reflects true `SocialPostStatus`, schedules resolve correctly across zones, lineage intact.

## Cross-skill links
`autolenis-social-media-command-center` · `-publishing-and-scheduling` · `-content-repurposing` ·
`-analytics-and-attribution`; `autolenis-supabase-postgres`.
