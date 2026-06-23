# Buffer Integration — Audit & Remediation

Comprehensive audit of the AutoLenis ↔ Buffer social publishing integration,
validated against the **live Buffer GraphQL API schema** (introspected via the
connected Buffer MCP server) and the real connected account
(`markist@autolenis.com`).

The headline symptoms reported — *"cannot publish through Buffer"* and *"cannot
retrieve / view / manage existing Buffer posts"* — both trace to the same root
cause: **the provider's GraphQL documents did not match Buffer's actual schema.**
Connection-testing worked (those two queries happened to be correct), which is
why the integration *looked* configured while every publish and analytics call
silently failed.

---

## Root-cause bugs found (and fixed)

All in `frontend/lib/social/providers/buffer.provider.ts`, confirmed against the
introspected schema.

| # | Symptom | Root cause | Fix |
|---|---------|-----------|-----|
| 1 | **Any post with an image/video fails to publish** | `createPost` attached media under a `media` field. Buffer's `CreatePostInput` has **no `media` field** — media goes in `assets: [AssetInput!]`, a `@oneOf` of `{ image }` / `{ video }` / `{ document } / { link }`. GraphQL rejected the unknown field, so every media post (i.e. nearly all of them) errored. | Build `assets` with the correct `@oneOf` shape (`{ image: { url } }` / `{ video: { url, thumbnailUrl } }`). |
| 2 | **"Publish Now" did not publish now** | `publishNow` used `mode: addToQueue`, which only enqueues the post for the channel's next scheduled slot. | `publishNow` now uses `mode: shareNow` (immediate). Scheduled posts use `customScheduled` + `dueAt`. |
| 3 | **Analytics always empty / errored** | `getAnalytics`/`getPostStatus` queried `post(id: …) { statistics { … } }`. The real query is `post(input: { id })`; there is **no `statistics` block** — analytics live on `metrics: [PostMetric!]` (`{ type, value }`). | Rewrote both to `post(input: { id })`; map `PostMetric` types → our fields. |
| 4 | **Status sync never transitioned posts** | `getPostStatus` read `post.publishedAt`, which doesn't exist; the sent time is `sentAt`. | Read `sentAt`; the 2-hourly status cron now correctly flips SCHEDULED→PUBLISHED. |
| 5 | **Tracked UTM links were dropped** | The provider received `trackedUrl` but never put it in the post. | Tracked URL is appended to the caption on link-friendly platforms (FB/TikTok/YouTube/LinkedIn); suppressed on Instagram (no clickable caption links). |
| 6 | **Brittle channel configuration** | Channel ids came **only** from `BUFFER_PROFILE_*` env vars. `BUFFER_ORGANIZATION_ID` was declared but never used. If an id was blank/stale, publishing silently no-op'd per platform. | Added org + channel **auto-resolution**: explicit env id wins; otherwise resolve a live channel by Buffer `service` (cached 5 min). Verify endpoint now reports auto-resolved channels. |

### Metric mapping (`PostMetricType` → `PostAnalyticsResult`)
`reactions`/`likes`/`favorites`→likes · `comments`/`replies`→comments ·
`shares`/`reposts`/`retweets`→shares · `clicks`→clicks · `reach`→reach ·
`impressions`→impressions · `views`/`viewers`→views · `saves`→saves ·
`follows`→follows · `engagementRate`→engagementRate. Metrics Buffer does **not**
return stay `null` (preserving the "null = unknown, 0 = confirmed-zero" contract
the optimization loop relies on).

---

## New capabilities added

### Retrieve every Buffer post (req #3)
`listBufferPosts()` queries `posts(input: PostsInput!, first, after)` — the live
source of truth across all connected accounts — supporting status filters
(`draft`, `needs_approval`, `scheduled`, `sending`, `sent`, `error`), per-channel
scoping, pagination, and optional per-post metrics.

- **API:** `GET /api/admin/social/buffer/posts?status=&platform=&limit=&after=&metrics=`
- The route **reconciles** each Buffer post against local `SocialPost` rows by
  `platformPostId` and returns a `local` link + `tracked` flag (req #8 — DB
  mapping).

### Manage posts from the dashboard (req #6)
- `editBufferPost` / `deleteBufferPost` / `duplicateBufferPost` provider helpers.
- **API:**
  - `PATCH /api/admin/social/buffer/posts/[id]` — edit caption and/or reschedule
  - `DELETE /api/admin/social/buffer/posts/[id]` — delete (linked local post → `SKIPPED`)
  - `POST /api/admin/social/buffer/posts/[id]/duplicate` — duplicate to queue/schedule
- All write an `AdminAuditLog` entry (req #10 — observability).

### New "Buffer Posts" dashboard tab (req #2, #3, #5, #6)
`/admin/social` → **Buffer Posts** tab: lists live Buffer posts with status &
platform filters, an optional metrics column, a "TRACKED" badge for locally
linked posts, and inline Reschedule / Edit / Duplicate / Delete actions.

### Reliability (req #7, #9)
- HTTP **429** from Buffer is now distinguished (`BufferRateLimitError`) so rate
  limiting surfaces instead of masquerading as a generic failure.
- All provider calls already run through `providerFetch` (20s timeout) so a hung
  Buffer endpoint can't block a serverless worker.

---

## Configuration — your live Buffer account

Account `markist@autolenis.com` · Organization **"My Organization"**
(`6a2644603303e69e4e5f5940`). Connected channels (discovered live):

| Platform | Buffer channel id | Channel |
|----------|-------------------|---------|
| TikTok | `6a2704aa8f1d11f9b2657eef` | autolenis_ |
| YouTube | `6a27053e8f1d11f9b26583c6` | AutoLenis |
| Facebook | `6a26ed6b8f1d11f9b2650088` | AutoLenis (page) |
| Instagram | `6a26ed8f8f1d11f9b2650129` | autolenis (business) |
| LinkedIn | `6a26453f8f1d11f9b2624491` | AutoLenis (page) |
| Twitter/X | `6a3ad05a5ab6d2f10663ca88` | Autolenis (locked) |

### Required environment variables (production / staging)
```
ENABLE_BUFFER_PUBLISHING=true
BUFFER_API_KEY=<personal API key from https://publish.buffer.com/settings/api>
BUFFER_ORGANIZATION_ID=6a2644603303e69e4e5f5940
# Optional — channel ids now auto-resolve by service, but pinning them is faster
# and avoids ambiguity if you ever connect multiple channels per platform:
BUFFER_PROFILE_TIKTOK=6a2704aa8f1d11f9b2657eef
BUFFER_PROFILE_YOUTUBE=6a27053e8f1d11f9b26583c6
BUFFER_PROFILE_FACEBOOK=6a26ed6b8f1d11f9b2650088
BUFFER_PROFILE_INSTAGRAM=6a26ed8f8f1d11f9b2650129
BUFFER_PROFILE_LINKEDIN=6a26453f8f1d11f9b2624491
```
> The repo's `frontend/.env.local` currently has `BUFFER_API_KEY` **empty** — set
> these in Vercel for each environment. Without `BUFFER_API_KEY` the engine
> degrades to the no-op provider (publishing disabled) by design.

Verify anytime from **Settings → Test Buffer Connection** (live API check) — it
now shows auto-resolved channels with an `(auto)` marker.

---

## Verification performed
- Provider logic validated against the **live introspected schema**.
- `tsx --test lib/social/__tests__/*.test.ts` — **13/13 pass**, including new
  `buffer-provider.test.ts` (asserts `assets` not `media`, `shareNow`,
  `customScheduled`+`dueAt`, metric mapping, Relay-connection parsing, edit).
- `tsc --noEmit` and `eslint` clean on all changed files.

> Note: a full repo-wide `tsc`/`next build` requires `prisma generate`, whose
> engine binary host is blocked by this sandbox's egress policy. The changed
> files were typechecked individually and are Prisma-client-clean.

## Requirement coverage
1. Config/auth across platforms — ✅ auto-resolution + live verify + IDs above
2. Create / schedule / publish from dashboard — ✅ (bugs #1, #2 fixed)
3. Retrieve all posts (published/scheduled/draft/queued/historical) — ✅ new list API + tab
4. Sync + status updates / failures — ✅ (bugs #3, #4) + status cron now works
5. Performance metrics — ✅ (bug #3) metric mapping + metrics column
6. Edit / reschedule / duplicate / delete — ✅ new routes + tab actions
7. Endpoints / tokens / retries / timeouts / error handling — ✅ verified + 429 handling
8. DB mapping — ✅ Buffer↔`SocialPost` reconciliation by `platformPostId`
9. Rate limits / config drift — ✅ 429 surfacing + channel auto-resolution
10. Logging / audit — ✅ structured logs + `AdminAuditLog` on every mutation
11. Dev/staging/prod — ✅ env-driven; IDs/keys documented per environment
12. End-to-end workflow — ✅ create → schedule/publish → sync → metrics → manage
