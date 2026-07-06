# RBAC Shadow Classification — getAdminActor CRM/ops routes (T4 review input)

**Status:** SHADOW ONLY — `requirePermissionActor` records `RBAC_SHADOW_DENY` and allows; `RBAC_ENFORCE` unset. This table is the owner's input for the 224-route bucketing review **before** hard-enforcement.
**Method (as pinned):** classified by the handler's ACTUAL data operations, not route name or HTTP method (POST-preview/search READ; a GET with a write MANAGES). Ambiguity biased toward **manage** — over-restriction is a recoverable shadow-deny; under-restriction would ship an unguarded write into sign-off.

## Policy → roles (see lib/auth/permissions.ts)
- `crm.read` → ALL roles (never denies in shadow; brings reads into the layer/report)
- `crm.manage` → SUPER + OPERATIONS
- `comms.bulk_send` → SUPER + OPERATIONS (mass/campaign fan-out, incl. any route that CAN fan out sends)
- `comms.reply` → SUPER + OPERATIONS + **SUPPORT** (single agent reply; support-capable, no bulk authority)
- `ops.replay` → **SUPER only** (replays a failed job — arbitrary inherited side effects)
- `ai.use` → ALL (policy 5: read+draft; logged under the invoking human)

## Owner five-flag dispositions applied (post-review)
1. **automations/[id]/trigger → `comms.bulk_send`** (was crm.manage). Classified by MAX reachable side-effect: a route that can fan out sends is a mass-send route for authz.
2. **operations/dlq/[id]/retry → `ops.replay` (SUPER-only)** (was crm.manage). New highest-privilege tier. **Idempotency verified:** the replay re-emits the Inngest event with the SAME payload, so `emailSendFn`/`smsSendFn` derive the same `uniqueKey` and `acquireIdempotencyGuard` returns `DUPLICATE_BLOCKED` — a manual replay hits the same payload-derived guard as any other emission. It does **not** route around Phase 0.5: the DLQ handles the **Inngest** plane; Phase 0.5's `PaymentProviderEvent.eventId` transactional claim protects the **Stripe webhook** plane (Stripe retries are Stripe-driven, they don't dead-letter here). **One narrow caveat for you:** the fallback key is date-bucketed (`…:email_send:<YYYY-MM-DD>`), so a replay of a *keyless* send job across a midnight boundary would derive a different key and could re-send. Jobs that pass an explicit `idempotencyKey` (payment/commission-origin) are unaffected. Pre-existing property of the send functions, not introduced here; the SUPER-gate + manual nature bounds it. Flagging for a possible follow-up (stable key or a replay-preserves-original-key path).
3. **conversations/[id]/reply → `comms.reply`** (was comms.bulk_send). New support-capable tier distinct from bulk campaigns, aligning with SUPPORT_ADMIN policy (support replies without holding bulk authority).
4. **copilot → `ai.use`: confirmed**, plus a durable-intent test (`test:crm-audit`) asserting the audit row carries the HUMAN actor identity (`admin_id`/`admin_email` from the actor), never `system`.
5. **Four POST-reads → `crm.read`: confirmed.**

## Classification

| Route | Handler(s) | Op basis | Permission |
|---|---|---|---|
| crm/automations | GET | list | crm.read |
| crm/automations | POST | create automation | crm.manage |
| crm/automations/[id] | GET | read | crm.read |
| crm/automations/[id] | PATCH, DELETE | update/delete | crm.manage |
| crm/automations/[id]/enrollments | GET | read | crm.read |
| crm/automations/prebuilt | GET | read | crm.read |
| crm/automations/[id]/activate | POST | state change | crm.manage |
| crm/automations/[id]/pause | POST | state change | crm.manage |
| crm/automations/[id]/versions/[versionId]/restore | POST | mutate | crm.manage |
| **crm/automations/[id]/trigger** | POST | fires automation | **comms.bulk_send** ✅ (reclassified: max reachable side-effect = mass send) |
| crm/badges | GET | read | crm.read |
| crm/campaigns | GET | list | crm.read |
| crm/campaigns | POST | create campaign | crm.manage |
| crm/campaigns/[id] | GET | read | crm.read |
| crm/campaigns/preview | POST | **preview compute, 0 writes** | crm.read ⚠️ (POST-read) |
| crm/contacts | GET | list | crm.read |
| crm/contacts | POST | create | crm.manage |
| crm/contacts/[id] | GET | read | crm.read |
| crm/contacts/[id] | PATCH, DELETE | update/delete | crm.manage |
| crm/contacts/backfill | POST | bulk mutate | crm.manage |
| crm/conversations | GET | list | crm.read |
| crm/conversations/[id]/messages | GET | read | crm.read |
| crm/conversations/[id]/read | POST | mark-read (write) | crm.manage |
| crm/conversations/[id]/escalate | PATCH | mutate | crm.manage |
| crm/conversations/[id]/resolve | POST | mutate | crm.manage |
| **crm/conversations/[id]/reply** | POST | **outbound message to contact** (8 send calls) | **comms.reply** ✅ (reclassified: support-capable single reply, distinct from bulk) |
| **crm/copilot** | POST | **AI draft, 0 writes** | **ai.use** ✅ (policy 5; human-actor audit pinned by test:crm-audit) |
| crm/messages/sent | GET | read | crm.read |
| crm/segments | GET | list | crm.read |
| crm/segments | POST | create | crm.manage |
| crm/segments/[id] | GET | read | crm.read |
| crm/segments/[id] | PATCH | update | crm.manage |
| crm/segments/preview | POST | **preview compute, 0 writes** | crm.read ⚠️ (POST-read) |
| crm/tasks | GET | list | crm.read |
| crm/tasks | POST | create | crm.manage |
| crm/tasks/[id] | PATCH | update | crm.manage |
| crm/templates | GET | list | crm.read |
| crm/templates | POST | create | crm.manage |
| crm/templates/[id] | GET | read | crm.read |
| crm/templates/[id] | PATCH | update | crm.manage |
| crm/templates/preview | POST | **preview compute, 0 writes** | crm.read ⚠️ (POST-read) |
| search | GET | global read | crm.read |
| operations/analytics/refresh | POST | recompute analytics | crm.manage |
| **operations/dlq/[id]/retry** | POST | **replays a failed job** | **ops.replay** ✅ (reclassified: SUPER-only; highest-privilege — arbitrary inherited side effects) |

## Non-obvious calls — RESOLVED by owner five-flag dispositions (history retained)
All five reviewed; three reclassified toward tighter restriction, two confirmed. Live in code (`lib/auth/permissions.ts` + route bindings) as of commit a91a3cc.
1. **automations/[id]/trigger** — ✅ **RECLASSIFIED crm.manage → comms.bulk_send** (max reachable side-effect = mass send).
2. **conversations/[id]/reply** — ✅ **SPLIT to comms.reply** (support-capable, distinct from bulk campaigns; aligns with SUPPORT_ADMIN).
3. **copilot** — ✅ **ai.use CONFIRMED**; human-actor audit attribution pinned by a durable-intent test (`test:crm-audit`).
4. **operations/dlq/[id]/retry** — ✅ **RECLASSIFIED crm.manage → ops.replay (SUPER-only)**, the new highest-privilege tier. Idempotency verified (re-emits same Inngest payload → same `acquireIdempotencyGuard` key); date-bucketed keyless-send caveat flagged above.
5. **All four POST-reads** — ✅ **crm.read CONFIRMED** (zero writes despite POST).

**Enforce-flip note:** the two up-tiered routes (trigger, dlq/retry) now emit a different `RBAC_SHADOW_DENY` signal than pre-reclassification, so they reset their own meaningful soak window. Do not compile the bucketing report from pre-reclassification data.

## Coverage
- getAdminActor route call-sites remaining: **0** (all 39 migrated: 5 destructive sends in the prior commit + 34 here). `lib/auth/admin-actor.ts` retains the underlying `getAuthenticatedAdmin` helpers used by `requirePermissionActor`.
- The 25 pre-existing `getAdminWithRole` routes already enforce roles and are unchanged (already correct).
- Next for the report: run the shadow layer for the owner's chosen soak window, then compile the `RBAC_SHADOW_DENY` frequencies per (permission, role) so real deny patterns inform any relaxation before the enforce flip.
