---
name: autolenis-social-publishing-and-scheduling
description: Governs AutoLenis API-based and approved browser-assisted social publishing — platform auth, OAuth token management + rotation, account selection, scheduling, media upload, platform-specific validation, idempotency + duplicate-post prevention, retry policies, rate-limit handling, failed-post queues, post-status reconciliation, audit logs, human approval, emergency cancellation, provider degradation, feature flags, and kill switches. Nothing publishes automatically unless the account AND campaign are explicitly enabled; preview + approval is the default. Use when touching lib/social/social-post.orchestrator.ts, lib/social/providers/**, or app/api/cron/social-publish-queue / social-status-sync.
---

# AutoLenis Social Publishing & Scheduling

## Purpose & authority
Owns the publish path. Extends the existing orchestrator + provider factory; never adds a second
publisher. **Default = preview + human approval.** Auto-publish only when the franchise is on
`config.AUTO_PUBLISH_FRANCHISES` AND the account+campaign are explicitly enabled.

## Existing architecture to extend — READ BEFORE WRITE
- `lib/social/social-post.orchestrator.ts` — `publishApprovedPost()`: **atomic claim** via
  `updateMany` with a status precondition (`APPROVED/SCHEDULED → PUBLISHING`), only `count === 1`
  proceeds. Reuse this claim for every publish; it is the double-publish guard.
- `lib/social/providers/publishing.factory.ts` + `publishing.provider.ts` — per-platform providers
  (`buffer`, `linkedin`, `meta`, `tiktok`, `youtube`), degrade to no-op on missing creds.
  `providers/http.ts` — shared fetch with timeouts (`AbortSignal.timeout`).
- Crons: `app/api/cron/social-publish-queue` (drains APPROVED/SCHEDULED), `social-status-sync`
  (reconciles platform status back to `SocialPostStatus`). Uniform cron-auth; fail-closed.
- `app/api/admin/social/posts/[postId]/publish` — returns `409` for in-flight/live posts.

## Core rules
1. **Idempotency:** claim atomically, store the platform post id, and dedupe by (post, platform) so
   retries never double-post. Re-queue of a `PUBLISHING`/`PUBLISHED` post → `409`.
2. **Tokens:** OAuth tokens are secrets — server-only, never client-exposed, never in query strings
   (Meta token goes in the `Authorization` header). Support rotation/expiry; a `TOKEN_EXPIRED`
   failure routes to the failed-post queue, not a silent success.
3. **Rate limits & retries:** bounded retries with backoff; on 429/5xx branch on the **HTTP status
   code**, never response-body substrings. Persistent failures land in a failed-post queue with a
   diagnosable reason; never mark `PUBLISHED` on a non-2xx.
4. **Emergency cancellation + kill switch:** an operator can cancel a scheduled/in-flight post and a
   production kill switch halts all live sends; when engaged, the pipeline stays in draft/preview.
5. **Browser-assisted publishing** (Playwright) is allowed only for platforms with an approved,
   supported flow — never to bypass platform restrictions, unsupported APIs, or terms.

## Prohibited behavior
Second publisher; auto-publish without explicit account+campaign enablement; tokens in URLs or on
the client; retry decisions from response bodies; browser automation to circumvent platform limits;
marking `PUBLISHED` without a verified 2xx + platform id.

## Testing & acceptance criteria
Duplicate-post-prevention, publishing-authorization, retry, failed-publish, token-expiration,
rate-limit, provider-outage, emergency-cancellation, and status-reconciliation tests. Done =
atomic + idempotent publish, kill switch honored, failures queued and auditable.

## Cross-skill links
`autolenis-social-media-command-center` · `-content-calendar` · `-analytics-and-attribution`;
`autolenis-integrations` (Buffer/provider adapters) · `autolenis-observability-sre` (DLQ,
reconciliation) · `autolenis-auth-security-privacy` (secret isolation).
