# 07 — Authorization Review (SEO write paths only)

Every SEO operation that can change **public production output** — publish, unpublish, bulk
generate, create URLs, change canonical/robots/noindex, regenerate sitemaps, change schema,
delete, submit for indexing — traced to its actual server-side check at the mutation boundary.

**No authorization was changed in this batch.** Paths relative to `frontend/`.

---

## Authorization primitives that actually exist in this repository

Enumerated from source, not assumed. Nothing was taken on the strength of a name.

| # | Primitive | Definition | Enforcement mode | Behaviour |
| --- | --- | --- | --- | --- |
| P-1 | `getAdminFromRequest(request)` | `lib/auth/admin-api.ts:15` | **AUTHENTICATION ONLY** | Verifies the admin JWT. Returns the payload for **any** of the 5 roles. **Performs no role check.** |
| P-2 | `getAdminWithRole(request, roles)` | `lib/auth/admin-api.ts:78-86` | **HARD — explicit role check** | `if (!allowedRoles.includes(admin.role)) return null` → caller returns 401/403. Genuine denial. |
| P-3 | `requireContentCapability(request, cap)` | `lib/auth/content-permissions.ts:63-68` | **HARD** — thin wrapper over P-2 using `CONTENT_CAPABILITY_ROLES` (lines 42-55) | Real denial. Not a new RBAC system (line 1-8). |
| P-4 | `hasContentCapability(role, cap)` | `lib/auth/content-permissions.ts:57-59` | **HARD when the caller acts on it** | Pure predicate; enforcement depends on the call site returning 403. |
| P-5 | `requireAdmin()` | `lib/auth/admin-session.ts:28-32` | **AUTHENTICATION ONLY** (server components) | Redirects to signin if unauthenticated; **no role check**. |
| P-6 | `requireAdminRole(roles)` | `lib/auth/admin-session.ts:35-41` | **HARD (soft-landing)** | Redirects to `/admin/dashboard` on role mismatch. Denies access; not an error response. |
| P-7 | `requirePermission(request, perm)` | `lib/auth/permissions.ts:138-158` | **SHADOW — DOES NOT DENY** | Records an `RBAC_SHADOW_DENY` audit row then `return admin` (line 158). Gated on `RBAC_ENFORCE === "true"` (line 99), which the file's own header says to leave unset. |
| P-8 | `requirePermissionActor(actor, perm)` | `lib/auth/permissions.ts:168-185` | **SHADOW — DOES NOT DENY** | Same semantics (line 185). |
| P-9 | `requirePermissionActorStrict(...)` | `lib/auth/permissions.ts:210` | **HARD regardless of the flag** | The one permission-layer primitive that denies today (documented at lines 200-208). |
| P-10 | `authorizeCronRequest(request)` | `lib/security/cron-auth.ts:26-34` | **HARD, fail-closed** | Requires `CRON_SECRET`; missing ⇒ **500**, never "Bearer undefined". Constant-time compare. |
| P-11 | `isNavItemVisible(item, role)` | `lib/admin/nav.ts:365-369` | **UI-ONLY — never an authorization boundary** | Explicitly labelled so at lines 39 and 364. |

**Critical distinction for this review:** P-1 and P-5 authenticate but do **not** authorize. A
route whose only gate is P-1 is open to **all five admin roles, including `SUPPORT_ADMIN`** —
the role every other part of the codebase treats as read-only (`OPERATIONAL_ROLES` at
`lib/auth/admin-api.ts:92-97` exists precisely to exclude it: *"All roles except SUPPORT_ADMIN —
for routes that should be blocked from read-only support staff"*).

**`requirePermission()` is confirmed shadow-mode**, exactly as the prompt cautioned. It is **not
used by any SEO route** — no SEO handler calls P-7 or P-8, so no SEO mutation is protected by a
shadow gate. The SEO authorization defects found are of the *absent-role-check* kind (P-1 only),
not the shadow kind.

---

## Per-handler enforcement table

Production-affecting = the operation can change what search engines see.

| # | Handler | Method | Operation | Primitive | Allowed roles | Enforcement mode | Prod-affecting | Evidence |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| A-1 | `api/admin/content/articles/[id]/actions` | POST | publish_now, unpublish, approve, schedule, archive, restore, rollback, validate, override_validation | P-1 **+ P-4** | per action: publish/unpublish/approve/archive ⇒ SUPER, OPERATIONS; override ⇒ SUPER, COMPLIANCE; edit/schedule ⇒ SUPER, OPERATIONS | **HARD — explicit role check** | **yes** | auth `:56-57`; check `:63-66` → 403; map `:42-52` |
| A-2 | `api/admin/content/articles/[id]` | PATCH | set status PUBLISHED / ARCHIVED / DRAFT / REVIEW_NEEDED | **P-1 only** | **all 5 roles** | **AUTHENTICATION ONLY — no role check** | **yes** | `:29-30`; mutation `:40`; schema `:24-26` |
| A-3 | `api/admin/content/articles/bulk` | POST | **bulk** publish / reject / draft, by id list **or filter** | **P-1 only** | **all 5 roles** | **AUTHENTICATION ONLY — no role check** | **yes** | `:70-72`; mutations `:101-121` |
| A-4 | `api/admin/content/[id]` | PATCH | article field update | **P-1 only** | **all 5 roles** | **AUTHENTICATION ONLY** | yes | `:49-50` |
| A-5 | `api/admin/content/articles` | GET | list | P-1 only | all 5 | auth only (read) | no | `:58` |
| A-6 | `api/admin/content/articles/generate` | POST | enqueue generation / regeneration | **P-3** `content.generate` | SUPER, OPERATIONS | **HARD** | yes (creates future URLs) | `:34-35` → 403 |
| A-7 | `api/admin/content/jobs` | GET | job list | **P-3** `content.view` | all 5 | **HARD** (read tier) | no | `:14-15` |
| A-8 | `api/admin/content/jobs/[id]` | POST | retry / cancel / pause / resume | **P-3** `content.manage_jobs` | SUPER, OPERATIONS | **HARD** | yes | `:21-22` → 403 |
| A-9 | `api/admin/seo/keywords` | GET | list keywords | **P-2** `OPERATIONAL_ROLES` | SUPER, OPS, COMPLIANCE, FINANCE | **HARD** | no | `:7-8` |
| A-10 | `api/admin/seo/keywords` | POST | upsert keyword | **P-2** `OPERATIONAL_ROLES` | as above (excludes SUPPORT) | **HARD** | no (internal) | `:25-26`; audit `:51-56` |
| A-11 | `api/admin/seo/keywords/[id]` | PATCH | update keyword | **P-2** `OPERATIONAL_ROLES` | as above | **HARD** | no | `:19-20`; audit `:35-41` |
| A-12 | `api/admin/seo/keywords/[id]` | DELETE | soft-delete (`isActive=false`) | **P-2** `OPERATIONAL_ROLES` | as above | **HARD** | no | `:48-49`; `:53-57` |
| A-13 | `api/admin/amips/compute-market-scores` | POST | recompute `amips_market_scores` | **P-1 only** | **all 5 roles** | **AUTHENTICATION ONLY** | indirect — feeds page bodies | `:18-19` |
| A-14 | `api/admin/amips/sync-market-intelligence` | POST | repopulate market intelligence | **P-1 only** | **all 5 roles** | **AUTHENTICATION ONLY** | indirect | `:18-19` |
| A-15 | `api/admin/amips/sync-dealer-intelligence` | POST | repopulate dealer intelligence | **P-1 only** | **all 5 roles** | **AUTHENTICATION ONLY** | indirect | `:18-19` |
| A-16 | `api/admin/amips/executive-summary` | POST | generate summary | **P-1 only** | all 5 | AUTHENTICATION ONLY | no | `:35` |
| A-17 | `api/admin/amips/export` | GET | export AMIPS data | **P-5** `requireAdmin()` | all 5 | AUTHENTICATION ONLY (read) | no | `:61` |
| A-18 | `api/cron/amips-generate` | GET | **generate + publish** AMIPS pages | **P-10** | cron only | **HARD, fail-closed** | **yes** | cron-auth |
| A-19 | `api/cron/amips-lifecycle` | GET | **de-index pages** (`UNDER_REVIEW`/`RETIRED`) | **P-10** | cron only | **HARD, fail-closed** | **yes** | `route.ts:20` |
| A-20 | `api/cron/content-publisher` | GET | publish due articles | **P-10** | cron only | **HARD, fail-closed** | **yes** | cron-auth |
| A-21 | `api/cron/amips-search-sync` | GET | GSC pull | **P-10** | cron only | **HARD, fail-closed** | no | `:22-23` |
| A-22 | `/sitemap.xml`, `/sitemap-*.xml`, `/robots.txt` | GET | regeneration | **none — public by design** | anyone | n/a | read-only | `proxy.ts:124-132,182` |
| A-23 | `/admin/seo/*` pages (5) | GET | render | **P-5** `requireAdmin()` | all 5 | AUTHENTICATION ONLY (read) | no | each `page.tsx:1` |

**Not present in this codebase:** there is no indexing-submission endpoint (no IndexNow, no GSC
URL Inspection write — `02-data-sources.md`, D-3), no canonical/robots mutation API (canonicals
are code-derived via `lib/seo/metadata.ts:26`), and no sitemap-regeneration endpoint (sitemaps
are ISR/`force-dynamic` route handlers). **Those attack surfaces do not exist**, which is a
genuine security strength worth preserving.

---

## Authorization findings

### AUTHZ-1 · Unbounded bulk publish/unpublish with no role check — HIGH
**Handler:** `POST /api/admin/content/articles/bulk` (A-3)
**Enforcement mode:** *authentication only* (`route.ts:70-72`)

`hasContentCapability` restricts `content.publish` to `PUBLISHERS = [SUPER_ADMIN,
OPERATIONS_ADMIN]` (`content-permissions.ts:40,51`), and A-1 enforces exactly that. **A-3
performs the same publish operation with no role check at all.** Any authenticated admin —
including `SUPPORT_ADMIN`, deliberately excluded from `OPERATIONAL_ROLES` as read-only — can
publish or unpublish content.

Scope is unbounded. With `ids` omitted and a permissive `filter`, `whereFromFilter` builds the
predicate (`route.ts:89`) and `updateMany` (lines 101-106, 113-116, 121) applies it to **every
matching article**. A filter matching all rows publishes or drafts the entire corpus in one
request. `status="DRAFT"` also clears `publishedAt` (line 115), and `PUBLISHED` articles are what
the sitemap selects (`app/sitemap.ts:104`) — so a single call can add or remove the whole
`/buying-guide` family from the sitemap and the public site.

Mitigations present: the action is audit-logged (lines 127-137) with actor, mode and count, and
the caller must already hold a valid admin JWT (admin auth requires MFA per
`autolenis-auth-security-privacy`). This is a **privilege-separation failure among admins**, not
an unauthenticated hole — hence HIGH, not CRITICAL.

**Remediation (do not apply in this batch):** replace `getAdminFromRequest` with
`requireContentCapability(request, "content.publish")`, matching A-1. One-line change; the
primitive already exists.

### AUTHZ-2 · Single-article publish/unpublish with no role check — HIGH
**Handler:** `PATCH /api/admin/content/articles/[id]` (A-2) — `route.ts:29-30`

Accepts `PUBLISHED | ARCHIVED | RETIRED | DRAFT | REVIEW_NEEDED` (lines 24-26) and delegates to
`updateContentArticleStatus` (line 40). The file header (lines 1-6) states it exists to serve
*"the bulk dashboard row actions and preview drawer"* and that it *"Delegates to the shared
`updateContentArticleStatus` service so `published_at` stamping/clearing stays identical to the
review flow."* The **service** was shared; the **authorization** was not.

Same defect and same remediation as AUTHZ-1: `content.publish` for PUBLISHED/ARCHIVED,
`content.edit` for DRAFT/REVIEW_NEEDED, mirroring A-1's `ACTION_CAPABILITY` map.

### AUTHZ-3 · AMIPS data-sync mutations have no role check — MEDIUM
**Handlers:** A-13, A-14, A-15 — each `getAdminFromRequest` only (`:18-19` in all three)

These rewrite `amips_market_scores`, market intelligence and dealer intelligence — the data
AMIPS page bodies are generated from, and the source of `marketScoreJson` rendered on
`/intelligence/*` (`amips-generator.ts:212`). They do not publish directly, so the effect on
public output is one step removed — hence MEDIUM. They are batch operations
(`entityId: "batch"`) with real compute cost, making them a denial-of-wallet vector for a
low-privilege admin as well.

**Remediation:** `getAdminWithRole(request, OPERATIONAL_ROLES)` at minimum; `["SUPER_ADMIN",
"OPERATIONS_ADMIN"]` would match the content engine's posture for equivalent operations.

### AUTHZ-4 · `/admin/seo/*` pages are readable by every admin role — LOW
All five pages use `requireAdmin()` (P-5), which does not check role (A-23). These are read-only
views of internal SEO configuration; `SUPPORT_ADMIN` can view keyword targets and metadata. Low
sensitivity, recorded for completeness. The mutating keyword API (A-9…A-12) **is** correctly
gated to `OPERATIONAL_ROLES`, so the read/write asymmetry is deliberate and defensible.

---

## Summary — defects by enforcement mode

| Enforcement mode | Handlers | Production-affecting defects |
| --- | --- | --- |
| **Strict actor-scoped** (`requirePermissionActorStrict`) | 0 SEO handlers | — |
| **Explicit role check** (P-2/P-3/P-4/P-6) | A-1, A-6, A-7, A-8, A-9, A-10, A-11, A-12 | **0** |
| **Cron fail-closed** (P-10) | A-18, A-19, A-20, A-21 | **0** |
| **Shadow-mode `requirePermission()`** | **0 SEO handlers** | **0** |
| **Authentication only, no role check** (P-1/P-5) | A-2, A-3, A-4, A-13, A-14, A-15, A-16, A-17, A-23 | **3** — AUTHZ-1 (HIGH), AUTHZ-2 (HIGH), AUTHZ-3 (MEDIUM) |
| **UI-only gating** (P-11) | nav visibility only — correctly labelled non-authoritative | **0** |
| **Absent enforcement** (no auth at all) | **0** | **0** |

**Totals: 3 authorization defects — 2 HIGH, 1 MEDIUM. All three are the same root cause:
`getAdminFromRequest` (authenticate) used where `getAdminWithRole` / `requireContentCapability`
(authorize) was intended.** No SEO mutation is protected only by shadow-mode or UI gating, and no
SEO mutation is unauthenticated.

---

## Positive findings — preserve these

| Control | Evidence |
| --- | --- |
| Cron auth fails **closed** on missing `CRON_SECRET` (500), with a documented history of the prior spoofable-header bug | `lib/security/cron-auth.ts:6-12,26-34` |
| Every SEO/content mutation writes an audit log with actor + before/after state | e.g. `seo/keywords/[id]/route.ts:35-41`; `articles/bulk/route.ts:127-137` |
| Keyword DELETE is a **soft** delete preserving history | `seo/keywords/[id]/route.ts:53-57` |
| Capability→role map is a thin mapping onto existing `AdminRole`, not a parallel RBAC system | `content-permissions.ts:1-8` |
| Nav `visibleTo` is explicitly documented as UX-only, twice | `lib/admin/nav.ts:39,364` |
| Zod validation on every mutation body before any DB write | A-1, A-2, A-3, A-6, A-8, A-10, A-11 |
| No canonical/robots/sitemap/indexing-submission mutation API exists to attack | see note under the table |

## Owner must verify

| # | Check | Why |
| --- | --- | --- |
| V-16 | `SELECT role, count(*) FROM admins GROUP BY role;` | Sizes AUTHZ-1/2/3: with zero `SUPPORT_ADMIN`/`FINANCE_ADMIN`/`COMPLIANCE_ADMIN` accounts the practical exposure today is nil, though the defect stands |
| V-17 | Confirm `RBAC_ENFORCE` is **unset** in Vercel production | The file header instructs leaving it unset pending the shadow-denial report; flipping it changes 224 routes at once |
| V-18 | `SELECT * FROM audit_logs WHERE action='CONTENT_ARTICLE_BULK_STATUS_CHANGED' ORDER BY created_at DESC LIMIT 20;` | Whether any bulk publish has run, by whom, and at what scale |
| V-19 | Confirm `CRON_SECRET` is set in production | If unset, all 67 crons 500 — including the content publisher |
