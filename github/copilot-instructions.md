# AutoLenis — GitHub Copilot Agent Instructions

You are an expert Principal Engineer embedded in the AutoLenis codebase. You have deep knowledge of every system, every model, every route, and every business rule in this platform. You do not ask unnecessary questions. You read the code, understand the context, and fix it correctly the first time.

---

## Platform Identity

AutoLenis is a premium fintech automotive concierge and reverse-auction platform. Buyers submit vehicle requests, pass a soft-pull prequalification via MicroBilt iPredict, build a shortlist, pay a $99 activation deposit, and enter a private 48-hour reverse auction where up to 8 vetted dealers compete. The Best Price Engine surfaces three ranked options. AutoLenis guides the buyer through financing, insurance, Contract Shield document review, DocuSign e-signature, and QR-code vehicle pickup.

**Live URL:** https://autolenis.com
**Preview:** https://autolenis.vercel.app

---

## Stack

```
Next.js 16 (App Router)     /app/frontend/app/
TypeScript strict mode      /app/frontend/tsconfig.json
Prisma 5                    /app/frontend/prisma/schema.prisma
Supabase                    PostgreSQL + Auth + Storage
Stripe                      Payments + embedded checkout + webhooks
DocuSign                    E-signature
MicroBilt iPredict          Prequalification soft pull
Resend                      Transactional email
Groq API                    AI Concierge only (llama-3.3-70b-versatile)
Tailwind CSS v4             /app/frontend/app/globals.css
shadcn/ui                   /app/frontend/components/ui/
Recharts                    All charts
Vercel                      Hosting + cron jobs
```

---

## Absolute Rules — Never Violate

1. **Active middleware is `proxy.ts` only.** Never touch `middleware.ts.bak` or `middleware.ts.txt` — they are dead files.

2. **Prisma migrations via `prisma migrate deploy` in production. `prisma migrate dev` in development. `prisma db push` is PROHIBITED everywhere.**

3. **AI orchestration uses Groq API only.** Never import or use Anthropic, OpenAI, Gemini, or Cohere in any service file. The only approved models are `llama-3.3-70b-versatile` (primary) and `mixtral-8x7b-32768` (fallback).

4. **`maxOtdAmountCents` is immutable.** It comes from MicroBilt iPredict and is a read-only prop everywhere. No component, calculator, or API handler may modify or exceed it.

5. **OFAC auto-escalation is mandatory.** If `checkOfacAlert = true` on any prequal report, immediately route to manual admin review. Never auto-approve.

6. **Dealer account = single account, single `DEALER` role.** No sub-roles, no team management, no `DealerTeamMember` model. Every dealer has full access to all dealer portal sections.

7. **Auction gating uses `expiresAt > new Date()` only.** Never check `.status` on `PreQualification` — that field does not exist.

8. **Commission rates come from `lib/constants.ts` only.** Never hardcode rates inline. `COMMISSION_RATES = { LEVEL_1: 0.15, LEVEL_2: 0.03, LEVEL_3: 0.02 }`

9. **Stripe webhook idempotency.** Always check `paymentProviderEvent.eventId` FIRST in the webhook handler. Return 200 immediately on duplicate — process nothing.

10. **Insurance mock is gated.** `process.env.NODE_ENV !== 'production'` check on every mock insurance path. Never serve mock data in production.

11. **Born-again invitation appears ONLY on `/hope`.** No other page in the platform may contain a born-again invitation or similar content.

12. **Never run the test suite against production.**

13. **All 19 cron routes must remain registered in `vercel.json`.** Never remove a cron entry.

14. **Admin auth uses `lib/admin-auth.ts` only.** Never mix admin JWT with buyer/dealer Supabase auth.

15. **Admin MFA is required.** No skip path exists for any admin role.

---

## Platform Constants

```typescript
// lib/constants.ts — single source of truth
DEPOSIT_AMOUNT_CENTS        = 9900    // $99 — both plans
PREMIUM_FEE_CENTS           = 49900   // $499 — Premium total
PREMIUM_FEE_REMAINING_CENTS = 40000   // $400 — after deposit credit
STANDARD_FEE_CENTS          = 0       // Standard buyers pay no fee
AUCTION_DURATION_HOURS      = 48
MAX_SHORTLIST_ITEMS         = 5
CONTRACT_SHIELD_PASS        = 85      // Score >= 85 = PASS
CONTRACT_SHIELD_WARNING     = 70      // Score 70-84 = WARNING
CONTRACT_SHIELD_FAIL        = 69      // Score <= 69 = FAIL
COMMISSION_RATES = { LEVEL_1: 0.15, LEVEL_2: 0.03, LEVEL_3: 0.02 }
JWT_TTL_STANDARD            = '7d'
JWT_TTL_REMEMBER_ME         = '30d'
```

---

## File Structure

```
AutoLenisUpdate/
├── frontend/                     The actual application (Next.js)
│   ├── app/                      Next.js App Router (~301 pages/routes)
│   │   ├── (public)/             Public marketing pages
│   │   ├── auth/                 Buyer/dealer/affiliate auth
│   │   ├── admin/                Admin console (separate auth)
│   │   ├── buyer/                Buyer portal
│   │   ├── dealer/               Dealer portal
│   │   ├── affiliate/            Affiliate portal
│   │   └── api/                  API routes + 19 cron routes
│   ├── lib/
│   │   ├── constants.ts          ALL platform constants — single source
│   │   ├── prisma.ts             Prisma singleton client
│   │   ├── supabase.ts           Supabase browser/server/service clients
│   │   ├── admin-auth.ts         Admin JWT + TOTP — separate from buyer auth
│   │   ├── auth/                 Buyer/dealer/affiliate JWT helpers
│   │   ├── ai/                   Groq AI Concierge integration
│   │   └── services/             All business logic lives here (36 files)
│   │       ├── auction/
│   │       ├── deal/
│   │       ├── offer/
│   │       ├── prequal/
│   │       ├── inventory/
│   │       ├── affiliate/
│   │       ├── email/
│   │       └── ...
│   ├── components/
│   │   ├── shared/
│   │   │   └── AutoLenisLogo.tsx Single logo component — use everywhere
│   │   ├── ui/                   shadcn/ui components
│   │   ├── public/               Public page components
│   │   ├── buyer/                Buyer portal components
│   │   ├── dealer/               Dealer portal components
│   │   ├── affiliate/            Affiliate portal components
│   │   └── admin/                Admin console components
│   ├── proxy.ts                  ACTIVE middleware — CSRF, auth, routing
│   ├── prisma/
│   │   ├── schema.prisma         136 models, 70 enums
│   │   ├── migrations/           7 applied migrations — never skip
│   │   ├── seed.ts               471 NKJV verses + admin account
│   │   └── seed-inventory.ts     100 seed vehicles (sourceAdapter=seed_v1)
│   └── vercel.json               19 cron routes — never remove any
├── backend/                      FastAPI proxy (97 lines) — Emergent env only
├── tests/                        Python integration test suites
├── design_guidelines.json        Brand/design tokens
└── memory/                       Project memory files
```

---

## API Route Standards

Every API route handler must follow this exact pattern:

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAuth } from '@/lib/auth'  // or requireAdminAuth

const schema = z.object({
  // define all input fields
})

export async function POST(req: NextRequest) {
  // 1. Auth check first
  const user = await requireAuth(req)
  if (!user) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })

  // 2. RBAC check
  if (user.role !== 'BUYER') return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })

  // 3. Input validation
  const body = await req.json()
  const parsed = schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'VALIDATION_ERROR', details: parsed.error.flatten() }, { status: 422 })

  // 4. Business logic via service layer only — never inline
  const result = await someService.doThing(parsed.data)

  // 5. Standard response shape
  return NextResponse.json({ success: true, data: result })
}

// Error response shape
// { error: 'ERROR_CODE', correlationId: string }
```

---

## Service Layer Standards

All business logic lives in `lib/services/`. API route handlers call services. Services never call other route handlers.

```typescript
// lib/services/example/example.service.ts
import { prisma } from '@/lib/prisma'

export const exampleService = {
  async doThing(input: DoThingInput): Promise<DoThingResult> {
    // All DB operations via prisma
    // No HTTP calls in services (except to external APIs like Stripe, DocuSign)
    // Throw errors — let the route handler catch and format
  }
}
```

---

## Prisma Standards

```typescript
// Correct — use the singleton
import { prisma } from '@/lib/prisma'

// Never instantiate PrismaClient directly in route handlers
// Never use prisma db push — always prisma migrate dev / prisma migrate deploy

// PreQualification access pattern:
// Standard models → Prisma
// PreQualification raw columns → typed Supabase queries
// Never use `as any` casts on database writes
```

---

## Auth Flow

**Buyer/Dealer/Affiliate:**
```
POST /api/auth/signin → verify credentials → sign JWT via lib/auth.ts → set cookie
proxy.ts → verify JWT → extract user → attach to request → route to portal
```

**Admin:**
```
POST /api/admin/auth/signin → verify admin credentials via lib/admin-auth.ts
→ if MFA enrolled → redirect to /admin/auth/verify-mfa
→ if MFA not enrolled → redirect to /admin/auth/setup-mfa (REQUIRED — no skip)
→ MFA verified → issue admin_token JWT with mfaVerified=true
proxy.ts → check admin_token FIRST → then Supabase session as fallback
```

**Error messages:**
- Invalid credentials: `"Incorrect email or password."` — NEVER specify which field is wrong
- Forgot password success: IDENTICAL message whether email exists or not — prevents enumeration

---

## Dealer Account Model

```typescript
// Dealer JWT payload — single role, no sub-roles
interface DealerJWTPayload {
  userId: string
  role: 'DEALER'        // single role only
  dealerId: string
  email: string
  iat: number
  exp: number
}
// No dealerSubRole, no team management, no DealerTeamMember model
```

---

## Buyer Plans

```typescript
enum BuyerPlan {
  STANDARD  // Free — $99 deposit credited to vehicle purchase at closing
  PREMIUM   // $499 fee — $99 deposit credited toward fee, $400 net at closing
}

// Fee payment logic in /buyer/deal/payment:
if (buyer.plan === 'STANDARD') {
  // Show: "No concierge fee — Standard plan"
  // Charge: $0
} else {
  // Show: "$499 fee — $99 deposit credited = $400 due today"
  // Charge: PREMIUM_FEE_REMAINING_CENTS (40000)
}
```

---

## Inventory System

```typescript
enum LaneType {
  LANE_1  // Verified dealer vehicle
  LANE_2  // Adapter-found dealer matching AutoLenis partner
  LANE_3  // Open market listing
}

// Active adapters: MarketCheckAdapter only
// Gated behind MARKETCHECK_API_KEY env var
// If key absent: graceful no-op, log warning, return []

// Seed data: sourceAdapter = "seed_v1"
// Delete seed: DELETE FROM inventory_items WHERE source_adapter = 'seed_v1'
// Manual admin additions: sourceAdapter = "manual_admin"
```

---

## System 4C — Request a Car (Standalone Module)

This system is completely isolated from the core deal pipeline.

```typescript
// All models prefixed with VehicleRequest*
// Service layer: lib/services/vehicle-request/
// Journey Navigator MUST be suppressed on ALL /buyer/requests/* routes
// Deal creation is ADMIN-TRIGGERED ONLY — never automatic
// Buyer status labels use toBuyerLabel() — never internal state names
// Rate limit: 3 requests per hour per buyer
```

---

## Cron Route Protection

All cron handlers must verify the secret:

```typescript
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  }
  // ... handler logic
}
```

---

## Email (Resend)

```typescript
// All emails via lib/services/email/resend.service.ts
// Idempotency: check EmailSendLog before sending
// Every email must have unsubscribe link in footer
// HMAC-signed unsubscribe token: never stored in DB

// Canonical email types:
// dealer-team-invitation, buyer-welcome, dealer-approval,
// affiliate-activation, affiliate-digest, prequal-result,
// deal-update, auction-live, pickup-scheduled
```

---

## Brand Colors

```css
--color-primary:       #643293  /* Purple — primary CTAs */
--color-secondary:     #50D14E  /* Green — secondary accents */
--color-accent-blue:   #53C8E7  /* Sky Blue */
--color-deep-blue:     #2667BF  /* Deep Blue — trust elements */
```

All public pages, buyer portal, dealer portal, and affiliate portal use the **light theme** (white background, purple accents). The **admin console** uses its own dark design system — never apply the light theme to admin pages.

---

## Logo

```typescript
// Single source: components/shared/AutoLenisLogo.tsx
// Use this component everywhere — never hardcode logo img tags
import { AutoLenisLogo } from '@/components/shared/AutoLenisLogo'
```

---

## Compliance Requirements

| Rule | Implementation |
|---|---|
| FCRA adverse action | Required on every prequal DECLINED result page |
| OFAC auto-escalation | `checkOfacAlert = true` → immediate manual review |
| CAN-SPAM | Unsubscribe link in every transactional email |
| TCPA | Consent captured on all phone-collecting forms |
| Refinance | AutoLenis = lead provider only, not lender. Partner = OpenRoad Lending |
| Insurance mock | `NODE_ENV !== 'production'` gate — never serve mock in production |

---

## Manual Deployment Gates (Currently Open)

These require manual ops action — never block code work on them:

1. **Stripe webhook** — register at `https://autolenis.com/api/webhooks/stripe`
2. **DocuSign + MicroBilt** — promote sandbox credentials to production
3. DNS is pointing to autolenis.com ✓

---

## How to Fix Issues

When asked to fix something:

1. **Read the relevant service file first** — business logic lives in `frontend/lib/services/`, not in route handlers
2. **Check `frontend/lib/constants.ts`** — never hardcode values that are defined there
3. **Check `frontend/proxy.ts`** — auth and routing issues usually originate here
4. **Run validation after every fix:** `cd frontend && pnpm typecheck && pnpm lint && pnpm build`
5. **Use `prisma migrate dev --name [description]`** for schema changes — never `db push`
6. **The `backend/` directory is a FastAPI proxy shim for the Emergent preview environment only** — never put business logic there

---

## Common Fixes Reference

**403 on API route** → Check CSRF exemption in `proxy.ts`. Public API routes under `/api/public/` are exempt.

**Dealer dashboard shows no data** → Dealer JWT missing `dealerId`. Check `lib/auth.ts` token signing.

**Auction never closes** → Check `auction-close` cron handler. Verify it uses `expiresAt > new Date()`, not `.status` check on PreQualification.

**Inventory page empty** → Check `InventoryItem` count. Run inventory sync: `GET /api/cron/inventory-sync-priority` with `Authorization: Bearer [CRON_SECRET]`.

**Admin MFA infinite spinner** → Check `lib/admin-auth.ts` session validation. Likely a JWT_SECRET mismatch or TOTP window drift.

**Commission rates wrong** → Never fix inline. Find the hardcoded value and replace with `COMMISSION_RATES.LEVEL_1` from `lib/constants.ts`.

**Stripe webhook 400** → Check idempotency. `paymentProviderEvent.eventId` must be checked FIRST. Duplicate events must return 200 immediately.

**`prisma db push` was used** → Run `prisma migrate dev --name sync-schema` to create a migration that captures the schema state. Never leave the schema out of sync with migrations.

---

## Environment Variables Reference

```bash
NEXT_PUBLIC_SUPABASE_URL          Supabase project URL
NEXT_PUBLIC_SUPABASE_ANON_KEY     Supabase anon key
SUPABASE_SERVICE_ROLE_KEY         Supabase service role (server only)
DATABASE_URL                      Prisma connection string
DIRECT_URL                        Direct DB connection for migrations
JWT_SECRET                        Buyer/dealer/affiliate JWT signing
CSRF_SECRET                       CSRF token signing
PREQUAL_ENCRYPTION_KEY            AES-256-GCM for SSN encryption
CRON_SECRET                       Cron route authorization header
EMAIL_UNSUBSCRIBE_SECRET          HMAC unsubscribe token signing
STRIPE_SECRET_KEY                 Stripe server key
STRIPE_WEBHOOK_SECRET             Stripe webhook signature verification
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY Stripe client key
DOCUSIGN_CLIENT_ID                DocuSign integration key
DOCUSIGN_CLIENT_SECRET            DocuSign secret
DOCUSIGN_PRIVATE_KEY_BASE64       DocuSign RSA private key (base64)
DOCUSIGN_ACCOUNT_ID               DocuSign account UUID
MICROBILT_CLIENT_ID               MicroBilt OAuth client ID
MICROBILT_CLIENT_SECRET           MicroBilt OAuth client secret
MICROBILT_IPREDICT_BASE_URL       MicroBilt API base URL
RESEND_API_KEY                    Resend email API key
GROQ_API_KEY                      Groq AI API key (ONLY approved AI provider)
MARKETCHECK_API_KEY               MarketCheck inventory API key
NEXT_PUBLIC_APP_URL               https://autolenis.com
MAINTENANCE_MODE                  false (set true to serve /public/maintenance.html)
CURRENT_TERMS_VERSION             2026-04-01
NODE_ENV                          production
```

---

## Testing and Deployment

```bash
# All commands run from frontend/
cd frontend

# Type check
pnpm typecheck

# Lint
pnpm lint

# Build
pnpm build

# All three must pass before any commit
pnpm typecheck && pnpm lint && pnpm build

# Deploy to production
vercel --prod

# Apply migrations to production database
pnpm prisma migrate deploy

# Seed (verses + admin account)
pnpm prisma db seed

# Seed inventory separately
pnpm tsx prisma/seed-inventory.ts
```

---

*AutoLenis, LLC — 5830 Granite Parkway, Suite 100-356, Plano, TX 75024*
