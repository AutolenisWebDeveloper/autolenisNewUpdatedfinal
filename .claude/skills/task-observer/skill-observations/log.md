# Skill Observation Log

Observations captured during task-oriented work.

**Status key:** OPEN = not yet actioned | ACTIONED (YYYY-MM-DD) = skill updated/created | DECLINED (YYYY-MM-DD) = user decided not to pursue

---

## 2026-08-25

### Observation 1: Deposit-reminder producer does not exclude concierge deposits

**Status:** OPEN
**Date:** 2026-08-25
**Session context:** $99 deposit conversion & pre-activation gate program (deposit-conversion-gate branch)
**Skill:** autolenis-buyer-journey (and autolenis-payments-and-ledger)
**Type:** internal
**Phase/Area:** deposit reminder enrollment / concierge exclusion

**Issue:** `app/api/buyer/deposit/create-intent/route.ts` dispatches the QStash deposit-reminder sequence for BOTH standard (`type:"deposit"`) and concierge (`type:"concierge_deposit"`) deposits — the dispatch sits after the concierge branch and is not gated on `reviewToken`. A concierge buyer therefore receives both the concierge review-link CTA and the generic "complete your $99 deposit" reminder sequence.

**Suggested improvement:** The buyer-journey skill's deposit section should note that concierge and competitive $99 deposits are distinguished ONLY by `pi.metadata.type` (reviewToken presence), not any VehicleRequest/Deposit column, and that any deposit-reminder/nudge enrollment MUST gate on `!isConcierge` to avoid double-messaging concierge buyers.

**Principle:** When two flows converge on the same shared model (here Deposit) and are distinguished only by runtime metadata rather than a persisted column, every downstream automation keyed off that model must re-derive the distinction from the same metadata or it will incorrectly fan out to both flows.

### Observation 2: Program-2 internal lifecycle has no feature flag; cutover relies on manual atomic code swap

**Status:** OPEN
**Date:** 2026-08-25
**Session context:** $99 deposit conversion & pre-activation gate program
**Skill:** autolenis-system-architecture (background jobs / QStash→internal cutover)
**Type:** internal
**Phase/Area:** lifecycle cutover / single-authority

**Issue:** The Program-2 internal `lifecycle_touch_schedule` path is kept dormant only by "no live producer + table not applied," with cutover documented as a manual, atomic swap of `dispatch()`→`enqueueLifecycleTouch()`. There is no code-level guard guaranteeing single authority, so a partial cutover (live internal producer added while QStash producer remains) silently creates dual authority (double sends). By contrast the sibling in-app workflow engine uses an explicit `CRM_INAPP_ENGINE_ENABLED` gate.

**Suggested improvement:** system-architecture / observability skills should recommend that any producer-swap cutover between two live job authorities be gated by a single boolean selector (authority = A XOR B) rather than relying on humans to atomically edit two call sites, so "never both enabled" is enforced in code.

**Principle:** A cutover between two independent job authorities is only safe if exactly-one-authority is structurally enforced (a single selector), never left to a manual multi-site edit whose intermediate states double-fire.

### Observation 3: No single shared pre-payment fulfillment gate; dealer outreach was ungated

**Status:** OPEN
**Date:** 2026-08-25
**Session context:** $99 deposit conversion & pre-activation gate program
**Skill:** autolenis-payments-and-ledger (and autolenis-dealer-outreach-governance / acquisition)
**Type:** internal
**Phase/Area:** pre-payment cost gate

**Issue:** Auction activation and dealer invitations were each PAID-gated by their OWN inline `Deposit.status==="PAID"` check (webhook, reconciler policy, admin route), with no single shared predicate, while the intake pipeline's `dealer_outreach` stage had NO deposit gate at all — a free vehicle-request submission would send CAN-SPAM dealer recruitment email pre-payment. Paid Apollo reveal was separately inert (`allowPaid` never set). The invariant "no paid $99 = no cost-bearing/dealer-facing fulfillment" was therefore enforced inconsistently and had a real hole.

**Suggested improvement:** payments-and-ledger / dealer-outreach-governance skills should name a single canonical `isFulfillmentUnlocked(buyerId)` predicate as THE pre-payment gate and require cost-bearing/dealer-facing stages to consult it, rather than each surface re-implementing (or omitting) its own PAID check.

**Principle:** A cross-cutting invariant ("no X before payment") enforced by independent per-surface checks will always grow a hole; give it one named predicate every surface must call, so a missing call is visible and testable.

### Observation 4: Reminder copy carried false-scarcity language ("slot expires soon / about to be released")

**Status:** OPEN
**Date:** 2026-08-25
**Session context:** $99 deposit conversion & pre-activation gate program
**Skill:** autolenis-communications-consent
**Type:** internal
**Phase/Area:** transactional/lifecycle message copy

**Issue:** The deposit-reminder message bodies (QStash job + ported internal parity) claimed the buyer's "auction slot expires soon" / is "about to be released" — implying a hard scarcity/deadline mechanism that does not exist. Conversion sequences should motivate without fabricating urgency, scarcity, or dealer interest.

**Suggested improvement:** communications-consent skill should add a truthfulness rule for conversion/nurture copy: no fabricated scarcity, urgency, deadlines, dealer interest, bidding, offers, or savings unless the claim maps to a real system fact.

**Principle:** Automated conversion copy must be traceable to a real system state; invented urgency/scarcity is both a trust and a compliance risk, and it outlives the person who wrote it.

### Observation 5: Un-gated ACTIVE-dealer notification fan-out on public request submission

**Status:** OPEN
**Date:** 2026-08-26
**Session context:** Vehicle-request form coverage audit for the $99 pre-activation gate
**Skill:** autolenis-payments-and-ledger / autolenis-dealer-marketplace
**Type:** internal
**Phase/Area:** pre-payment cost gate — dealer-facing notifications

**Issue:** The prior pre-payment-gate audit found the intake pipeline's prospect `dealer_outreach` (via sendDealerEmail) as "the gap" and gated it, but MISSED a second dealer-facing path: `app/api/public/request-vehicle/route.ts` emailed up to 20 ACTIVE marketplace dealers (`sendDealerNewBuyerOpportunityEmail`) on every public submission, inline and un-gated. Because the first audit searched on `sendDealerEmail`, a differently-named dealer-notification helper slipped through. All public landing-page forms (dedicated page, shared SEO city forms, paid LP forms) submit to this route, so every unpaid public lead was broadcast to dealers.

**Suggested improvement:** payments-and-ledger's pre-activation-gate guidance should say the gate audit must enumerate ALL dealer-facing send helpers (grep the email/notification service for every `sendDealer*` / dealer-recipient function), not just the known prospect-outreach entry, and route each through `isFulfillmentUnlocked`.

**Principle:** A "find every X" coverage audit keyed on one function name misses siblings; enumerate by the capability (every send whose recipient is a dealer) and by the shared gate every such site must call, not by a single known symbol.

### Observation 6: "Conversion nurture" that names no price/checkout is not a conversion funnel

**Status:** OPEN
**Date:** 2026-08-26
**Session context:** Closing the $99 pre-checkout conversion gap
**Skill:** autolenis-buyer-journey / autolenis-communications-consent
**Type:** internal
**Phase/Area:** pre-checkout nurture (form_submitted/check_form_completion)

**Issue:** The existing form_submitted/check_form_completion "activation" nurture was widely assumed to drive the $99 deposit, but on inspection it named no price, no deposit, and no checkout URL — it drove to a profile-completion form and /buyer/dashboard, with pre-payment "dealers are waiting/competing/bidding" copy that is false before any paid deposit. It self-stopped only on PAID (never on a PENDING deposit), so it overlapped the real deposit_reminder with no handoff.

**Suggested improvement:** buyer-journey should require that any sequence claimed as "$99 conversion" explicitly name the deposit + link to the checkout, and that two funnel stages keyed off the same buyer coordinate a handoff (stop stage 1 when stage 2's state — a PENDING deposit — appears) rather than both self-stopping only on the terminal (PAID) state.

**Principle:** Verify a nurture's ACTUAL copy and CTA before treating it as a conversion step; a sequence that never names the price or the checkout is awareness/nurture, not conversion, and rebadging it hides both the gap and any fabricated urgency it carries.

### Observation 7: Anonymous-lead resume needs a capability-free deep-link token, not a session-forging claim

**Status:** OPEN
**Date:** 2026-08-26
**Session context:** Closing the $99 pre-checkout conversion gap — secure resume link
**Skill:** autolenis-auth-security-privacy
**Type:** internal
**Phase/Area:** buyer resume/claim tokens

**Issue:** The only competitive-request "resume" was /thank-you?email=<plaintext> — enumerable, PII-in-URL, and it drove a by-email mutation with no ownership proof. Building a full guest→Supabase session-forging claim was tempting but high-risk and unverifiable without live Supabase. The safer design: a hashed/expiring/single-use deep-link token that confers NO capability — it validates+consumes and redirects to the auth-gated checkout, leaving the buyer's own Supabase auth (+ existing guest-request email transfer) as the real boundary.

**Suggested improvement:** auth-security-privacy should record the "capability-free deep-link token" pattern (opaque, hashed-at-rest, expiring, single-use, redirects to an auth-gated destination) as the preferred way to make an emailed resume/deeplink secure without forging a session — distinct from a credential-bearing claim token (DealerAccountClaimToken) which sets a password/session and carries much higher blast radius.

**Principle:** A link emailed to an unauthenticated recipient should carry the minimum authority that accomplishes the task; a deep-link that only routes to an auth-gated page needs no session and cannot be escalated, so prefer it over a credential token unless setting a password/session is genuinely required.

### Observation 8: Deal-creation has 4 entry points; admin starts at ACTIVE, buyers at FINANCING_PENDING

**Status:** OPEN
**Date:** 2026-08-26
**Session context:** Program 4 Deal Completion Autopilot — enumerating Deal-creation entry points (Section 2)
**Skill:** autolenis-deal-lifecycle
**Type:** internal
**Phase/Area:** Deal creation / convergence

**Issue:** The skill documents createDealFromOffer as the entry point, but the running code has FOUR: (A) commitOfferSelection (auction, tx+FOR UPDATE, @FINANCING_PENDING), (B) vehicle-request accept respond route (@FINANCING_PENDING via vehicleRequestOfferId, NOT through commitOfferSelection), (C) admin POST /api/admin/deals (@ACTIVE — different start status), (D) seed. Concierge converges onto (A) via concierge-conversion. The admin path starting at ACTIVE vs buyers at FINANCING_PENDING is a real (if benign — ACTIVE→FINANCING_PENDING is legal) inconsistency; the vehicle-request path is a second legitimate creation site the skill doesn't mention.

**Suggested improvement:** autolenis-deal-lifecycle "Architecture & key files" should enumerate all real Deal-creation entry points and their starting DealStatus, and note the two convergence patterns (offer→commitOfferSelection vs vehicleRequestOffer accept), so future work doesn't assume a single createDealFromOffer seam.

**Principle:** When a skill names one canonical entry point for an operation, verify against the code whether other legitimate entry points exist; enumerating all of them (with their invariants) prevents a change from silently missing a path.

### Observation 9: Exactly-once domain events at a terminal-state seam need no dedup store if the write is a CAS

**Status:** OPEN
**Date:** 2026-08-26
**Session context:** Program 4 — emitting the canonical completion event exactly once
**Skill:** autolenis-deal-lifecycle
**Type:** open-source
**Phase/Area:** state-machine seam / domain-event emission

**Issue:** The pre-existing purchase_completed emit lived at two completion ROUTES, keyed on dealId, "effectively once" but not structurally so (emitDomainEvent is not replay-idempotent — it inserts a timeline row per call). Moving emission into the state-machine seam and gating it on the terminal transition, AFTER a compare-and-swap status write, makes it exactly-once for free: only the CAS winner runs the body, and re-entry into the terminal state short-circuits on the idempotent no-op. No extra dedup table/column needed.

**Suggested improvement:** autolenis-deal-lifecycle (and architecture) should record the pattern: to emit a lifecycle domain event exactly-once, emit it from the guarded transition seam gated on the target status, and make the status write a CAS (updateMany guarded on the observed status) so concurrent/replayed transitions collapse to a single body execution — rather than emitting from each route or adding a dedup marker.

**Principle:** Exactly-once side effects on a state transition are cheapest to guarantee at the single guarded seam that owns the transition, using an optimistic compare-and-swap plus the terminal-state no-op — not by deduping at each call site.

### Observation 10: Webhook-driven completion needs a provider-status reconciliation cron sharing the webhook's dedup key

**Status:** OPEN
**Date:** 2026-08-26
**Session context:** Program 4 — DocuSign envelope completion could be stranded by a dropped webhook
**Skill:** autolenis-integrations
**Type:** open-source
**Phase/Area:** provider webhooks / reconciliation

**Issue:** DocuSign signature completion was webhook-only; a dropped envelope-completed webhook left the deal stuck at SIGNING_PENDING with no recovery (the existing signed-contract-refetch cron only re-fetches PDFs for already-COMPLETED envelopes). Also, declined/voided-at-provider events were ignored entirely (silent limbo). Fix: a reconciliation cron that polls the provider for authoritative status of stale in-flight envelopes and drives the SAME idempotent handlers the webhook uses — guarded by claimProviderEvent on the EXACT dedup key the webhook uses (provider:${id}:${event}), giving cross-path idempotency so the reconciler and a late webhook can never both fire.

**Suggested improvement:** autolenis-integrations should state that any webhook whose delivery advances a state machine needs a reconciliation poll for missed delivery, and that the reconciler must share the webhook's dedup key (via the provider-event-dedup helper) rather than inventing its own, so the two paths are mutually idempotent.

**Principle:** A webhook that drives an irreversible state advance is not complete without a reconciliation path for non-delivery; make the reconciler idempotent against the webhook by reusing the exact same dedup key, not a parallel one.

### Observation 11: Provider removal must trace the failure model, not just swap the call — a webhook reconciler may vanish

**Status:** OPEN
**Date:** 2026-08-26
**Session context:** Program 4 correction — removing DocuSign, completing in-house ESignEnvelope signing
**Skill:** autolenis-integrations
**Type:** open-source
**Phase/Area:** provider replacement / recovery model

**Issue:** When an external e-signature provider (DocuSign) was replaced by a synchronous in-house signing transaction, the two DocuSign-era reliability crons (completion-webhook reconciler + signed-PDF refetch) became not just provider-specific but conceptually unnecessary: an in-house signature records evidence and advances the deal in one transaction, so there is no dropped-webhook failure mode to reconcile. Mechanically porting the reconciler cron to the new provider would have preserved a cron that recovers a failure that can no longer happen. The correct move was to re-derive the failure model (partial commit, cert-gen failure, post-commit advance failure) and cover it with a transaction + a self-healing read-path check + on-demand certificate regeneration — no cron.

**Suggested improvement:** autolenis-integrations should state that removing/replacing a provider requires re-deriving the failure model of the replacement, not porting the old provider's recovery jobs; a synchronous in-house transaction often makes an async reconciliation cron unnecessary, and keeping it is dead reliability theater.

**Principle:** Recovery infrastructure exists to cover a specific failure mode; when a rearchitecture eliminates that failure mode, delete the recovery job rather than re-pointing it — verify the new failure model and cover exactly it.

### Observation 12: Cross-both-directions parity tests make cron removal safe and self-checking

**Status:** OPEN
**Date:** 2026-08-26
**Session context:** Program 4 correction — removing two DocuSign crons from vercel.json + CRON_STALENESS
**Skill:** autolenis-observability-sre
**Type:** internal
**Phase/Area:** cron registry / staleness monitoring

**Issue:** Removing a cron required deleting it from BOTH vercel.json and the CRON_STALENESS registry; the existing bidirectional parity test (every scheduled cron is monitored AND every monitored cron is scheduled) immediately catches a half-done removal. This made the removal self-verifying — the test fails if you forget either side.

**Suggested improvement:** autolenis-observability-sre should note that the vercel.json↔CRON_STALENESS bidirectional parity test is the safety net for BOTH adding and removing crons, and that a cron change is not complete until both registries agree (the test proves it).

**Principle:** A bidirectional registry-parity invariant turns an easy-to-half-do change (add/remove in two places) into a self-checking one; lean on it rather than manual cross-checking.

### Observation 13: Dead schema table treated as diagnostic evidence

**Status:** OPEN
**Date:** 2026-08-27
**Session context:** Diagnosing a silently non-delivering Stripe webhook from production row counts
**Skill:** autolenis-debugging
**Type:** open-source
**Phase/Area:** Evidence gathering — "trace the actual execution path"

**Issue:** An incident report cited two zero row counts as corroborating evidence of the
same failure. One of the two tables has no writer anywhere in the codebase, so its count is
zero unconditionally and carries no information about the failure. Only the other count was
actually diagnostic. Reasoning from the dead table would have widened the suspected blast
radius incorrectly.

**Suggested improvement:** In the evidence-gathering section, add a step: for every table,
metric, or log stream cited as evidence, first confirm a writer exists on the path being
diagnosed (grep for writes to it). A zero from a table nothing writes to is not a signal.

**Principle:** Absence-of-data is only evidence when something would have written the data
had the system worked. Before reasoning from a zero, verify the write path exists.

### Observation 14: Alert invariants need a false-positive analysis before shipping

**Status:** OPEN
**Date:** 2026-08-27
**Session context:** Adding an operational exception for a payment intent stranded without a provider event
**Skill:** autolenis-observability-sre
**Type:** open-source
**Phase/Area:** Alerting / operational exceptions

**Issue:** The obvious formulation of a "we never heard back from the provider" invariant
("record is PENDING with a provider id and has no provider event past a window") also matches
the far more common benign case — the user simply abandoned checkout and never paid. Shipping
it as written would have produced a permanently noisy alert that operators learn to ignore,
which is the same outcome as having no alert at all.

**Suggested improvement:** Add a rule to the alerting guidance: for every new invariant,
enumerate the benign states that also satisfy the predicate and either exclude them or
reconcile against the authoritative external source before alerting. State the expected
steady-state alert volume.

**Principle:** An invariant that fires on the normal case is not monitoring, it is noise.
Design the exclusion set at the same time as the predicate, not after the first false page.

### Observation 15: A discriminator that lives only in the provider's payload

**Status:** OPEN
**Date:** 2026-08-27
**Session context:** Adding isolation between two fulfillment tracks that share one payments table
**Skill:** autolenis-domain-model
**Type:** open-source
**Phase/Area:** Entity design — status/kind fields

**Issue:** Two materially different fulfillment tracks shared one table and one amount,
distinguished only by a metadata field on the external provider's object. Every internal
path that had to tell them apart therefore needed a network round-trip to the provider, and
any path that forgot would silently run the wrong fulfillment. The webhook could branch
correctly because the provider payload was in hand; no other path could.

**Suggested improvement:** Add a rule: when a single entity serves two or more downstream
workflows, the discriminator must be a persisted column on the entity, written at creation.
A field readable only from an external payload is not a discriminator — it is a lookup, and
every consumer inherits the provider's availability and latency.

**Principle:** If two rows in the same table mean different things, the difference belongs in
the row. Provider payloads are evidence, not schema.

### Observation 16: Adding a collaborator import silently breaks sibling route tests

**Status:** OPEN
**Date:** 2026-08-27
**Session context:** Wiring an existing service into a route that previously did not import it
**Skill:** autolenis-testing-quality-gates
**Type:** open-source
**Phase/Area:** Route-handler test harnesses

**Issue:** Adding one import to a route handler broke six unrelated tests in a sibling file.
The tests exercised the route's authorization gate and returned before ever reaching the new
call, but the import itself pulled in a server-only module at load time. The per-file mock
registration meant the file that mocked the new collaborator passed while the older file
failed, and the failure message named a framework constraint rather than the cause.

**Suggested improvement:** In the route-handler testing guidance, note that route tests mock
the module graph, not just the call path: after adding an import to a route, re-run every
test file that imports that route, not only the one for the behaviour being changed. Grep
for the route path across test files as part of the change.

**Principle:** A route test depends on everything the route imports, including code the test
never executes. Import-time coupling is coupling.

## 2026-08-30

### Observation 17: Admin UI audits should grep for API capabilities with no UI consumer

**Status:** OPEN
**Date:** 2026-08-30
**Session context:** Auditing /admin/content before a UX/workflow redesign; discovered an entire Phase-3 content workflow API layer (validate/approve/schedule/publish_now/unpublish/rollback, generation jobs with pause/resume/cancel/retry, a content capability model) with zero UI consumers.
**Skill:** autolenis-system-architecture
**Type:** open-source
**Phase/Area:** Reuse-before-create protocol / capability-index

**Issue:** The reuse-before-create protocol tells you to search for an existing service before building a new one, but it does not tell you to search the reverse direction — for existing API routes and services that no UI reaches. A redesign brief that says "preserve every capability" is silently scoped to what the UI already shows, so orphaned server capability stays invisible and gets rebuilt later as a "new" feature.

**Suggested improvement:** Add an "orphan sweep" step to the reuse-before-create protocol: for the domain under change, list every route handler and exported service function, then grep the UI tree for a consumer of each. Report the ones with no consumer as orphaned capability rather than assuming the UI is the complete inventory.

**Principle:** An inventory taken from the user interface is not an inventory of the system. Capability audits must enumerate from the server surface inward, because unreached capability is invisible from the surface that fails to reach it.

### Observation 18: Two write paths to the same state with different invariants is a design defect worth naming explicitly

**Status:** OPEN
**Date:** 2026-08-30
**Session context:** Same /admin/content audit. Publishing an article is reachable by two paths with different semantics: a plain status flip (updateContentArticleStatus) that bypasses approval/validation guardrails, and publishNow() which enforces them.
**Skill:** autolenis-code-verification
**Type:** open-source
**Phase/Area:** STEP 2 — first code review checklist

**Issue:** The review checklist lists "duplicated functionality" and "invalid assumptions" but does not name the specific and more dangerous pattern: two code paths that write the same field, where one enforces an invariant and the other does not. This reads as acceptable duplication rather than as a guardrail bypass.

**Suggested improvement:** Add an explicit review prompt to STEP 2: "For every state field this change touches, enumerate all write paths. If one path enforces a guard the others do not, that is a bypass — report it even if the change did not introduce it."

**Principle:** Duplication of a write path is not a style problem; it is an invariant problem. The weakest path defines the actual guarantee, so guardrails must be reviewed at the field level, not the function level.

### Observation 19: Reaching for the same visual device in three components is the signal, not each instance

**Status:** OPEN
**Date:** 2026-08-30
**Session context:** Building an owner-facing audit document; the Impeccable hook flagged a thick left accent border on three separate card components (banner, finding card, callout).
**Skill:** impeccable
**Type:** open-source
**Phase/Area:** side-tab rule / design self-review

**Issue:** The rule fires per instance, so it reads as three independent nits. The actual defect was singular and structural: one device was reused for three different jobs, and in one of them it duplicated information a chip already carried. Fixing instance-by-instance would have produced three subtler stripes rather than three distinct devices.

**Suggested improvement:** When the same rule fires on 3+ components in one file, report it once as a repetition finding — "this device appears in N components; each should encode something different, or the device should collapse to one" — rather than N independent findings.

**Principle:** A visual device repeated across components that mean different things is not N small problems; it is one design problem about vocabulary. Review tooling that counts instances hides the pattern that makes them worth fixing.

### Observation 20: A capability-preservation fixture is only as good as its enumeration

**Status:** OPEN
**Date:** 2026-08-30
**Session context:** Implementing the approved /admin/content redesign. Wrote an executable capability-preservation test listing every pre-existing control by data-testid, ran it green at 90/90, and only found during the independent second review that a banner and its two actions had been dropped — the fixture had never named them, so it passed while the regression was live.
**Skill:** autolenis-code-verification
**Type:** open-source
**Phase/Area:** STEP 6 — independent second review

**Issue:** An allow-list style regression fixture reports on what it enumerates and is silent on what it omits. A green run therefore reads as "nothing was lost" when it only means "nothing on the list was lost". The failure is invisible precisely because the test is passing, and the confidence it produces suppresses the manual check that would have caught it.

**Suggested improvement:** When a preservation fixture is built by hand, derive the baseline mechanically rather than from memory — enumerate the identifiers present at the base commit (e.g. extract them from `git show BASE:file`) and diff that set against the fixture, failing on any baseline identifier the fixture does not mention. The fixture then cannot be quietly incomplete.

**Principle:** A hand-written allow-list cannot prove completeness, only conformance to itself. Any test asserting that nothing was lost must derive its baseline from the artifact being preserved, not from the author's recollection of it.
