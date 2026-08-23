# Automation Vendor Retirement Readiness

Companion to `docs/inngest-migration-ledger.md`. Where the Inngest ledger tracks the
**executed** retirement of Inngest as a runtime, this document is the **evidence-based
readiness assessment** for the other automation vendors — **QStash, Make.com, GHL, and
Buffer** — produced by a repo-wide trace of every producer, consumer, guard, and env
gate. It authorizes **no cutover**: it maps each vendor, states a verdict, and lists the
owner-gated steps a future cutover would take.

> **Nothing here has been deleted, disconnected, or cut over.** All findings are
> read-only. Production env state (which secrets are actually set) cannot be read from
> the repo — every such item is flagged **OWNER-CHECK**.

---

## QStash (Upstash) — big & LIVE · retirement readiness

**What it is.** QStash is used **only as a delayed-HTTP job queue**: `dispatch()`
(`lib/qstash/dispatch.ts`) calls `publishJSON({ url, body, delay, retries })`. There are
**no QStash-native schedules/crons** — all recurring cadence is Vercel Cron
(`vercel.json`); multi-touch sequences are per-message `delaySeconds`. The client
(`lib/qstash/client.ts`), receiver/verify (`lib/qstash/{receiver,verify}.ts`), shared
DB stop-guards (`lib/qstash/state.ts`), and the send layer (`lib/qstash/notify.ts`,
TCPA-gated Twilio + suppression-gated Resend) complete the surface. Env:
`QSTASH_TOKEN`, `QSTASH_CURRENT_SIGNING_KEY`, `QSTASH_NEXT_SIGNING_KEY`
(`QSTASH_URL` is declared but **unused** — base URL comes from `NEXT_PUBLIC_APP_URL`).

**Consumers (16 routes under `app/api/jobs/**`).** Every route verifies the signature
(`verifyQStashRequest` → 401) and returns HTTP 500 on error so QStash retries. **None
mutates money/deal/auction/deposit state — all send notifications** and some chain the
next delayed touch. "Deal-path" below therefore means *triggered by / gated on* the
deposit/auction/offer/deal-completion path, not money movement.

### Migration split

**DEAL-PATH — DEFER TO THE BUSINESS-LIFECYCLE PROGRAM (do NOT rewire in this run):**
| Job route | Seeded from |
| --- | --- |
| `deposit-reminder` (3-touch $99 activation) | `buyer/deposit/create-intent`, `buyer/onboarding/complete` |
| `auction-active` → `auction-midpoint` → `auction-closing` | **Stripe webhook** (deposit PAID + auction created) |
| `offer-received` → `offer-follow-up` | `dealer/offers` (dealer submits an offer) |
| `dealer-invited` → `dealer-bid-reminder` | `auction/dealer-invitation.service` |
| `deal-complete` → (seeds `review-request`) | `admin/deals/[id]/pickup/complete` |

These are woven into the transaction funnel and read live deal state via
`lib/qstash/state.ts` (`hasPaidDeposit`, `hasSelectedOffer`, `hasDealerBid`). Rewiring
the payment/auction/deal path is explicitly **out of scope** for the automation-
consolidation run and belongs to the business-lifecycle program.

**BORDERLINE (funnel entry — treat as deal-path / defer):** `form-submitted`,
`check-form-completion` — generic in content but structurally sit in the
deposit-activation funnel and read live deposit state (`hasPaidDeposit`). Recommend
deferring with the deal-path set.

**NON-DEAL-PATH — internal Vercel-Cron + Postgres + idempotency parity is safe
(candidates, NOT built in this run):** `review-request`, `refinance-outreach`
(already fully idempotent via a `BuyerActivityEvent` guard — the cleanest first
candidate), `referral-nudge`, `affiliate-inactive`, `affiliate-reengagement-2`.

**Parity requirements any internal replacement MUST reproduce:** (1) the signature-
verify equivalent (worker auth), (2) the `lib/qstash/state.ts` stop-guards (+
`refinance-outreach`'s `BuyerActivityEvent` guard), (3) `retries`/HTTP-500 retry
behaviour, (4) the `jobs_dead_letter` DLQ capture in `dispatch.ts` that
`cron/dlq-drain` drains. **Idempotency gap to CLOSE, not replicate:** several un-guarded
jobs (`offer-received`, `dealer-invited`, `auction-active`, `deal-complete`,
`review-request`, `referral-nudge`, the affiliate jobs) have **no message-level dedup**
and can double-send on a QStash retry — an internal queue with a persisted dedup key
should fix this.

**DLQ crossover (important).** `OperationsService.autoDrainDeadLetterJobs` re-publishes
`qstash:*` dead-letter rows via `dispatch()` and all **other** rows via `inngest.send`.
Any QStash workload migrated to an internal path must ensure its dead-letter rows are
re-driven internally (columns-only terminal, as the Inngest content/intake batches did),
**not** through the QStash or Inngest re-emit branches.

**VERDICT — QStash:** **RETIREMENT-READY for the NON-DEAL-PATH set only, parity NOT yet
built (deferred).** The deal-path/borderline majority is **DEFERRED to the
business-lifecycle program**. No cutover; QStash stays fully wired. **OWNER-CHECK:**
confirm prod `QSTASH_*` secrets and current job volume before any cutover.

---

## Make.com — likely DORMANT · retirement readiness

**What it is.** A single signed-webhook forwarder: `forwardToMake(envelope)`
(`lib/events/make-webhook.ts`) HMAC-signs a versioned `DomainEventEnvelope` and POSTs it
to one Make "router" scenario. Its documented contract: *Make receives every domain
event and owns branching/delay/sequencing, but NEVER sends on its own — it calls back
into `/api/crm/dispatch/*` so AutoLenis owns the actual send + consent + suppression +
idempotency + audit.*

**Dormancy proof (repo-level).** Every dispatch **no-ops when `MAKE_WEBHOOK_URL` is
unset**: `emit.ts` only schedules the forward `if (process.env.MAKE_WEBHOOK_URL)` (else a
WARN), and `make-webhook.ts` returns early when it or `MAKE_WEBHOOK_SECRET` is unset.
`forwardToMake` returns `Promise<void>`, **resolves-never-rejects**, is fire-and-forget
via `after()` (5s timeout), and **no caller inspects its result** — nothing in the repo
depends on the forward succeeding. `MAKE_WEBHOOK_URL` has **no functional reader** besides
the gate + the forwarder.

**Internal equivalent already exists.** The same domain events are consumed internally by
`emitDomainEvent` itself — contact upsert, forward-only lifecycle-stage advance +
`stage_changed` timeline, `domain_event` timeline row, lead scoring
(`recordScoringAction`), interest-tag segmentation. The **actual sends** are owned by the
internal `WorkflowEngine` (`triggerForEvent` + `action.sendEmail/sendSms`) and the
`/api/crm/dispatch/*` endpoints. Make adds **only** externally-hosted scenario
orchestration (branching/delay/sequencing), for which the in-app engine is a built,
flag-gated (`CRM_INAPP_ENGINE_ENABLED`, default off) replacement.

**VERDICT — Make.com:** **READY-TO-RETIRE (no build required to preserve internal data).**
Owner cutover checklist: (1) **OWNER-CHECK** whether prod has `MAKE_WEBHOOK_URL` set AND
`CRM_INAPP_ENGINE_ENABLED` off — if so, live nurture *sequencing* runs only in Make today
and must be enabled in-app (or accepted as lost) before unsetting the URL; (2) unset
`MAKE_WEBHOOK_URL` / `MAKE_WEBHOOK_SECRET`; (3) optionally remove the forwarder. **Do NOT
delete/disconnect in this run.**

---

## GHL (GoHighLevel) — fire-and-forget tag sync · retirement readiness

**What it is.** The entire GHL surface is `syncGhlTag(email, tag)`
(`lib/services/ghl/tag-sync.ts`, ~17 lines): POST `{ email, tags:[tag] }` to
`GHL_WEBHOOK_URL`, fire-and-forget, `void` return, `.catch(()=>{})`. **No-ops when
`GHL_WEBHOOK_URL` is unset or `email` is missing.** Nothing in the repo reads GHL data
back — it is a pure outbound sink. Two adjacent env-gated webhooks exist:
`GHL_PARTIAL_LEAD_WEBHOOK_URL` and client-side `NEXT_PUBLIC_GHL_THANKYOU_WEBHOOK_URL`
(same no-op-if-unset pattern).

**Tags synced (10 sites):** `deposit-paid`, `offer-received`, `offer-selected`,
`dealer-invited`, `dealer-won`, `dealer-applied`, `dealer-approved`,
`affiliate-applied`, `affiliate-approved`, `purchase-complete`.

**Already captured internally.** Every tagged milestone is a domain event AutoLenis
already records natively via `emitDomainEvent`: the same events write
`contact_timeline_events`, advance `lifecycle_stage`, accrue lead score, and set
`contacts.tags`. The tags are outbound labels for GHL-hosted automations; their *meaning*
already lives in AutoLenis's own CRM.

**VERDICT — GHL:** **READY-TO-RETIRE (minimal/no build).** The only thing lost is external
GHL-side automations keyed on those tags — an operational/marketing concern, not a code
dependency. Owner cutover checklist: (1) **OWNER-CHECK** whether GHL-hosted journeys are
live off these tags in prod; (2) if a specific automation must persist, map it to the
internal CRM (segment + workflow) first; (3) unset `GHL_WEBHOOK_URL` /
`GHL_PARTIAL_LEAD_WEBHOOK_URL` / `NEXT_PUBLIC_GHL_THANKYOU_WEBHOOK_URL`. **Do NOT
delete/disconnect in this run.**

---

## Buffer — real social infra · retirement readiness

**What it is.** A full `PublishingProvider` against Buffer's GraphQL API
(`lib/social/providers/buffer.provider.ts`, Bearer `BUFFER_API_KEY`) plus an admin
management surface (list/edit/duplicate/delete). Provider selection
(`publishing.factory.ts`): Facebook/Instagram → `MetaProvider` if `META_ACCESS_TOKEN`
else Buffer; TikTok → `TikTokProvider` if `TIKTOK_ACCESS_TOKEN` else Buffer; LinkedIn →
`LinkedInProvider` if `LINKEDIN_ACCESS_TOKEN` else Buffer; **YouTube → always delegates to
Buffer (no first-party publish surface); default/unknown → Buffer.** Publishing is
**disabled by default** (`ENABLE_BUFFER_PUBLISHING`, ships empty → `NoopPublishingProvider`
returns "publishing disabled").

**What actually publishes.** The `social-publish-queue` cron (every 5m) selects due
`APPROVED`/`SCHEDULED` `SocialPost` rows across tiktok/instagram/facebook/youtube/linkedin
and calls `publishApprovedPost` (atomic row claim). Direct-platform providers
(Meta Graph API, TikTok Content Posting API, LinkedIn ugcPosts) **supersede Buffer when
their token is set** — but they publish immediately (no native scheduling; AutoLenis's own
DB+cron handles future scheduling). **YouTube has NO in-repo direct publisher** — retiring
Buffer removes the only YouTube publish surface, and Buffer is the universal fallback for
every platform when direct tokens are absent.

**VERDICT — Buffer:** **PARITY-NOT-JUSTIFIED (keep / document, do not build speculative
social infra).** Direct-platform parity already exists for FB/IG/TikTok/LinkedIn; replacing
Buffer would require net-new YouTube upload OAuth+resumable-upload infrastructure plus
re-implementing provider-native scheduling and the admin management surface — speculative
work with no clear economic justification given Buffer ships gated-off. Recommend
**documenting** Buffer as (a) the YouTube publish surface and (b) the universal fallback,
rather than retiring it. **OWNER-CHECK:** whether prod sets `ENABLE_BUFFER_PUBLISHING=true`
and which of `META_/TIKTOK_/LINKEDIN_ACCESS_TOKEN` are set — that determines how much live
traffic flows through Buffer vs direct APIs today.

---

## Cross-vendor summary

| Vendor | No-ops when unset | Anything depends on its response | Internal equivalent | Verdict |
| --- | --- | --- | --- | --- |
| **QStash** | n/a (LIVE) | Consumers send notifications; no money mutation | Vercel-Cron+Postgres substrate (proven) | **Non-deal set retirement-ready (parity not built); deal-path DEFERRED** |
| **Make.com** | Yes | No | `WorkflowEngine` + `/api/crm/dispatch/*` (flag-gated) | **Ready-to-retire · OWNER-CHECK prod flags** |
| **GHL** | Yes | No (`void`, `.catch`) | contacts/lifecycle/timeline/tags via `emitDomainEvent` | **Ready-to-retire · OWNER-CHECK GHL automations** |
| **Buffer** | Yes (Noop provider) | Publish outcome consumed; self-heals to FAILED/retry | Partial — direct FB/IG/TikTok/LinkedIn; **no direct YouTube** | **Parity-not-justified (keep/document) · OWNER-CHECK prod tokens** |

**No production side effects were produced generating this assessment, and no vendor
config, route, key, package, or subscription was changed.**
