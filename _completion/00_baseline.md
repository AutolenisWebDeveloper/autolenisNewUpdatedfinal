# Phase 0 — Baseline & Stack Map

_Run date: 2026-06-14 · Branch: `claude/jolly-lamport-pcw295`_

## Stack
- **Framework:** Next.js 16.2.4 (App Router) + React 19, TypeScript 5.8.
- **App location:** `frontend/` (the `backend/` dir is a small unused FastAPI stub).
- **DB/ORM:** Prisma 5 (`frontend/prisma/schema.prisma`) over Supabase Postgres; conventions snake_case.
- **Auth:** Supabase SSR sessions for Buyer/Affiliate; custom JWT cookies for Admin (`admin_token`, MFA-gated) and Dealer (`dealer_token`).
- **Middleware:** single active middleware is `frontend/proxy.ts` (CSRF, Supabase session refresh, role-based route protection). `middleware.ts` is intentionally absent.
- **Integrations:** Stripe, Resend (email), Twilio (voice/SMS), Inngest + QStash (jobs), Groq/OpenAI (AI), Supabase Storage.
- **Tests:** `node --test` via `tsx` (unit). Playwright dir present under `frontend/tests`.

## Surface inventory (static)
| Area | Pages (`page.tsx`) | API routes (`route.ts`) |
|---|---|---|
| Buyer | 47 | 53 |
| Dealer | 49 | 37 |
| Affiliate | 19 | 23 |
| Admin | 133 | 285 |
| Public `(public)` | 57 | — |
| **Total** | **~305** | **508** |

## Baseline command results
| Command | Result | Notes |
|---|---|---|
| `npm ci` | ✅ exit 0 | deps installed |
| `npx prisma generate` | ✅ exit 0 | client generated |
| `npm run typecheck` (`tsc --noEmit`) | ✅ 0 errors | |
| `npm run lint` (`eslint`) | ✅ 0 errors | 102 warnings (unused vars / `any`) |
| `npm test` (unit) | ✅ 22/22 pass | prequal + dealer-recruitment suites |
| `npm run build` (`prisma generate && next build`) | ✅ exit 0 | full production build succeeds |

**Baseline verdict:** the codebase is healthy and builds clean. No red baseline. This is a mature, near-complete platform, so the audit focus is correctness/security/compliance defects rather than missing scaffolding.

## Key architectural fact (drives Phase 2)
`proxy.ts` returns early for **all** `/api/*` requests after CSRF validation (lines 379–390). It does **not** enforce session/role auth for API routes — authorization is delegated entirely to each route handler. Therefore any handler that omits its auth guard is genuinely reachable unauthenticated. This makes per-handler authz coverage the highest-value verifiable check.

## What is NOT verified at runtime
Full 4-role runtime walkthroughs of all ~305 pages require a seeded Supabase DB, live Stripe/Resend/Twilio, and authenticated sessions per role — not available/safe in this ephemeral env. Such rows are labeled **UNVERIFIED (static-only)** in the matrix. Static verification (route exists, UI fetches the right API, handler enforces authz, compliance wording) is performed throughout.
