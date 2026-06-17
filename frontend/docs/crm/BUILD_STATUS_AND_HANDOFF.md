# BUILD STATUS — Phases A & B (this session) + handoff for C–H

**Honest framing:** This session has the repo, code, and a Node runtime — but **not** the live Supabase DB, the prod Vercel env, the Make org, or a provisioned `node_modules`/Next build for this app. Per the brief's Definition of Done, anything I cannot prove is marked **BLOCKED (reason)**, never "complete."

## File placement (drop into `frontend/`)
| Artifact (this folder) | Repo path |
|---|---|
| `migration_13_add_nurture_status_and_recency.sql` | `migrations/13_add_nurture_status_and_recency.sql` |
| `reconcile-selection.ts` | `lib/crm/reconcile-selection.ts` |
| `reconcile-selection.test.ts` | `lib/crm/__tests__/reconcile-selection.test.ts` |
| `route.reconcile.run.ts` | `app/api/crm/reconcile/run/route.ts` |

## PHASE A — Reconcile endpoint `/api/crm/reconcile/run`
- **Readiness:** implementation-ready; **core logic PROVEN**, full-route CI **BLOCKED**.
- **Design (grounded):** static-key OR `Bearer CRON_SECRET` auth via the repo's own `timingSafeStrEqual` (`dispatch-auth-decision.ts:26`); Supabase `contacts` query against the **verified** schema (`migrations/01:22`); enrolls by forwarding a **signed** `reengagement_sweep` envelope through the existing `forwardToMake` (`lib/events/make-webhook.ts:43`). `event` is a free `string` on the envelope (`make-webhook.ts:31`), so **no typed-union change is needed** and the EVENT-BINDING rule is respected (the Router maps the new event → re-engagement campaign).
- **IRON RULE preserved:** the route never sends; it only emits enrollment events. Sends still flow Processor → `/api/crm/dispatch/*`.
- **PROOF (real):** `node reconcile-selection.proof.mjs` → **11 passed, 0 failed, exit 0** (selection predicate + boundary + null-fallback + unparseable-date cases). The vitest mirror (`reconcile-selection.test.ts`) is the same suite in the repo's framework.
- **BLOCKED:** `tsc`/`eslint`/`next build` and route/behavioral verification require the app's `node_modules` + a live Supabase. Run in CI: `pnpm i && pnpm tsc --noEmit && pnpm vitest run lib/crm/__tests__/reconcile-selection.test.ts && pnpm build`.

## PHASE B — `nurture_status` mirror (+ `last_contacted_at`)
- **Readiness:** migration ready; **BLOCKED on apply** (needs DB).
- Adds `contacts.nurture_status` (`none|active|suppressed|reengagement`, default `none`) and `contacts.last_contacted_at`, plus a partial coverage index. Idempotent; matches existing migration conventions.
- **Follow-up (separate small change):** stamp `last_contacted_at = now()` in the dispatch rail on a verified send, and set `nurture_status='active'/'reengagement'` on enrollment. Until then the sweep uses the `created_at` recency fallback (already handled in the predicate).

## PHASE C — Inactivity
- **Already LIVE app-side:** `buyer_inactive` is cron-emitted (`lib/inngest/functions.ts:646,679`, registered `:1142`, served `app/api/inngest/route.ts`). **No emitter build needed.**
- **Optional:** a `/api/crm/inactivity/run` HTTP analog (clone Phase A's auth + a `lifecycle_stage`-stale query emitting `buyer_inactive`) only if Make wants to poke it instead of relying on the Inngest cron.
- **`dealer_inactive` does not exist** in the union or code — net-new only if the dealer-reactivation funnel is actually wanted (decide first; do not build speculatively).

## PHASE D — Event coverage
- **~95% already emitted** (audit Keystone 4). Genuine remaining work:
  - `deposit_pending` — the only declared-but-unemitted event: **emit it** (e.g. Stripe `requires_action`/checkout-created in `app/api/webhooks/stripe/route.ts`) **or remove** it from `WorkflowTriggerType` (`lib/types/crm.ts`) to kill the dead trigger.
  - `dealer_registered`/`dealer_verified`/`affiliate_approved`/`affiliate_conversion` — only build if those campaigns go live; bind campaigns to the **real** names otherwise (`dealer_invited`, `affiliate_signup`).
  - `saved_search_matched` already exists — **do not "build the saved-search-match emitter"**; just bind the campaign to the real name.

## PHASE E — Router HMAC (spec)
Inbound verify in the Make Router: `HMAC-SHA256(MAKE_WEBHOOK_SECRET, rawBody)` → hex → constant-time compare to `X-AutoLenis-Signature`. Optionally reject `X-AutoLenis-Timestamp` skew > 5 min. (Identical scheme to the inbound dispatch HMAC path; different secret.)

## PHASE F — Coverage dashboard (depends on B)
NLLB KPI = `count(*) FROM contacts WHERE deleted_at IS NULL AND do_not_contact=false AND nurture_status='none' AND (last_contacted_at IS NULL OR last_contacted_at < now() - interval 'N days')`. Surface in admin; target ~0.

## PHASE G — migrations 06/07 applied to prod
In-repo ✅. Prod-applied = **BLOCKED (DB query)** — `select * from schema_migrations` (or your tracking table) on the Supabase project.

## PHASE H — STOP-handler consolidation (separate PR)
Confirmed split: `app/api/twilio/sms/inbound/route.ts:102` writes Prisma `SmsOptOut`; `app/api/webhooks/twilio/inbound/route.ts:103` writes `contacts` consent. Dispatch is safe (reads both, `crm-sms.ts:81–87`). Confirm the **active Twilio URL**, then unify to one plane.

---

## WHAT THE MAKE-ENABLED SESSION MUST DO NEXT (Step 6)
1. **Reactivate** keeper Processor **5410176** (UI), confirm the **corrected delta cadence** logic.
2. **Rotate** `CRM_DISPATCH_KEY`; inject into the **keeper ONLY** (single-key invariant). Add `X-AutoLenis-Timestamp` (epoch ms) and `X-Idempotency-Key` (`campaign:contact_id:step`) to the keeper's HTTP module — **required by the real contract**, not optional.
3. **Flip** the keeper's dispatch URL from the echo endpoint → real `/api/crm/dispatch/{email|sms}`; verify enrollment advancement.
4. Add the **Router (5355993) inbound HMAC verify** module per Phase E.
5. **Activate Reconciliation 5412069** *after* `/api/crm/reconcile/run` is deployed; point its HTTP module at it with `X-Dispatch-Key` (or `Bearer CRON_SECRET`), body `{job, dry_run, stale_days}`.
6. Add a Router mapping: `event == 'reengagement_sweep'` → enroll in the re-engagement campaign (uses the same dispatch rail).
7. Add a Router mapping for `buyer_inactive` (already arriving from the live cron) → win-back campaign — this is what makes Win-Back's trigger fully end-to-end.
8. Seed the remaining cadences in data store **108892**; bind every campaign to the **real** event names (audit Keystone 4 table), never the package's target names.
9. Remove the `crm-dispatch-echo-test` Supabase function (project `aieybibvewmvrubcpthm`).
