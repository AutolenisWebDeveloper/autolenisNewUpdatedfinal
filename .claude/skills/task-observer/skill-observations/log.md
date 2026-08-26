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
