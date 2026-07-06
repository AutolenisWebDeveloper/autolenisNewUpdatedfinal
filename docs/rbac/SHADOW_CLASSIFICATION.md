# RBAC Shadow Classification — getAdminActor CRM/ops routes (T4 review input)

**Status:** SHADOW ONLY — `requirePermissionActor` records `RBAC_SHADOW_DENY` and allows; `RBAC_ENFORCE` unset. This table is the owner's input for the 224-route bucketing review **before** hard-enforcement.
**Method (as pinned):** classified by the handler's ACTUAL data operations, not route name or HTTP method (POST-preview/search READ; a GET with a write MANAGES). Ambiguity biased toward **manage** — over-restriction is a recoverable shadow-deny; under-restriction would ship an unguarded write into sign-off.

## Policy → roles (see lib/auth/permissions.ts)
- `crm.read` → ALL roles (never denies in shadow; brings reads into the layer/report)
- `crm.manage` → SUPER + OPERATIONS
- `comms.bulk_send` → SUPER + OPERATIONS (mass/outbound comms)
- `ai.use` → ALL (policy 5: read+draft; logged under the invoking human)

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
| **crm/automations/[id]/trigger** | POST | fires automation | **crm.manage ⚠️** — may fan out downstream sends; consider comms.bulk_send |
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
| **crm/conversations/[id]/reply** | POST | **outbound message to contact** (8 send calls) | **comms.bulk_send ⚠️** — single outbound; owner may want a narrower comms.reply tier |
| **crm/copilot** | POST | **AI draft, 0 writes** | **ai.use ⚠️** (policy 5) |
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
| **operations/dlq/[id]/retry** | POST | **replays a failed job** | **crm.manage ⚠️** — a replayed job can re-fire arbitrary side effects incl. sends; consider a dedicated ops.dlq tier |

## Non-obvious calls flagged for your review (⚠️)
1. **automations/[id]/trigger** — gated crm.manage, but a triggered automation may fan out sends. Decide: keep manage, or comms.bulk_send.
2. **conversations/[id]/reply** — a single outbound message; gated at comms.bulk_send (the only outbound tier today). Decide whether single replies warrant a narrower tier than bulk campaigns.
3. **copilot** — AI draft generation, gated ai.use per policy 5 (all roles read+draft). Confirm the copilot's actions are logged under the invoking admin (they are — `actor` is passed through).
4. **operations/dlq/[id]/retry** — replays failed jobs; gated crm.manage. A replay can re-fire any side effect. Decide whether this deserves an ops-restricted or SUPER tier.
5. **All four POST-reads** (campaigns/segments/templates preview, and note search is GET) — classified read despite POST because they perform zero writes.

## Coverage
- getAdminActor route call-sites remaining: **0** (all 39 migrated: 5 destructive sends in the prior commit + 34 here). `lib/auth/admin-actor.ts` retains the underlying `getAuthenticatedAdmin` helpers used by `requirePermissionActor`.
- The 25 pre-existing `getAdminWithRole` routes already enforce roles and are unchanged (already correct).
- Next for the report: run the shadow layer for the owner's chosen soak window, then compile the `RBAC_SHADOW_DENY` frequencies per (permission, role) so real deny patterns inform any relaxation before the enforce flip.
