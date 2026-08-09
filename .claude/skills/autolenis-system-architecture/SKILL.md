---
name: autolenis-system-architecture
description: >
  The architectural source of truth for AutoLenis — a premium automotive reverse-auction
  concierge platform (Next.js 16 App Router, React 19, TypeScript strict, Prisma 5, Supabase
  PostgreSQL, Vercel). Defines portal boundaries, the service/repository layer, auth architecture,
  background-job model, transaction/idempotency rules, and the forbidden patterns that keep Claude
  from building parallel or duplicate systems. Use this skill FIRST for any AutoLenis engineering
  task, and whenever the change touches routing, service structure, data access, background jobs,
  environment configuration, or cross-cutting architecture. It overrides generic Next.js guidance.
---

# AutoLenis — System Architecture

## Purpose & Authority

This skill is the **authoritative architectural contract** for the AutoLenis codebase. It is
loaded before any AutoLenis engineering work and takes precedence over generic Next.js / React /
Node guidance whenever the two conflict. Its job is to keep every change *inside the existing
architecture*: AutoLenis is a **mature production application**, not a greenfield project. The
prime directive is **extend, never replace** — do not introduce a second auth system, a second
payment path, a parallel ORM, or a duplicate service when one already exists.

## When this skill activates

- Any task that begins "in the AutoLenis repo…" or names AutoLenis, Zura, the buyer/dealer/admin
  portals, reverse auctions, Contract Shield, Best Price Report, or dealer outreach.
- Changes to routing (`frontend/app/**`), the service layer (`frontend/lib/services/**`), data
  access (`lib/prisma.ts`, `lib/supabase*.ts`), background jobs (Inngest / QStash / `after()`),
  `frontend/proxy.ts`, `next.config.mjs`, or environment configuration.
- Before scaffolding *any* new module — to confirm it belongs in the existing structure.

## Architecture & key files

**Two apps, one primary.** The production app is **`frontend/`** (Next.js 16.2.9, App Router).
`backend/` is a secondary FastAPI service (`server.py`); do not migrate frontend logic there.

**Portals = App Router route groups** under `frontend/app/`:

| Route group | Audience | Auth |
| --- | --- | --- |
| `(public)` | Marketing, SEO landing pages, lead capture | none (public) |
| `buyer` | Authenticated buyer portal | `JWT_SECRET` (BUYER) |
| `dealer` | Dealer portal (bids, offers, inventory) | `DEALER_JWT_SECRET` (DEALER) |
| `affiliate` | Affiliate portal (referrals, payouts) | `JWT_SECRET` (AFFILIATE) |
| `admin` | Founder/operations command center | `ADMIN_JWT_SECRET` + MFA |
| `auth` | Login / signup / session flows | — |
| `api` | Route handlers (mirrors the portals + `webhooks`, `cron`, `inngest`, `internal`) | per-route |

**Layering (respect it top-to-bottom):**

```
app/**            → thin route handlers & Server Components (no business logic, no raw SDK calls)
  lib/services/** → business logic, one folder per domain (auction, deal, dealer, payment, …)
    lib/*.ts      → shared infra: prisma.ts, stripe.ts, supabase*.ts, logger.ts, admin-auth.ts…
      Prisma / Supabase / third-party SDKs
```

- **Data access:** Prisma via `lib/prisma.ts` (a singleton — never `new PrismaClient()` in a
  request path). Supabase clients: `lib/supabase.ts` (server), `lib/supabase-service.ts`
  (service-role — server only, never shipped to the client), `lib/supabase-browser.ts` (public).
- **Service layer:** `frontend/lib/services/<domain>/`. Existing domains include auction, deal,
  dealer, dealer-recruitment, deposit, contract, contract-shield, esign, payment, insurance,
  trade-in, prequal, offer, pickup, refinance, notifications, sms, email, voice, seo, identity,
  trust, audit, monitoring, ai, agreement, documents, referral, crm, content, inventory,
  acquisition, search, nudge, shortlist, vehicle-request, activity, analytics, workflow(.engine).
- **Edge routing / gating:** `frontend/proxy.ts` (there is intentionally **no** `middleware.ts`).
- **Auth helpers:** `lib/admin-auth.ts`, `lib/dealer-auth.ts`, `lib/auth/`, `lib/security/`.
- **Background work:** Vercel `after()` (fire-and-forget within a request), **Inngest**
  (`lib/inngest`, `app/api/inngest`) for durable/event-driven jobs, **Upstash QStash**
  (`lib/qstash`) for scheduled/delayed HTTP jobs, `app/api/cron/**` for Vercel Cron.
- **Observability:** Sentry (`instrumentation.ts`, `instrumentation-client.ts`), `lib/logger.ts`,
  `lib/observability/`.

## Core rules & invariants

1. **Extend, don't fork.** Before creating a service, table, route, component, hook, utility,
   queue, worker, job, agent, workflow, integration, or abstraction, run the **reuse-before-create
   protocol** in [`reference/capability-index.md`](reference/capability-index.md). Reuse or extend
   what you find. A parallel implementation is a defect even if it works — and if you do create
   something new, state in the PR what you searched for and why nothing matched.
2. **Read before write.** Read the current implementation and its callers before changing it. Never
   overwrite a system you have not read.
3. **Business logic lives in `lib/services/**`.** Route handlers and components stay thin. No raw
   third-party SDK calls in `app/**` or `components/**` — go through the service/adapter (see
   `autolenis-integrations`).
4. **Prisma singleton only** (`lib/prisma.ts`). Service-role Supabase (`lib/supabase-service.ts`)
   is server-only and must never reach a Client Component or the browser bundle.
5. **Server-side authorization always.** Frontend role checks are UX only; every privileged action
   re-verifies role/ownership server-side (see `autolenis-auth-security-privacy`).
6. **Background over blocking.** Anything not needed for the response (emails, SMS, scoring,
   enrichment, webhooks fan-out) runs via `after()` / Inngest / QStash — never blocks the request.
7. **Idempotency at every external boundary.** Webhooks, payment mutations, and job handlers must
   be safe to run twice (idempotency keys / dedupe on provider event id).
8. **Transaction boundaries around multi-write state changes.** Money movement, status transitions,
   and ledger writes use `prisma.$transaction`; never leave a half-applied state.
9. **Every background job has a manual backfill endpoint** (pattern already used across `scripts/`
   and `app/api/internal|cron`).
10. **Fallback chains & backoff.** External providers have a documented fallback (Groq→Anthropic,
    ElevenLabs→Polly, Gemini→Groq) and exponential backoff (8s/16s/32s) on rate limits. Log which
    provider/model fired.
11. **Money = integer minor units.** Never floats; never trust client-supplied amounts or payment
    status (see `autolenis-payments-and-ledger`).
12. **Env vars are typed and centralized.** Read secrets server-side only; never expose a secret to
    a Client Component or inline it. Only `NEXT_PUBLIC_*` may reach the browser.

## Workflows

**Standard change pipeline (the AutoLenis execution order):**

1. Load this skill, then the relevant `autolenis-<domain>` skill(s).
2. Run the reuse-before-create protocol ([`reference/capability-index.md`](reference/capability-index.md))
   and inspect the existing implementation (service, models, routes, tests) — read before write.
3. Produce a written plan for non-trivial work: the owning service, the models touched, the
   transitions affected, the tests that will prove it, and the rollback.
4. Write/adjust tests first (see `autolenis-testing-quality-gates`).
5. Implement inside the existing service layer.
6. `pnpm typecheck` → `pnpm lint` → `pnpm test:all` → browser/E2E where UI changed.
7. Impeccable audit for UI; `/code-review`; `/security-review` for sensitive surfaces.
8. Validate migrations + RLS + rollback (see `autolenis-supabase-postgres`).
9. `autolenis-production-readiness` gate → explicit PASS / PASS WITH CONDITIONS / BLOCKED.
10. Open a **draft** PR.

**Adding a new capability:** identify the owning domain → extend that `lib/services/<domain>`
service → expose it through the matching `app/api/<portal>` route handler → gate it in `proxy.ts`
if it needs a new protected surface → add the Prisma model/enum via a migration → test.

## Boundaries — do / never

**Do:**
- Keep the four-layer structure (route → service → infra → data).
- Put shared logic in a service and import it from every portal that needs it.
- Use the existing job runners (`after()`, Inngest, QStash) for async work.

**Never:**
- Create a second auth stack, payment path, ORM, or duplicate "v2" service.
- Call Stripe/Twilio/Resend/DocuSign/Supabase-service-role SDKs directly from `app/**` or components.
- Instantiate `new PrismaClient()` per request.
- Ship service-role keys or server secrets into the client bundle.
- Introduce a raw `middleware.ts` — routing/gating goes through `proxy.ts`.
- Mark work "done" because TypeScript compiles (see acceptance criteria).

## Best practices & examples

- **Thin handler, fat service:**
  ```ts
  // app/api/buyer/offers/route.ts  — thin
  export async function POST(req: Request) {
    const buyer = await requireBuyer(req);            // lib/auth
    const body  = await req.json();
    const offer = await offerService.acceptOffer(buyer.id, body); // lib/services/offer
    return Response.json(offer);
  }
  ```
- **Async side effects, non-blocking:**
  ```ts
  import { after } from 'next/server';
  after(() => notificationsService.sendOfferAccepted(offer)); // never blocks the response
  ```
- **State transitions in a transaction** with an audit write (see `autolenis-domain-model`).

## Acceptance criteria

- [ ] No new parallel/duplicate system; the change extends an existing service/model.
- [ ] Business logic sits in `lib/services/**`; handlers/components stay thin; no raw SDK calls outside adapters.
- [ ] Server-side authorization enforced for every privileged action.
- [ ] Async work uses `after()`/Inngest/QStash; nothing non-essential blocks the request.
- [ ] External boundaries are idempotent; multi-write state changes are transactional.
- [ ] Secrets stay server-side; no service-role key in the client bundle.
- [ ] `pnpm typecheck`, `pnpm lint`, and the relevant `pnpm test:*` suites pass.
- [ ] Migrations + RLS + rollback validated when the schema changed.

## Cross-skill links

- `autolenis-domain-model` — entities, relationships, and state-machine rules.
- `autolenis-auth-security-privacy` — the security constitution (load for any auth/PII/admin change).
- `autolenis-supabase-postgres` — schema, migrations, RLS.
- `autolenis-integrations` — third-party adapter rules.
- `autolenis-nextjs-react` — App Router / RSC conventions.
- `autolenis-testing-quality-gates` and `autolenis-observability-sre` — verification & operability.
- `autolenis-production-readiness` — the completion gate (PASS / CONDITIONS / BLOCKED).
- `autolenis-debugging` — root-cause loop when something is broken.
- `autolenis-deal-lifecycle` — the post-acceptance `DealStatus` state machine.
- `autolenis-inventory-intelligence` — inventory adapters, lanes, freshness.
- `autolenis-ui-design-system` — the token layer and the promoted component kit.
