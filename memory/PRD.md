# AutoLenis — Emergent Workspace PRD

## Project Overview
AutoLenis is a full-stack Next.js 16 / Prisma / Supabase car dealership marketplace platform.
Deployed live at https://autolenis.com. Database: Supabase PostgreSQL. Auth: 4 separate systems.

## Source of Truth
- **GitHub Repo:** https://github.com/AutolenisWebDeveloper/AutoLenisUpdate
- **Branch:** main
- **Workspace root:** /app (Next.js app lives in /app/frontend/)

## Architecture
- **Frontend:** Next.js 16.2.4 (App Router, Turbopack), TypeScript, Tailwind CSS v4
- **Database ORM:** Prisma v5.22.0 → Supabase PostgreSQL (pooler URL)
- **Auth (4 systems):**
  - Buyer/Affiliate: Supabase Auth → callback → ensurePrismaUser()
  - Dealer: Supabase password verify → custom dealer_token JWT
  - Admin: bcrypt password → admin_premfa cookie → TOTP verify → admin_token JWT

## Auth Systems — Verified Status
| Role | System | Cookie | Status |
|------|--------|--------|--------|
| Buyer | Supabase Auth | Supabase session | ✅ Verified |
| Affiliate | Supabase Auth | Supabase session | ✅ Verified |
| Dealer | Custom JWT | dealer_token | ✅ Verified |
| Admin | Custom JWT + TOTP | admin_token | ✅ Verified |

## What Was Done

### 2026-05-07 — Import
- Imported GitHub repo (main branch) into Emergent workspace /app/
- Removed Emergent template leftovers (postcss.config.js, craco.config.js, etc.)
- Created /app/frontend/.env.local with all production env vars

### 2026-05-07 — Auth Audit + Admin Account
- Verified RLS policies on all 4 tables (users, buyers, affiliates, dealers) — service_role bypass on ALL
- Admin account markist@autolenis.com created (SUPER_ADMIN, bcrypt hash, totpEnabled: false)
- Fixed Prisma schema drift: failedMfaAttempts @map("failed_mfa_attempts") → @map("mfa_failed_attempts")
- Applied missing DB columns: mfa_reset_at, admin_mfa_email_tokens table + FK + index
- Fixed DATABASE_URL in .env.local to use pooler URL (direct host blocked in sandbox)
- Regenerated Prisma client
- All 14 auth tests PASS (100% backend + frontend)

### 2026-05-07 — Stripe Payment Audit
- Prisma migrations: 7 pending migrations applied, 8 already-applied marked via resolve, dirty prequal migration cleaned up
- BUG FIX (CRITICAL): Webhook deposit handler now calls launchAuction() + inviteDealersToAuction() — dealers were never invited after deposit
- BUG FIX (CRITICAL): Admin deposit send-link and concierge-fee send-link both missing payment_intent_data.metadata — Checkout Sessions don't auto-copy metadata to PI, webhook couldn't identify payment type
- BUG FIX (CRITICAL): Concierge fee webhook handler used stripeFeePIId lookup (never set) — now uses dealId from pi.metadata
- BUG FIX (MINOR): Concierge fee refund now idempotent (returns 400 if feeRefundedAt already set)
- All 14 Stripe checklist items PASS, TypeScript 0 errors, build succeeds
- Use pooler URL: postgres://postgres.aieybibvewmvrubcpthm:Y1vodXWLySi4twuX@aws-1-us-east-1.pooler.supabase.com:6543/postgres?sslmode=require&pgbouncer=true
- Direct host (db.aieybibvewmvrubcpthm.supabase.co:5432) is BLOCKED from sandbox

## Vercel Deployment Config (vercel.json)
- framework: nextjs
- buildCommand: pnpm build (prisma generate && next build)
- installCommand: pnpm install --frozen-lockfile

### 2026-05-07 — Crashing Pages Audit + P0 Fixes
- **Audit (read-only):** traced 7 reported crashing routes against schema + live DB. Findings split into 3 buckets:
  - Bucket A (404/dead links): 6 hardcoded links in `AdminBuyerCommandCenter.tsx` pointed to non-existent pages (`/admin/payments/deposits`, `/admin/payments/refunds`, `/admin/preapprovals`, `/admin/manual-reviews`, `/admin/notifications`)
  - Bucket B (real DB crash): `prequal_consents` table missing `accepted_at` column → buyer prequal POST crashed with P2022
  - Bucket C (healthy): `/admin/affiliates/[affiliateId]`, `/admin/payments`, `/admin/external-preapprovals` all have correct schema mapping
- **Fix B applied:** `ALTER TABLE prequal_consents ADD COLUMN accepted_at TIMESTAMP(3) NOT NULL DEFAULT NOW()` + new migration file `20260507000000_add_prequal_consent_accepted_at` + Prisma client regenerated
- **Fix A applied:** redirected 6 dead links in `AdminBuyerCommandCenter.tsx` to existing routes (`/admin/payments`, `/admin/external-preapprovals`, `/admin/queues`)
- **Cleanup:** marked rolled-back `20260428000000_add_prequal_employment_fields` rows resolved in `_prisma_migrations`
- **Verified:** `yarn typecheck` 0 errors, `yarn build` succeeds (68s), all 6 routes return 307 (auth redirect, not 500), `prequalConsent` and `adminAuditLog` write/read smoke tests pass

### 2026-05-07 — 5 New Admin Pages Built
- `/admin/dealers/applications/[appId]/page.tsx` — full dealer application detail view with status badge, contact info, notes, approve & reject panels, reviewer + dealer-link sidebar (server component, real Prisma)
- `/admin/dealers/applications/[appId]/ApproveButtonClient.tsx` — client component, calls `POST /api/admin/dealers/applications/[appId]/approve`
- `/admin/dealers/applications/[appId]/RejectFormClient.tsx` — client component with reason textarea, calls `POST /api/admin/dealers/applications/[appId]/reject`
- `/admin/manual-reviews/page.tsx` — prequal review queue (decision IN MANUAL_REVIEW, OFAC_ESCALATED, OFAC_REVIEW) + secondary OFAC-flagged buyer list, FIFO-ordered with stale-age highlighting at 48h
- `/admin/payments/deposits/page.tsx` — standalone deposits list with status filter pills (ALL/PENDING/PAID/REFUNDED/FAILED), totals header, per-row actions
- `/admin/payments/refunds/page.tsx` — combined refund list (deposit refunds + concierge fee refunds), sorted by refund date, with type badges
- `/admin/notifications/page.tsx` — admin's own audit-log inbox with system-alert tiles (pending applications, OFAC reviews) + my-recent-activity + platform-wide activity sections
- Restored Buyer Command Center hardcoded links to point at the real new pages
- Made each row in `/admin/dealers/applications` link to the new detail page
- `yarn typecheck` 0 errors · `yarn build` succeeds (70s) · `yarn lint` 0 errors · all 5 new routes return HTTP 307 (auth redirect, healthy)

### 2026-05-07 — Sidebar Wiring + PrequalAdminPanel Activation
- `components/dealer/DealerSidebar.tsx` — added 4 nav entries: Inventory (Operations), Financing + Pickups (Performance), Profile (Account); imported `Package, Banknote, Truck, User` icons
- `components/admin/AdminSidebar.tsx` — added 5 nav entries: Manual Reviews (Operations), Deposits + Refunds (Transactions), Reports overview (Reports, first item), Notifications (System); imported `ClipboardCheck, ArrowDownCircle, RotateCcw, Bell` icons
- `components/buyer/BuyerSidebar.tsx` — added Trade-In (Account, after My Requests)
- `app/admin/buyers/[buyerId]/page.tsx` — server-fetches `latestConsent.acceptedAt`, derives `source` from `isExternal`, computes `profileMissingFields` from required buyer fields; passes new `prequalPanelExtras` prop
- `app/admin/buyers/[buyerId]/AdminBuyerCommandCenter.tsx` — imported `PrequalAdminPanel` (named export), accepts new optional `prequalPanelExtras` prop, renders the full MicroBilt iPredict + Manual Override panel below the existing read-only Prequal SectionCard inside the overview tab (full-width via `lg:col-span-2`)
- Verified: `yarn typecheck` 0 errors · `yarn lint` 0 errors · `yarn build` succeeds (80s) · all 10 newly-linked routes return HTTP 307 (auth redirect, healthy) · all 11 user-supplied python verifications pass

### 2026-05-07 — Missing Backend Route Fix
- Created `app/api/dealer/inventory/column-mapping/route.ts` (POST, dealer-auth gated)
- Validates `{ mapping: Record<string, "VIN"|"Year"|"Make"|"Model"|"Trim"|"Mileage"|"Price"|"Skip"> }` shape via Zod
- Persists the mapping in an HttpOnly cookie `al_dealer_csv_mapping` (path `/dealer`, 30-day max-age, secure in production) — no Prisma schema change required
- Rejects mappings where every column maps to "Skip" (422)
- **NOTE — Frontend mismatch (not fixed, per instruction):** the frontend page sends only `{ mapping }` (no rows), so this route persists the mapping for the next bulk-upload step rather than creating InventoryItems. The user's prompt incorrectly described this as a row-import endpoint; the actual import happens via the existing `/api/dealer/inventory/bulk` endpoint.
- Verified: `yarn typecheck` 0 errors · `yarn lint` 0 errors · `yarn build` 72s · `GET → 405`, `POST without auth → 401` (was 404 before fix)

### 2026-05-07 — Sidebar Trophy Link + Column-Mapping Route Extension
- `components/admin/AdminSidebar.tsx` — added `{ label: "Referral Milestones", href: "/admin/referral-milestones", icon: Trophy }` to the Reports group, after Affiliates report; imported `Trophy` icon
- `app/api/dealer/inventory/column-mapping/route.ts` — extended to accept optional `rows` array (max 500). When `rows` are present, applies the mapping per-row, validates VIN (11–17 chars), Year (1900–2100), Make, Model, Price (required by Prisma model), parses Mileage; calls `prisma.inventoryItem.createMany` with `skipDuplicates: true` (dedupes against existing VINs); returns `{ created, errors, errorDetails (first 5) }`. Mapping-only mode still works (cookie persistence). `201` returned when items created, `200` for mapping-only.
- Verified: `yarn typecheck` 0 errors · `yarn lint` 0 errors · `yarn build` 70s · POST `{mapping}` and POST `{mapping,rows}` both reach handler correctly (401 without auth, was 404 before)

### 2026-05-07 — Bulk Upload End-to-End Wired with Cookie Mapping
- `app/api/dealer/inventory/bulk/route.ts` — accepts new `{ rawRows: Record<string, string>[] }` body shape (in addition to legacy `{ rows: TypedRow[] }`). When `rawRows` provided: reads `al_dealer_csv_mapping` cookie, applies mapping per row, validates VIN/Year/Make/Model/Price, parses Mileage, then dedupes + creates via existing `createMany({ skipDuplicates: true })`. Returns 409 `MAPPING_REQUIRED` if cookie absent.
- `app/dealer/inventory/bulk-upload/page.tsx` — when `parseCsv` throws on non-standard headers, falls back to `parseCsvRaw` (preserves all headers), shows raw-table preview, sends `{ rawRows }`. Standard-header CSVs continue using the typed path. On `MAPPING_REQUIRED` error, surfaces a "Configure Column Mapping →" CTA.
- Standard-header CSV flow: page → `{ rows }` → bulk endpoint typed path (unchanged)
- Non-standard CSV flow: dealer first visits `/dealer/inventory/column-mapping` (saves cookie) → uploads CSV on bulk-upload page → `{ rawRows }` → bulk endpoint reads cookie → applies mapping → dedupes + creates
- Verified: `yarn typecheck` 0 errors · `yarn lint` 0 errors · `yarn build` 70s · both shapes auth-gated correctly (401 without cookie)

### 2026-02-12 — Pre-Launch Final Fix Pass (8 fixes complete)
- **Fix 1 (`proxy.ts`):** Added `/insurance`, `/status`, `/testimonials`, `/compare`, `/request-a-car` to `PUBLIC_ROUTES` — 5 marketing pages no longer redirect anonymous visitors to sign-in.
- **Fix 2 (`lib/admin-auth.ts`):** Refactored `ADMIN_JWT_SECRET` into a lazy `getAdminJwtSecret()` loader. Throws only on first use, not module load — Turbopack static page builds no longer crash when env vars are absent. All 4 callsites (`signAdminJwt`, `verifyAdminJwt`, `signPreMfaToken`, `verifyPreMfaToken`) updated.
- **Fix 3 (`app/api/public/platform-stats/route.ts`):** Removed all hardcoded fallback numbers (1847 deals, 312 dealers, 3200 buyers, etc.). Returns true zeros for a brand-new platform; on DB error returns 503 `STATS_UNAVAILABLE` instead of fabricating activity. Added `activeInventory` count.
- **Fix 4 (`lib/services/prequal/microbilt.service.ts`):** `IPredicResult.ofacFlagged` typed as `boolean | null`. `timeoutResult()` and `errorResult()` now return `null` (indeterminate) — never the false-positive "OFAC clear" we were silently signalling. Routes already produce `MANUAL_REVIEW` decision; null OFAC value coerced via `=== true` at the two `prisma.preQualification.upsert` callsites in `prequal.service.ts` and `admin-prequal.service.ts`.
- **Fix 5 (`app/api/admin/auth/setup-mfa/route.ts`):** POST handler now emits a single combined `Set-Cookie` header (admin token + pre-MFA cookie expiration) using `res.headers.append("Set-Cookie", ...)`. Avoids HTTP/2 header-merge bug that silently dropped the admin session cookie on Vercel Edge, sending operators back to sign-in mid-MFA-setup.
- **Fix 6 (15 admin API routes):** Replaced `await requireAdmin()` (server-action `redirect()` semantics → returns 307 HTML) with `await getAdminFromRequest(request)` (returns JSON 401). Routes covered: requests/[id]/{notes,offer,checkpoints,checkpoints/[id]/complete}, requests/[id], refinance/leads/{[id],list}, dealers/invitations/{list,[id]/cancel,[id]/resend}, dealers/invite, dealers/applications/{list,[id]/reject}, inventory/search-tool/{add,run}.
- **Fix 7 (`app/admin/support/page.tsx`):** Replaced impersonation UI (which exposed raw curl commands) with a clean "Coming Soon" card. Buyer impersonation will return once full session logging + time-bounded access controls are implemented.
- **Fix 8:** Deleted 4 orphan affiliate redirect stubs (`app/affiliate/{dashboard,referrals,payouts,earnings}/page.tsx`). `proxy.ts` middleware (lines 460-467) already redirects all non-portal `/affiliate/*` requests to `/affiliate/portal/*`.
- Verified: `pnpm typecheck` 0 errors · `pnpm lint` 0 errors (99 pre-existing warnings, unchanged) · `pnpm build` 28.3s ✓ Compiled successfully · all 5 new public routes appear in build manifest as static pages.

### 2026-05-07 — 8 Orphaned Admin Sub-pages Wired
- `app/admin/inventory/page.tsx` — added "Discovery Tools" card-grid section (matches `/admin/refinance` card-grid pattern) above the existing `<InventoryListClient />`. 5 cards link to `coverage-map`, `dealer-discovery`, `demand-gap`, `markets`, `contributions`.
- `components/admin/AdminSidebar.tsx` — imported `Map, TrendingDown, Globe, PlusCircle` icons; added 5 new entries to the Inventory group for the discovery sub-pages.
- `app/admin/dealers/AdminDealersClient.tsx` — imported `ClipboardList, UserPlus`; added two header buttons: "Pending Applications" (with kpis.pending count badge) → `/admin/dealers/applications`, "Invite Dealer" (primary blue) → `/admin/dealers/invite`.
- `app/admin/requests/page.tsx` — imported `BarChart2`; added "Analytics" button (right-aligned via `ml-auto`) in the page header → `/admin/requests/analytics`.
- All 8 previously-orphaned sub-pages now reachable from their parent's UI.
- Verified: `yarn typecheck` 0 errors · `yarn lint` 0 errors · `yarn build` 72s · all 11 affected routes (parents + 8 new links) return HTTP 307 (auth redirect, healthy)

## Prioritized Backlog
- P0: Admin TOTP enrollment — sign in at /admin/auth/signin, scan QR code, save recovery codes
- P1: Build out missing admin pages if needed (`/admin/payments/deposits`, `/admin/payments/refunds`, `/admin/manual-reviews`, `/admin/notifications`, `/admin/dealers/applications/[appId]`) — currently redirected to nearest existing route
- P1: Buyer end-to-end signup test with real email (Resend email delivery)
- P1: Dealer invite claim flow test (/dealer/invite/claim)
- P2: Affiliate registration end-to-end with real email
