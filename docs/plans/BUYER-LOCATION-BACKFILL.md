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
| `ZIP_COORDS` | **173** | `lookupZip` slices to the first 5 chars |
| `CITY_COORDS` | **127** | keyed `"city,state"` lowercased; `lookupCity` requires **both** |

Enumerate either with `npx tsx scripts/check-buyer-location-backfill.ts --coverage`.

**This coverage is thinner than it looks.** A worked example from the checker:
`78745` is a real, common Austin ZIP and is **absent** from `ZIP_COORDS`. A
backfill that sets only that ZIP resolves `null` and the auction still invites
zero. The same row backfilled with `city="Austin", state="TX"` places, because
`austin,tx` is in `CITY_COORDS`.

**Consequence for this backfill: prefer filling city + state as well as ZIP on
every row, not ZIP alone.** ZIP alone is a coin flip against a 173-entry table.

---

## 2. The 10 rows — what I can and cannot pre-check

**I do not have the 10 buyers' candidate values, and I will not invent them.**
This session has no production database access; the supplied facts give the
*shape* of the backlog (3 rows with a ZIP but no city/state, 7 with nothing) but
not the values. Ten fabricated ZIPs would look exactly like a completed
pre-check and would be worthless — worse, they would be actioned.

So the pre-check is delivered as a **mechanism plus a filled decision matrix**,
and the value column is the one thing a reviewer supplies:

| Class | Count | What is present | What the backfill must add | Pre-check verdict, decided in advance |
| --- | --- | --- | --- | --- |
| **A** | **3** | `zip` only | `city` + `state` | `PLACES_BY_ZIP` **if** the ZIP is one of the 173; otherwise `WILL_NOT_PLACE` **unless** city+state are also filled and hit `CITY_COORDS`. **Fill city+state on all 3 regardless** — it costs nothing and removes the dependency on the ZIP table. |
| **B** | **7** | nothing | `zip` + `city` + `state` | `NO_VALUE_SUPPLIED` until a source is found. Each needs a source from §3 before it can be checked at all. |

Run the check the moment values exist:

```bash
cd frontend
npx tsx scripts/check-buyer-location-backfill.ts candidates.json
```

`candidates.json`:

```json
[
  { "buyerId": "6cc7bfa6", "zip": "…", "city": "…", "state": "…", "source": "stripe_billing" }
]
```

The checker prints a verdict per row — `PLACES_BY_ZIP`, `PLACES_BY_CITY`,
`WILL_NOT_PLACE`, `NO_VALUE_SUPPLIED` — and **exits non-zero if any row would
not place**, so it can gate the backfill rather than merely inform it. It reads
no database and mutates nothing.

Worked output on illustrative inputs (not production data):

```
BUYER                        ZIP      CITY          ST  VERDICT             NOTE
ILLUSTRATIVE-covered-zip     78701    —             —   PLACES_BY_ZIP       static ZIP table hit
ILLUSTRATIVE-uncovered-zip   78745    —             —   WILL_NOT_PLACE      ZIP absent from static table and no city/state fallback
ILLUSTRATIVE-zip+city        78745    Austin        TX  PLACES_BY_CITY      ZIP not in static table — placed via city/state fallback
ILLUSTRATIVE-city-only       —        Dallas        TX  PLACES_BY_CITY      static city table hit
ILLUSTRATIVE-city-uncovered  —        Nowhereville  ZZ  WILL_NOT_PLACE      "nowhereville,zz" absent from CITY_COORDS
ILLUSTRATIVE-city-no-state   —        Austin        —   WILL_NOT_PLACE      city without state never resolves
ILLUSTRATIVE-nothing         —        —             —   NO_VALUE_SUPPLIED   no candidate value — needs a source

3/7 would place.
```

---

## 3. Sources, best first

`PreQualification` is **not** a source — it has no location columns; that is the
root cause (`BUYER-LOCATION-GAP.md` §1).

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

Tighten the admin schema to match the prequal route and uppercase `state` in the
service **before** backfilling. This is a fifth small fix, deliberately **not
implemented in this change** — it was not in the approved scope of fixes 1–4.
Flagging it for the same review.

---

## 5. Sequence

1. **Done** — fixes 1–4 shipped, so the backlog stops growing.
2. **Decide the fifth fix** (§4 prerequisite). Backfilling before it lands risks
   writing values that do not resolve.
3. **Confirm `GOOGLE_GEOCODING_API_KEY`.** If set, ZIP coverage is effectively
   unlimited and §1's caution relaxes. If unset, city+state become mandatory on
   every row. This single answer changes the shape of the whole backfill.
4. **Assemble `candidates.json`** from §3, read-only.
5. **Run the checker.** Iterate until it exits 0. **Review the table before any
   write.**
6. **Prioritise `6cc7bfa6`.** It is the only affected buyer with a PAID deposit
   and an auction. See §6 — its window has already closed, which changes the
   action from "restore" to "re-open".
7. **Backfill through the admin UI**, one row at a time, `reason` citing this
   plan.
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

---

## 8. Verification status

| Claim | Status |
| --- | --- |
| Static tables hold 173 ZIPs / 127 city-state pairs | `CODE-VERIFIED` — enumerated via the checker |
| Matcher resolves `geocodeZip(zip) ?? lookupCity(city, state)` | `CODE-VERIFIED` — `dealer-invitation.service.ts:181-186` |
| `geocodeZip` returns null without the Google key | `CODE-VERIFIED` — `geocoding.service.ts:153` |
| A real ZIP (`78745`) can be absent from the static table | `CODE-VERIFIED` — checker output |
| Admin update path lacks state/ZIP validation and does not uppercase state | `CODE-VERIFIED` — service `:723-727`, schema `:26-30` |
| A CLOSED auction is terminal to the activation ladder | `CODE-VERIFIED` — `deposit-activation-policy.ts:32-43` |
| The 10 buyers' candidate location values | **NOT AVAILABLE** — no DB access. Not fabricated; §2 supplies the mechanism instead |
| `GOOGLE_GEOCODING_API_KEY` set in production | **NOT VERIFIED** — undeclared in `env.d.ts` and `.env.example` |
| `noDealerCloseGraceMinutes` production value | **NOT VERIFIED** — injected, not literal |

**Nothing in this document has been executed.**
