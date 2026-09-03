# Shortlist radius gating, dealer persistence, and call accounting

Branch `claude/shortlist-radius-gating`, cut from `main` @ `59dbd95` (PR #389 merged).
Constraints: branch only · no merge · no deploy · **migration written, NOT applied** · no
production mutation.

Governing design: transaction-flow spec §22a. The catalogue is swept on a schedule and served
from `inventory_items`; **no buyer action triggers a third-party API call.** Two radius ceilings,
deliberately different:

| Path | Backed by | Ceiling | Why |
| --- | --- | --- | --- |
| **Shortlist** | `inventory_items` | **100 mi** | the data provider's radius restriction |
| **Sourcing** | `dealer_rooftops` | **100 / 150 / 250 ladder** | rooftops are ours; the provider cap is irrelevant |

---

## Task 1 — sourcing isolation (verified before anything was changed)

**Sourcing never touches the catalogue.** `coverage.service.ts` and `outside-invite.service.ts`
contain no reference to `inventoryItem` at all. `autoMintOutsideInvitesFromSourcing` queries
`prisma.dealerRooftop.findMany` directly; `assessCoverageForZip` queries `dealer` +
`dealerProspect` and de-duplicates on `rooftopId`.

**Nothing in sourcing inherits the provider's 100-mile cap.** `MAX_RADIUS_MILES = 100` lives in
`inventory-source-config.service.ts`, which is imported by exactly five files — all under
`lib/services/inventory/` plus the admin search tool. Zero leakage into sourcing. Sourcing's own
constants are `RADIUS_TIERS = [25, 50, 100, 150]` and `AUTO_MINT_RADIUS_MILES = 150`, both of
which exceed 100. **No fix was required and none was made.**

**One deviation from the governing design, reported not changed.** The spec says sourcing runs a
**100 / 150 / 250** ladder. The shipped ladder is `[25, 50, 100, 150]` — it starts tighter and
stops at 150, so it never reaches 250 miles. This is not the 100-mile ceiling the task asked me
to fix, and extending it changes which dealers get invited to live auctions, which is a reach
decision rather than a defect. The one-line change would be `RADIUS_TIERS = [25, 50, 100, 150, 250]`
in `lib/services/auction/coverage.service.ts:38`, consumed by `selectCoverageRadius`
(`dealer-invitation.service.ts`) and `selectCoverageRadiusForZip` (`request-coverage-gate.service.ts`).
Owner's call.

## Task 2 — radius-gate the ACTION, never the catalogue

The public catalogue today does the opposite of the spec: when `?zip=&radiusMiles=` are present it
**filters rows out** (`page.tsx:171-172`) and drops every row with null coordinates. Since the
adapter never wrote `latitude`/`longitude`, that filter currently empties the grid.

- Delete the row-dropping filter. Distance becomes a **sort and a label**, never a WHERE.
- `shortlist-radius.ts` (new, in `lib/services/shortlist/`) owns the single predicate.
- No ZIP → catalogue renders in full, actions replaced by a ZIP prompt.
- Zero in-radius → custom-request path leads, wider catalogue below as examples. Never empty.

## Task 3 — freshness gates the action only

Extends `shortlist-availability.ts`. New windows, independent of the 48 h sweep cadence so they
hold whether or not the sweep is enforcing: **7 d → stale flag** (display only), **30 d → not
shortlist-eligible** (action → "Find one like this"). Display is never filtered.

## Task 4 — persist the dealer object

`InventoryItem` already declares unused `city/state/zip/latitude/longitude`; the adapter never
wrote them. Reuse those, add six new columns plus a `rooftop_id` link, and resolve to a rooftop
through the EXISTING `dealerIdentityKeys` matcher — no second matching strategy.

## Task 5 — call accounting

`inventory_sources.calls_used_this_cycle` / `budget_cycle_key` already exist (unapplied migration
from #389). Adds `inventory_sync_runs.api_calls_used` and an **80 %-of-budget** Operations alert,
deduped once per cycle like the existing BUDGET_EXHAUSTED alert.

## Task 6 — copy

A swept listing is third-party sourced and unconfirmed. "Verified" / "confirmed" / "held" come off
**listings**. Copy about the dealer *network* competing is untouched — that claim is about vetted
dealers who bid, and it stays true.

---

## Rollback

Code: revert the branch. Schema: `rollback.sql` drops exactly the added columns. The migration is
additive and idempotent; nothing is applied by this branch.
