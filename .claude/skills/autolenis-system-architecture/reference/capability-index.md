# AutoLenis capability index — search here before creating anything

**Purpose:** make "does this already exist?" a 30-second question instead of a
guess. Golden Rule 1 is *extend the existing architecture — never build a
parallel system*; this index is the lookup table that makes the rule cheap to
follow.

**Scope:** `frontend/` (the production app). Counts below were generated from
the repository; re-generate rather than trusting them if the tree has moved on.

---

## The reuse-before-create protocol

Run this **before** adding a service, table, component, hook, utility, route,
queue, worker, job, agent, workflow, integration, or abstraction.

```bash
cd frontend

# 1. Is there a service domain for this concept?
ls lib/services | grep -i <concept>
grep -ril "<concept>" lib/services --include=*.ts | head

# 2. Is there already a model / enum?
grep -n "model .*<Concept>\|enum .*<Concept>" prisma/schema.prisma

# 3. Is there already a route surface?
find app/api -type d -iname "*<concept>*"

# 4. Is there already a component / hook / util?
find components lib/hooks lib/utils -iname "*<concept>*"

# 5. Is there already a cron / job / adapter?
ls app/api/cron | grep -i <concept>
grep -rn "<concept>" lib/inngest lib/qstash --include=*.ts | head
```

### Decision model

| Search result | Action |
| --- | --- |
| **Existing capability** covers it | **Reuse or improve it.** Do not wrap it in a new name. |
| **Partial capability** exists | **Extend or refactor it in place**, preserving current callers and tests. |
| **No capability** | Create the **minimum** new architecture, in the owning domain, matching existing conventions. |

If you create something new, state in the PR *what you searched for and why
nothing matched*. An unexplained new subsystem is treated as a duplicate.

---

## Service layer — `lib/services/` (46 domains)

Business logic lives here, one folder per domain. **Find the owner before
adding a folder.**

| Cluster | Domains |
| --- | --- |
| Buyer funnel | `prequal` · `buyer` · `vehicle-request` · `shortlist` · `insurance` · `nudge` · `refinance` |
| Auction & offers | `auction` · `offer` · `search` |
| Deal → delivery | `deal` · `contract` · `contract-shield` · `esign` · `pickup` · `trade-in` · `documents` · `agreement` |
| Dealer | `dealer` · `dealer-recruitment` · `acquisition` |
| Money | `payment` · `deposit` · `affiliate` · `referral` |
| Inventory | `inventory` (+ `inventory/adapters`) |
| Comms | `sms` · `email` · `messaging` · `notifications` · `voice` |
| AI | `ai` |
| Growth / content | `content` · `seo` · `crm` · `analytics` |
| Platform | `admin` · `audit` · `auth` · `identity` · `trust` · `monitoring` · `system` · `activity` · `ghl` · `faith` |

Root-level services (not domain folders): `analytics.service.ts`,
`campaign.service.ts`, `contact.service.ts`, `operations.service.ts`,
`segment.service.ts`, `suppression.service.ts`, `template.service.ts`,
`workflow.engine.ts`, `workflow.prebuilt.ts`, `workflow.service.ts`.

## Shared infrastructure — `lib/`

`prisma.ts` (singleton) · `supabase.ts` / `supabase-service.ts` /
`supabase-browser.ts` · `stripe.ts` · `logger.ts` · `admin-auth.ts` ·
`dealer-auth.ts` · `auth/` · `security/` · `payments/` · `inngest/` ·
`qstash/` · `observability/` · `events/` · `tools/` · `ai/` · `voice/` ·
`social/` · `amips/` · `crm/` · `leads/` · `content/` · `seo/` · `design/` ·
`api/` · `hooks/` · `utils/` · `constants/` · `types/`.

## Route surfaces — `app/api/` (18 groups)

`admin` · `affiliate` · `auth` · `buyer` · `concierge` · `crm` · `cron` ·
`dealer` · `faith` · `finder` · `inngest` · `internal` · `jobs` · `leads` ·
`public` · `tools` · `twilio` · `webhooks`

- **47** cron routes under `app/api/cron/` — check here before adding a
  scheduled job, and register new ones in `frontend/vercel.json`.
- **8** webhook handlers under `app/api/webhooks/` — extend the existing
  handler for a provider; never add a second endpoint for the same provider.

## Data — `prisma/schema.prisma`

**205 models · 80 enums.** Before adding either:
`grep -n "^model \|^enum " prisma/schema.prisma`. A new status field almost
always belongs in an existing enum — see `autolenis-domain-model`.

## UI

- `components/admin/crm/ui/` — the **promoted platform kit** (`Button`,
  `Badge`, `DataTable`, `KpiCard`, `PageHeader`, `Toolbar`, `Tabs`,
  `SlideOver`, `ConfirmDialog`, `EmptyState`, `ErrorState`, `Skeleton`).
  Standing directive: promote it platform-wide; **no net-new component
  system** without owner sign-off.
- `components/ui/` — shadcn primitives (11).
- Tokens: `app/globals.css` `@theme` (`--al-*`, `--crm-*`) — canonical;
  `lib/design/tokens.ts` — `(public)` landing surfaces only.
  See `autolenis-ui-design-system`.

## Background work — pick an existing runner

| Need | Use |
| --- | --- |
| Fire-and-forget inside a request | Vercel `after()` |
| Durable / event-driven | Inngest (`lib/inngest`, `app/api/inngest`) |
| Scheduled / delayed HTTP | Upstash QStash (`lib/qstash`) |
| Recurring platform job | `app/api/cron/**` + `vercel.json` |

Do not introduce a fourth job runner.

## Known duplication hazards (repo-specific)

- **Two apps.** `frontend/` is production; `backend/` is a secondary FastAPI
  service. Do not migrate frontend logic into `backend/`.
- **Two workflow engines.** `lib/services/workflow.engine.ts` (in-app, CRM
  nurture) is **kill-switched off by default** (`CRM_INAPP_ENGINE_ENABLED`)
  because Make.com owns nurture dispatch post-cutover. Enabling it alongside
  Make double-sends. Check the flag before touching either path.
- **Three design artifacts.** `globals.css` (canonical) vs
  `docs/design-system/AUTOLENIS_UI_SPEC.md` (spec) vs `design_guidelines.json`
  (**stale, dark theme, do not follow**).
- **Retired inventory adapters.** AutoTrader / Cars.com / CarGurus / TrueCar /
  Edmunds files exist but are deliberately **out of the active adapter list**;
  they return `[]`. Do not re-register them.
- **No `middleware.ts`.** Edge routing/gating goes through `frontend/proxy.ts`.
