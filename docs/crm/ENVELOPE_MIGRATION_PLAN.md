# Admin-CRM Response-Envelope Migration — Blast-Radius Audit & Plan

**Status:** PLAN — for owner review before any handler edit. No code changed by this document.
**Goal:** Close the last split response contract on the platform. Convert the admin-CRM route
surface from bare `NextResponse.json({...})` / `{error:"STRING"}` to the canonical
`adminSuccess`/`adminError` envelope, so admin-CRM is contract-identical to buyer/dealer/affiliate/
admin-non-CRM and the typed `lib/api/client` no longer throws-on-success against it.

---

## 1. Blast-radius audit (gate — completed before edits)

**Surface:** 38 route files under `app/api/admin/crm/**`. **37 to convert** — `coverage/route.ts`
already emits `adminSuccess`. Method distribution across the 37: 19 GET, 23 POST, 6 PATCH, 2 DELETE.

**Current shape (verified):** 37/37 return bare `NextResponse.json({ <field>: ... })` on success
(no `success:true`, payload at top level or under an ad-hoc key like `contact`/`workflow`/`mode`)
and `NextResponse.json({ error: "STRING" }, { status })` on failure. **Zero** use the object-error
form today.

**Consumers (verified — the full runtime blast radius):**
- **20 client files** (18 components + 2 pages): `app/admin/crm/inbox/page.tsx`,
  `app/admin/crm/tasks/page.tsx`, and `components/admin/crm/{AddContactModal, BulkComposeEmailModal,
  BulkComposeSmsModal, CampaignBuilder, ComposeEmailModal, ComposeSmsModal, ContactList,
  CopilotPanel, CrmShell, ImportContactsModal, SegmentBuilder, TemplateEditor, WorkflowBuilder,
  WorkflowList}`. (DlqRetryButton / RefreshAnalyticsButton / GlobalSearch call the 3 adjacent
  non-CRM routes in §6, not `crm/**`.)
- **Server-side fetchers: ZERO.** The 4 server files that matched `/api/admin/crm/` contain only
  doc-comment path references, not internal `fetch()` calls.
- **Test consumers: ZERO.** No `*.test.ts(x)` references these paths.
- **Direct route-handler imports: ZERO.** No module imports a CRM `route.ts` handler directly.

⇒ **Each CRM route's only runtime consumers are the client files above.** The migration cannot
break a server caller, a cron, or a test fixture — the surface is fully enumerated and bounded.

---

## 2. Target contract (from `lib/auth/admin-api.ts`)

```
adminSuccess<T>(data, status=200) → { success: true, data }                              // 2xx
adminError(code, message, status=400) → { error: { code, message }, correlationId }      // non-2xx
```

`lib/api/client` unwraps `data` and throws `ApiError(code,message,status)` when
`!res.ok || body.success !== true`.

**⚠ Decision point for you — error shape.** Your directive said normalize to
`{ success:false, error:{ code, message } }`, but the platform's canonical `adminError` emits
`{ error:{ code, message }, correlationId }` **without** a `success:false` field — and that is what
buyer/dealer/affiliate/admin-non-CRM already return and what the typed client already handles
(it keys off `res.ok` + `success===true`, never needing `success:false`). Two options:
  - **(A) Recommended — use `adminError` verbatim** (`{error:{code,message},correlationId}`). Keeps
    admin-CRM *contract-identical to the rest of the platform*; no platform-wide helper change.
  - **(B)** Extend `adminError` to also emit `success:false`. This is a **platform-wide** change to
    every dashboard's error shape, not a CRM-local one, and mildly contradicts "contract-identical."
I recommend **(A)** and will proceed with it unless you say otherwise. Flagging rather than
silently choosing, since your wording and the existing helper differ.

---

## 3. Migration unit, atomicity, per-commit floor

- **Unit = one route file + ALL its consumer read-sites, in one commit.** Revertable in isolation,
  green-on-arrival (same atomicity precedent as the lint-guard and RBAC enforce-flip).
- A consumer that reads N different routes is touched in N commits (once per route as it converts).
  Between commits the consumer legitimately holds *mixed* reads (new shape for converted routes, old
  for not-yet-converted) — each intermediate state compiles and runs. That is expected and safe.
- **Per-commit floor (all must pass before commit):**
  1. project-wide `tsc --noEmit` green,
  2. lint **warning-neutral** (no floor rise),
  3. a **per-route contract test** asserting the handler now returns `{success:true,data}` on the
     success path and `{error:{code,message}}` on a forced-failure path (harness in §5).
- **Consumer read-site update, same commit:** where the request body is JSON and the read is simple,
  finish onto the typed `api.*` client (kills split-contract *and* depth-read at once). Where the
  request is non-JSON (CSV import) or the site is optimistic/fire-and-forget/status-inspecting, keep
  raw `fetch` but update the manual parse to the new `{success,data}` shape. (This mirrors the
  zero-render lane's per-site discipline.)

---

## 4. Batch order (reads first → mutations last)

**Phase 1 — pure-GET route files (lowest risk, 8 files):**
`admins`, `automations/[id]/enrollments`, `automations/prebuilt`, `badges`, `campaigns/[id]`,
`conversations`, `conversations/[id]/messages`, `messages/sent`.
Consumers: `inbox` (conversations, messages, admins), `CrmShell` (badges — reads top-level
`unread`/`overdue` → `data.unread`/`data.overdue`), `CampaignBuilder`/`WorkflowBuilder`/`WorkflowList`
(campaigns/[id], enrollments, prebuilt).

**Phase 2 — mixed GET+mutation resource files (convert whole file; GET+write together):**
`contacts` (GET,POST), `contacts/[id]` (GET,PATCH,DELETE), `campaigns` (GET,POST), `segments`
(GET,POST), `segments/[id]` (GET,PATCH), `templates` (GET,POST), `templates/[id]` (GET,PATCH),
`tasks` (GET,POST), `tasks/[id]` (PATCH), `automations` (GET,POST), `automations/[id]`
(GET,PATCH,DELETE).
Consumers: `ContactList`, `AddContactModal`, `CampaignBuilder`, `SegmentBuilder`, `TemplateEditor`,
`tasks` page, `WorkflowBuilder`, `WorkflowList`. Top-level-key readers normalized to `data.*`
(`data.contact`, `data.segment`, `data.template`, `data.campaign`, `data.workflow`, `data.versions`).

**Phase 3 — pure-mutation / action route files (highest privilege last):**
`contacts/backfill` (→ `data.buyers_synced`), `contacts/import` (**CSV body stays raw fetch**;
response read → `data.imported`), `contacts/[id]/send-email`, `contacts/[id]/send-sms`,
`campaigns/preview` (→ `data.preview`), `campaigns/bulk-send` (→ `data.queued`/`data.total`),
`segments/preview` (→ `data.count`), `templates/preview` (→ `data.rendered`),
`conversations/[id]/{read,resolve,escalate,reply}`, `automations/[id]/{activate,pause,trigger,
versions/[versionId]/restore}`, `copilot` + `copilot/approve` (**special — see §5**).

> Granularity default = per route file (~30 commits). If you'd rather fewer, larger commits, the
> natural coarser unit is **per resource** (all `templates/*` in one commit with `TemplateEditor`,
> etc.) — still revertable and green-on-arrival, ~9 commits. **Tell me which granularity you want.**

---

## 5. Special cases & the contract-test harness

- **`copilot` (POST)** returns top-level `{ mode, draft, plan, issues }` — the largest consumer diff:
  `CopilotPanel` reads `json.mode/draft/plan/issues` → after enveloping, `data.mode/...`. Mechanical
  but touches several read-sites; do it as its own commit. Its RBAC gate (`ai.use`) and the
  human-actor audit test are unaffected by a response-shape change.
- **`ImportContactsModal`** sends `text/csv` — the **request** cannot move to the JSON-only typed
  client; only the **response** read updates to `data.imported`. Stays on raw `fetch`.
- **Optimistic / fire-and-forget consumers** (mark-read, resolve, some workflow toggles): keep their
  optimistic semantics; only update the shape they parse on the paths they *do* read.
- **Contract-test harness (new, per-route):** a parametrized test per resource under
  `app/api/admin/crm/__tests__/` using `--experimental-test-module-mocks` (same pattern as the
  existing webhook/insurance route tests): mock `getAdminActor`/`requirePermissionActor` → authed
  actor, stub prisma/services, invoke the handler, assert the success body is `{success:true,data}`
  and a forced-failure body is `{error:{code,message}}` with the right status. Wired as
  `test:crm-routes` in package.json; runs in the per-commit floor.

---

## 6. Addendum — 3 adjacent non-CRM routes (same split-contract, CRM consumers)

These live outside `crm/**` but are called by CRM components and exhibit the identical bare shape:
- `app/api/admin/search` (GET) → `{contacts:[]}` / `{error:"STRING"}` — consumer `GlobalSearch`.
- `app/api/admin/operations/dlq/[id]/retry` (POST) → `{ok:true}` / `{error:"STRING"}` — consumer
  `DlqRetryButton`. **RBAC-gated `ops.replay`.**
- `app/api/admin/operations/analytics/refresh` (POST) → `{ok:true,refreshed_at}` / `{error:"STRING"}`
  — consumer `RefreshAnalyticsButton`. **RBAC-gated `crm.manage`.**

Enveloping their *response* does **not** touch their RBAC gates, so there is **no interaction with
the enforce-flip soak**. Recommend folding them into Phase 3 for completeness (they're the same
consumers' concern). **Confirm whether to include them or leave strictly to `crm/**`.**

---

## 7. Decisions requested before execution
1. **Error shape:** (A) `adminError` verbatim `{error:{code,message},correlationId}` *(recommended)*
   vs (B) add `success:false` platform-wide.
2. **Commit granularity:** per-route-file (~30 commits) vs per-resource (~9 commits).
3. **Addendum routes:** include the 3 adjacent (search / dlq-retry / analytics-refresh) or CRM-only.

On your answers I execute batch-by-batch, per-commit review, no bulk shape-flips.
