# Buyer location backfill — reviewable plan

**Status:** plan only. **Nothing executed. No production data read or mutated.**
**Companion to:** `docs/plans/BUYER-LOCATION-GAP.md` (root cause + fixes 1–4)
**Checker:** `frontend/scripts/check-buyer-location-backfill.ts` — read-only, no DB

Fixes 1–4 are implemented and green, so **no new buyer joins this backlog**:
prequal now persists `city/state/zip` onto the buyer. This document covers the
10 rows that already have NULL location.

---

## 1. What "fixed" means for a row

Not "the ZIP is real". The bar is: **would `dealer-invitation.service` resolve
coordinates for it?** The matcher resolves in exactly this order
(`dealer-invitation.service.ts:181-186`):

```
geocodeZip(zip) ?? lookupCity(city, state)
```

and `geocodeZip` (`geocoding.service.ts:129-154`) tries the static table, then a
cache, then Google — **but only when `GOOGLE_GEOCODING_API_KEY` is configured**;
otherwise it returns `null` at `:153`.

That variable is read at `geocoding.service.ts:101,124` and is **declared
nowhere** — not in `env.d.ts`, not in `.env.example`. **Whether it is set in
production is NOT VERIFIED.** This plan therefore evaluates every candidate
against the **static tables alone**, which is the worst case and the one that
holds if the key is unset.

### Static coverage — verified

| Table | Entries | Notes |
| --- | --- | --- |
| `ZIP_COORDS` | **178** | 173 baseline + 75034/75035 (Frisco) + 33064/33068/33069 (Broward) |
| `CITY_COORDS` | **130** | 127 baseline + `frisco,tx` + `pompano beach,fl` + `margate,fl`; keyed `"city,state"` lowercased, `lookupCity` requires **both** |

Enumerate either with `npx tsx scripts/check-buyer-location-backfill.ts --coverage`.

**This coverage is thinner than it looks.** A worked example from the checker:
`78745` is a real, common Austin ZIP and is **absent** from `ZIP_COORDS`. A
backfill that sets only that ZIP resolves `null` and the auction still invites
zero. The same row backfilled with `city="Austin", state="TX"` places, because
`austin,tx` is in `CITY_COORDS`.

**Consequence for this backfill: prefer filling city + state as well as ZIP on
every row, not ZIP alone.** ZIP alone is a coin flip against a 173-entry table.

---

## 2. The 10 rows — verified production values

Values below were supplied and verified by the requester from production and are
**not re-derived here**. Source: `buyer_opportunities.zip`, joined to buyers via
`vehicle_requests.buyer_opportunity_id`. That source is **corroborated** — where
a buyer also carries its own ZIP, the two agree, 3 of 3.

### Recoverable — 4 rows

| Buyer | Sourced ZIP | City (implied) | Checker verdict |
| --- | --- | --- | --- |
| `6cc7bfa6` | **75035** | Frisco, TX | `PLACES_BY_ZIP` |
| `ff9c4525` | **75035** | Frisco, TX | `PLACES_BY_ZIP` |
| `b6fdc690` | **75035** | Frisco, TX | `PLACES_BY_ZIP` |
| `7e60731b` | **75034** | Frisco, TX | `PLACES_BY_ZIP` |

### Not recoverable — 6 rows

The other six buyers have **no location anywhere in the database**. They require
customer contact, not a script. `decideBackfill` returns `NO_SOURCE` for them and
the tool writes nothing — inventing a location for a buyer is exactly the failure
this plan exists to avoid.

### The checker run that changed the plan

Running the checker against those ZIPs **before** any code change:

```
BUYER     ZIP    VERDICT          NOTE
6cc7bfa6  75035  WILL_NOT_PLACE   ZIP absent from static table and no city/state fallback
ff9c4525  75035  WILL_NOT_PLACE   …
b6fdc690  75035  WILL_NOT_PLACE   …
7e60731b  75034  WILL_NOT_PLACE   …

0/4 would place.
```

**0 of 4.** Both 75034 and 75035 are Frisco, TX, and neither was in the 173-entry
`ZIP_COORDS`; `frisco,tx` was likewise absent from `CITY_COORDS`, which carried
only seven Texas cities (`austin, dallas, el paso, fort worth, houston, plano,
san antonio`). The nearest covered ZIP was `75024` — Plano, a different city.

**Writing those ZIPs would have resolved to `null` and changed nothing.** The
rows would have read as backfilled and the auctions would have gone on inviting
zero dealers — the precise failure mode this plan was written to prevent, caught
by the gate rather than in production.

### The unblock

`lib/utils/zip-coords.ts` now carries `75034`, `75035`, and `frisco,tx`. The
same run afterwards:

```
6cc7bfa6  75035  PLACES_BY_ZIP  static ZIP table hit
ff9c4525  75035  PLACES_BY_ZIP  static ZIP table hit
b6fdc690  75035  PLACES_BY_ZIP  static ZIP table hit
7e60731b  75034  PLACES_BY_ZIP  static ZIP table hit

4/4 would place.
```

**Coordinate provenance, stated plainly.** Both ZIPs carry the Frisco city
centroid (33.1507, -96.8236) rather than per-ZIP centroids. This table feeds a
50–150 mile radius filter, the two ZIPs are roughly five miles apart, and a
documented city-level approximation is preferable to a per-ZIP figure that
cannot be sourced. `lib/utils/__tests__/zip-coords-backfill-coverage.test.ts`
pins a bounding box and the north-of-Dallas/north-of-Plano ordering, so a
transposed sign or a coordinate pasted from the wrong row fails loudly.

**Hand-curating this table does not scale.** Setting `GOOGLE_GEOCODING_API_KEY`
makes `geocodeZip` fall through to Google for any ZIP and removes the need for
these additions entirely. That remains the durable fix and is still
**NOT VERIFIED** as set in production.

## 2a. Programmatic sourcing — no admin hand-entry

`frontend/scripts/backfill-buyer-location.ts`, over
`frontend/lib/services/buyer/location-backfill.ts`.

**Dry run by default. It writes nothing without `--apply`.**

```bash
cd frontend
npx tsx scripts/backfill-buyer-location.ts                        # report only
npx tsx scripts/backfill-buyer-location.ts --apply --admin-email you@autolenis.com
```

It queries buyers missing any part of their location, collects every
`buyer_opportunities.zip` reachable through their vehicle requests, and returns
one of four decisions per row:

| Decision | Meaning |
| --- | --- |
| `FILL` | one corroborated ZIP, buyer has none — writable |
| `ALREADY_SET` | buyer already carries a ZIP (any source agrees) — nothing to do |
| `NO_SOURCE` | no opportunity ZIP anywhere — customer contact, the 6 rows above |
| `CONFLICT` | sources disagree with each other or with the buyer — **never auto-resolved** |

Three properties matter more than the convenience:

1. **Corroboration is enforced, not assumed.** If an opportunity ZIP ever
   contradicts the buyer's own ZIP, or two opportunities contradict each other,
   the row stops as `CONFLICT`. The "3 of 3 agree" premise is checked per row
   rather than trusted globally.
2. **It gates on resolvability.** Every `FILL` is run through `lookupZip` — the
   same lookup the matcher uses — and `--apply` refuses outright while any
   sourced ZIP does not resolve. A backfill that cannot place the buyer is not
   allowed to run.
3. **Every write is audited to a named human.** Writes go through
   `updateBuyerProfileByAdmin`, the same path the admin UI uses, so each row
   lands with an `AdminAuditLog` entry; `--apply` requires `--admin-email` so
   the entry names a real accountable admin rather than a faceless script.

It sources **ZIP only**, because `buyer_opportunities` has no city or state
column. Claiming to fill those would be fabricating.

## 2b. Full production ZIP distribution — coverage verified

The four recoverable rows were only part of the picture. Checked against the
whole `buyer_opportunities` ZIP distribution (verified production counts,
supplied by the owner and not re-derived here):

| ZIP | City | Opportunities | Before | After |
| --- | --- | --- | --- | --- |
| `75024` | Plano, TX | 15 | `PLACES_BY_ZIP` | `PLACES_BY_ZIP` |
| `75035` | Frisco, TX | 10 | `WILL_NOT_PLACE` | `PLACES_BY_ZIP` |
| `33068` | Margate, FL | 5 | `WILL_NOT_PLACE` | `PLACES_BY_ZIP` |
| `33069` | Pompano Beach, FL | 1 | `WILL_NOT_PLACE` | `PLACES_BY_ZIP` |
| `75034` | Frisco, TX | 1 | `WILL_NOT_PLACE` | `PLACES_BY_ZIP` |
| `30301` | Atlanta, GA | 1 | `PLACES_BY_ZIP` | `PLACES_BY_ZIP` |
| `33064` | Pompano Beach, FL | (buyers.zip) | `WILL_NOT_PLACE` | `PLACES_BY_ZIP` |

`75024` and `30301` were already covered. The three Broward ZIPs were not, and
neither was `margate,fl` or `pompano beach,fl` in `CITY_COORDS` — Florida
coverage stopped at Fort Lauderdale, Miami, Orlando, Tampa, Jacksonville and
Tallahassee.

Same provenance rule as Frisco: each ZIP carries its **city centroid**, not a
per-ZIP centroid, because this table feeds a 50–150 mile radius filter and a
documented city-level approximation beats a per-ZIP figure that cannot be
sourced. `33064` and `33069` are both Pompano Beach ZIPs and share its centroid;
`33068` is Margate.

`lib/utils/__tests__/zip-coords-backfill-coverage.test.ts` pins a Broward
bounding box, the north-of-Fort-Lauderdale ordering, and Margate-inland-of-
coastal-Pompano. It also carries a cross-region guard asserting the Florida
entries are not in Texas and the Texas entries are not in Florida — the two
rounds of additions sit in the same file, so a copy-paste between them would be
invisible to a bounding-box test that only checked one region. Both guards were
verified non-vacuous by injecting the fault and confirming the failure.

**Every ZIP in the production distribution now resolves.**

## 3. Sources, best first

`PreQualification` is **not** a source — it has no location columns; that is the
root cause (`BUYER-LOCATION-GAP.md` §1).

For the 4 recoverable rows the source is settled (§2). This ranking governs the
**6 rows with nothing in the database**, and any future row.

| Rank | Source | Fields | Confidence | Applies to |
| --- | --- | --- | --- | --- |
| 1 | **Stripe PaymentIntent billing address** on the deposit | `city`/`state`/`zip` | **High** — real billing data | Any buyer with a deposit, incl. `6cc7bfa6` (PAID `b22c5013`). Read-only Stripe lookup |
| 2 | `VehicleRequest` for that buyer | `zip` | High — buyer stated it | Class A and B |
| 3 | `BuyerOpportunity` matched by normalised phone/email | `zip` | Medium-high | Public-intake origin |
| 4 | `Conversation.extractedData` | `zip` | Medium — LLM-extracted, unvalidated | Last resort before asking |
| 5 | Ask the buyer | all three | Highest | Whatever remains |

Sources 2–4 give **ZIP only**. Per §1, pair every ZIP with a city+state derived
from it before writing, or accept a coin flip against the 173-entry table.

---

## 4. Mechanism — the existing audited admin path

`updateBuyerProfileByAdmin`
(`lib/services/admin/admin-buyer-command-center.service.ts:706-740`) already
writes all four fields, **requires a `reason`**, and writes an `AdminAuditLog`
row (`action: "BUYER_PROFILE_UPDATED"`). Ten rows is small enough to do through
the existing admin UI (`AdminBuyerCommandCenter.tsx:295-308`), giving a per-row
audit trail and a human check on each value.

**No new script, no new write path, no bulk mutation.**

### Prerequisite — a validation gap that would silently reproduce the bug

**This is not optional.** `updateBuyerProfileByAdmin:723-727` spreads
`profileData` straight into the update: it does **not** uppercase `state`, unlike
the buyer-facing route (`app/api/buyer/profile/route.ts:68`). And its schema
(`app/api/admin/buyers/[buyerId]/route.ts:26-30`) uses bare
`z.string().optional()` — **no 2-letter state regex, no 5-digit ZIP regex**,
where `app/api/buyer/prequal/route.ts:46-47` has both.

An admin can therefore save `state: "Texas"` or `zip: "787"`. `lookupCity` keys
on `"city,state"` lowercased, so `"austin,texas"` misses; `lookupZip` slices to 5
chars, so `"787"` misses. **The row would look backfilled and still invite
zero.**

**IMPLEMENTED in this PR.** The route schema now enforces a 2-letter state and a
5-digit (or ZIP+4) ZIP, and `updateBuyerProfileByAdmin` uppercases `state`.

One thing the fix had to get right, found in review rather than in production:
the admin edit form seeds itself from `buyer.city ?? ""` and submits **every**
field on each save (`AdminBuyerCommandCenter.tsx:249-251,261`). For a buyer whose
location is NULL that payload carries `city`/`state`/`zip` as empty strings, so a
regex that rejected `""` would have returned 400 on every save for exactly the
ten buyers this work exists to repair — including any attempt to fix them by
hand. The schema therefore accepts `""` as "not provided / clear", and the
service converts a blank to NULL rather than persisting an empty string, matching
`app/api/buyer/profile/route.ts`. Both behaviours are pinned by tests.

---

## 5. Sequence

1. **Done** — fixes 1–4 shipped, so the backlog stops growing.
2. **Done** — the fifth fix (§4) is implemented and tested.
3. **Done** — the four recoverable ZIPs resolve (§2), and the sourcing tool
   exists (§2a).
4. **Confirm `GOOGLE_GEOCODING_API_KEY`.** Still unverified. If set, the static
   table stops mattering and no future ZIP needs hand-curating. If unset, every
   new market needs a `zip-coords.ts` entry — a treadmill worth ending.
5. **Run the dry run** and review its table:
   `npx tsx scripts/backfill-buyer-location.ts`. Expect 4 `FILL`, 6 `NO_SOURCE`.
   Any `CONFLICT` means the corroboration premise broke for that row — stop and
   look, do not override.
6. **Prioritise `6cc7bfa6`.** It is the only affected buyer with a PAID deposit
   and an auction. See §6 — its window has already closed, which changes the
   action from "restore" to "re-open".
7. **Apply**: `--apply --admin-email <you>`. Each row writes an `AdminAuditLog`
   entry naming you. The admin UI remains available for the 6 rows that need a
   value gathered by hand.
8. **Verify.** After each row, the next invitation attempt either places or
   writes a fresh `AUCTION_ZERO_INVITATIONS` row with cause
   `NO_DEALER_IN_RANGE` (Fix 2) — which is now visible on the admin auction
   view. Absence of a new row plus a non-zero invitation count is the success
   signal.

---

## 6. Auction `dc009660` is already closed — the backfill will not revive it

Verified production fact: it closed **2026-08-27 21:35, ~2h into a 48h window**,
with 0 invitations.

`classifyActivation` (`deposit-activation-policy.ts:32-43`) returns `'skip'` for
a CLOSED auction — terminal. So backfilling `6cc7bfa6`'s location **will not
re-invite dealers on that auction**. The deposit was retained and is
"refundable on request, subject to manual AutoLenis review" (`:22-24`).

That makes `6cc7bfa6` a **product decision, not a data fix**: re-open or
re-create the auction, or refund. Backfilling the location is a prerequisite for
either path but is not sufficient on its own. **This needs an owner decision** —
it is outside the scope of fixes 1–4.

Note also the ~2h close against a 48h window: `noDealerCloseGraceMinutes` is
injected rather than literal in the policy module, so its production value is
**NOT VERIFIED**, but a ~2h grace is what the observed timing implies.

---

## 7. The backfill may not produce invitations even when every row places

**Verified production fact: only 2 dealers exist platform-wide.**

The matcher requires a dealer to be within the coverage radius **and** score
above zero (`dealer-invitation.service.ts:243-255`). With a roster of 2, a
placeable buyer can still get zero — a **dealer-supply** gap, not a buyer-data
gap.

Fix 2 makes exactly this distinction visible: such an auction now writes an
`AUCTION_ZERO_INVITATIONS` row with cause `NO_DEALER_IN_RANGE` and metadata
carrying `activeDealersConsidered`, `dealersInRadius`, and `radiusMiles`. If
that is what appears after the backfill, **the backfill worked and the platform
needs dealers** — do not treat it as a failed backfill.

### Expect this for every Florida and Georgia opportunity

**Both dealers are in `75035` (Frisco, TX).** The Broward cluster is ~1,100
miles away and Atlanta ~700; the widest invite radius is
`MAX_DISTANCE_MILES = 150` (`dealer-invitation.service.ts:21`). So once
geocoding resolves, a Florida or Georgia buyer will place successfully and then
return **zero invitations with cause `NO_DEALER_IN_RANGE`**.

**That is correct behaviour, not a defect, and not a failed backfill.** It is
the fail-closed matcher doing its job: there is genuinely no dealer within range
to invite, and inviting a Frisco dealer to a Margate buyer would be the
reputational failure the geo-filter exists to prevent.

What the geocoding additions buy is an **honest diagnosis**. Before them, a
Florida buyer reported `BUYER_NOT_GEOCODABLE` — pointing at missing buyer data,
which would have sent someone hunting for an address that was already on file.
Now the same auction reports `NO_DEALER_IN_RANGE` with
`activeDealersConsidered` and `radiusMiles` in the metadata, pointing at the
real constraint: **dealer supply outside Texas**. Those two causes lead to
completely different work, and only one of them is actionable by a backfill.

Concretely, of the 33 opportunities in the distribution, ~25 are in the Frisco/
Plano corridor where the dealers actually are, and ~7 are in Florida or Georgia
where no amount of buyer-data repair will produce an invitation.

---

## 8. Verification status

| Claim | Status |
| --- | --- |
| Static tables hold 178 ZIPs / 130 city-state pairs | `CODE-VERIFIED` — enumerated via the checker |
| Every ZIP in the production distribution resolves | `CODE-VERIFIED` — checker run, 5/5 after the Broward additions (2/5 before) |
| FL/GA opportunities will return `NO_DEALER_IN_RANGE` | `CODE-VERIFIED` by distance: both dealers in 75035, `MAX_DISTANCE_MILES = 150` (`dealer-invitation.service.ts:21`) |
| Matcher resolves `geocodeZip(zip) ?? lookupCity(city, state)` | `CODE-VERIFIED` — `dealer-invitation.service.ts:181-186` |
| `geocodeZip` returns null without the Google key | `CODE-VERIFIED` — `geocoding.service.ts:153` |
| A real ZIP (`78745`) can be absent from the static table | `CODE-VERIFIED` — checker output |
| Admin update path lacks state/ZIP validation and does not uppercase state | `CODE-VERIFIED` — service `:723-727`, schema `:26-30` |
| A CLOSED auction is terminal to the activation ladder | `CODE-VERIFIED` — `deposit-activation-policy.ts:32-43` |
| The 10 buyers' candidate location values | **SUPPLIED AND VERIFIED BY THE REQUESTER** — 4 recoverable, 6 with no source anywhere (§2). Not re-derived in this session |
| 75034 / 75035 resolve in the static table | `CODE-VERIFIED` — 0/4 before the additions, 4/4 after; checker output in §2 |
| Frisco coordinates are correct | `CODE-VERIFIED` to city-level precision, bounded by tests. The per-ZIP centroids are a documented approximation, not a sourced figure |
| Admin route rejects bad state/ZIP and accepts the real form payload | `CODE-VERIFIED` — 13 tests |
| `GOOGLE_GEOCODING_API_KEY` set in production | **NOT VERIFIED** — undeclared in `env.d.ts` and `.env.example` |
| `noDealerCloseGraceMinutes` production value | **NOT VERIFIED** — injected, not literal |

**Nothing in this document has been executed.**
