# Social Engine — Production-Readiness Audit & Remediation

Comprehensive audit of the AutoLenis Social Engine (cron pipeline, engine/service
libraries, external provider integrations, admin API + dashboard, and public/internal
endpoints) against Fortune-500 fintech production standards.

Scope audited:
- 10 social cron routes (`app/api/cron/social-*`) + `vercel.json` schedule cross-check
- 30 engine/service/generator libs (`lib/social/*`)
- 13 provider integrations (`lib/social/providers/*`)
- 33 admin/public/internal API routes (`app/api/admin/social/*`, `app/api/public/social-*`, `app/api/internal/social-attribution`)
- Admin dashboard + intelligence UI

Baseline after remediation: `tsc --noEmit` clean, `eslint` clean on all touched files,
`lib/social` test suite green.

---

## Fixes applied

### Security

| # | Area | Issue | Fix |
|---|------|-------|-----|
| 1 | `internal/social-attribution` | Auth **failed open** — when `CRON_SECRET` was unset the endpoint was fully public; also used permissive `auth.endsWith(secret)` (a `"<x><secret>"` token passed) | Fail-closed (deny + 500 when secret unset); exact-equality compare accepting `Bearer <secret>` or a bare secret |
| 2 | `admin/social/media` | Returned **HTTP 200 + empty list on unauthenticated** request (auth bypass masked as "graceful degradation") | Returns `401`; empty-list fallback reserved for DB errors only, matching the posts route |
| 3 | `retargeting.service` | Meta `access_token` passed in the **GET query string** (leaks to proxy/CDN logs) | Token moved to `Authorization: Bearer` header |
| 4 | `groq-script.engine` | Retry decision keyed off the model/upstream **response body** substring (`"429"`) — body content could force retries | Retry now branches on the real HTTP **status code** (429 / 5xx) |

### Data integrity & idempotency

| # | Area | Issue | Fix |
|---|------|-------|-----|
| 5 | `social-post.orchestrator` (`publishApprovedPost`) | **Double-publish race**: posts selected `IN (APPROVED, SCHEDULED)` then flipped to `PUBLISHING` non-atomically — an overlapping cron run (5-min schedule, 300s maxDuration) could publish the same post twice to the live platform | Atomic claim via `updateMany` with a status precondition; only the caller that flips the row (`count === 1`) proceeds |
| 6 | `admin/social/ab-tests` POST | Group + N posts + N variants written as **separate awaits** — a mid-loop failure orphaned the group/signal | Wrapped in `prisma.$transaction` (+ top-level error handling) |
| 7 | `cron/social-optimize` | `WinningPattern` `deleteMany` then `createMany` **non-transactional** — a crash between them wiped the table | Single `prisma.$transaction([...])` swap |
| 8 | `cron/social-signal-scan` | Re-runs created **duplicate trending signals**; primary `scanForTopicSignals()` had **no try/catch** (threw 500, skipped trending block) | Dedup against still-live trending signals; primary scan made non-fatal |
| 9 | `admin/social/posts/[postId]/publish` | No status guard — re-queuing a `PUBLISHING`/`PUBLISHED` post caused a duplicate publish | Rejects with `409` for in-flight/live posts (use repost to re-publish) |

### Attribution correctness

| # | Area | Issue | Fix |
|---|------|-------|-----|
| 10 | `attribution.service` + `public/social-click` | With no `utm_campaign`/`utm_content` the lookup collapsed to `{ status: PUBLISHED }` and **mis-attributed to the most-recent post** | Require ≥1 post-identifying UTM before matching |
| 11 | `cron/social-analytics-sync` + Meta provider | Facebook posts whose id lacked an `_` were **misrouted to the Instagram analytics surface** (cron never set the platform hint) | Added optional `platform` to the `getAnalytics` interface; cron passes `post.platform` |

### Reliability (upstream-failure handling)

| # | Area | Issue | Fix |
|---|------|-------|-----|
| 12 | `analytics/analyze`, `analytics/viral-optimize`, `competitor-monitor`, `retargeting` | Groq/Meta `res.ok` **never checked** — error bodies parsed as empty `{}`/`[]` and returned as **success** (e.g. viral-optimize echoed the original content as "optimized"; retargeting over-counted failed uploads) | `res.ok` checks → `502`/logged failure / fallback; upload count only on `2xx` |
| 13 | Providers `runway`, `higgsfield`, `meta` (IG poll) | **No fetch timeout** — a hung upstream blocked the cron worker | `signal: AbortSignal.timeout(...)` on the cron-path / polling fetches (codebase convention) |
| 14 | `market-index.generator` | `JSON.parse` unguarded; `discountPct` could go **negative** when `fairMarketLow > MSRP` | `Math.max(0, …)` clamp |

### Logic correctness & compliance

| # | Area | Issue | Fix |
|---|------|-------|-----|
| 15 | `content-recycling.engine` | Local auto-publish allowlist diverged from `config.AUTO_PUBLISH_FRANCHISES` (2 extra franchises **bypassed review**); recycled posts orphaned with `franchiseId: null` | Unified on the config allowlist; preserve source `franchiseId` |
| 16 | `sms-distribution.service` | Sent to raw `input.phoneNumber` instead of the gate's **normalized E.164** `gate.phone` | Use `gate.phone` |
| 17 | `trending-intelligence.engine` | Google Trends objects stringified to `"[object Object]"` — feed silently always empty | Coerce each item to its title string |
| 18 | `video-learning.engine` | With 3–4 patterns, `slice(0,3)` / `slice(-2)` **overlapped**, listing the same hook as both best and worst | Surface "worst" only when ≥5 patterns |
| 19 | `creator-package.generator` | `status IN (PUBLISHED, APPROVED)` + `publishedAt >= …` made the APPROVED branch **dead** (APPROVED has null publishedAt) | Filter `status: PUBLISHED` only |
| 20 | `admin/social/creators` | **Unbounded** `findMany` (full-table scan) | Pagination (`limit`/`offset`, capped) + network stats from aggregates |

---

## Verified clean (no action needed)
- Cron auth pattern is uniform and correct across all 10 social crons.
- All `SocialPostStatus` / `SocialVideoStatus` string literals match the Prisma enums.
- `vercel.json` schedules all resolve to existing routes; `social-video-generate` and
  `social-lead-nurture` are intentionally event-triggered / disabled.
- Public `social-proof` route is properly anonymized, bounded, and cached.
- Provider retry loops are bounded; factories degrade gracefully to no-op providers.

## Recommended follow-ups (not in this pass)
- Add fetch timeouts to the remaining single-shot provider calls (buffer / linkedin /
  tiktok / youtube / dalle) for full coverage.
- Centralize untrusted-text sanitization (signal / Reddit / quality-feedback) before it
  enters Groq prompts via one shared helper.
- Add rate-limiting to the public `social-click` / `social-proof` endpoints.
- Reconcile the two hashtag-limit systems (`config.PLATFORM_LIMITS` vs `hashtag-builder`)
  onto a single source of truth.
- Gate expensive/mutating admin actions behind `getAdminWithRole(OPERATIONAL_ROLES)`
  rather than authentication alone.
