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
