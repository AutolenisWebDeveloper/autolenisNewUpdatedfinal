# Buyer location gap → zero dealer invitations

**Status:** root-cause analysis + proposed plan. **Nothing implemented.**
**Branch:** `claude/zura-unified-audit-lospq9` · **Baseline:** `8a56167`
**Constraints honoured:** no schema change, no migration, no production mutation,
no fix applied. Stop for review.

Production facts supplied by the requester (10/16 buyers NULL city/state, 7 NULL
zip, buyer `6cc7bfa6`, duplicate `64479e6c`, two shared phone values) are taken
as given and **not re-derived** — this session has no production DB access. Every
claim below is `CODE-VERIFIED` from source at the baseline SHA unless marked.

---

## Executive summary

Three defects, one shared root: **`buyers.address/city/state/zip` has no
production write path that a normal buyer journey ever reaches.**

1. **No onboarding step captures location.** The wizard deliberately excludes it
   (`OnboardingWizardClient.tsx:4`), and `/api/buyer/onboarding/complete` gates
   `onboardingComplete = true` on terms-accepted + name only. Prequal *collects*
   address/city/state/zip and forwards them to MicroBilt but **never writes them
   back to `buyers`**, and `PreQualification` has no columns to hold them. The
   data is captured, used once, and discarded.
2. **The invitation matcher reads exactly `zip`, `city`, `state` and fails
   closed.** With all three NULL it returns `0` before querying a single dealer
   (`dealer-invitation.service.ts:199-210`). **Confirmed** as the cause for
   auction `dc009660`.
3. **Every Buyer identity path dedups on email, never phone.** `buyers.phone` is
   nullable, non-unique, un-indexed, and never normalised on write — while the
   parallel CRM `contacts` plane normalises and dedups on email→phone. Two
   phone-keyed queries select or mutate a row non-deterministically.

The matcher is **not** the bug. Its fail-closed behaviour is deliberate, tested
(`dealer-invitation.test.ts:201`), and correct — inviting the whole roster to an
unplaceable buyer is the worse outcome. The bug is upstream: the buyer has no
location to match on.

**Business impact.** Buyer `6cc7bfa6` paid a $99 deposit, got zero invitations,
and is on a timer: `classifyActivation` returns `'invite'` while the auction is
young and `'close'` once `auctionAgeMinutes >= noDealerCloseGraceMinutes`
(`deposit-activation-policy.ts:36-39`). Each `'invite'` retry re-enters the same
matcher with the same NULL location and returns 0 again. The terminal state is
**CLOSED with the deposit retained — never auto-refunded** (`:22-24`, `:29-30`).
Backfilling this buyer's location before the grace expires is the only thing
that changes that outcome. **Grace duration is `NOT VERIFIED`** — the constant is
injected, not literal in the policy module.

---

## 1. Every write path that sets `buyers.address/city/state/zip`

Exhaustive: an `-A14` scan of every `prisma.buyer.{create,update,updateMany,upsert}`
across `app/`, `lib/`, and `scripts/`, filtered for the four columns.

| # | Path | Fields | Can set non-NULL? | Reached by a normal buyer journey? |
| --- | --- | --- | --- | --- |
| 1 | `app/api/buyer/profile/route.ts:66-69` (PATCH, buyer self-serve) | all four | **Yes** | **No caller sends them** — see below |
| 2 | `lib/services/admin/admin-buyer-command-center.service.ts:706-740` (`updateBuyerProfileByAdmin`) via `PATCH /api/admin/buyers/[buyerId]:56` | all four | **Yes** | Admin-only, manual |
| 3 | `lib/services/acquisition/unified-buyer-intake.service.ts:153` (create), `:174` (guest create) | **`zip` only** | Yes | Public intake only |
| 4 | `lib/services/acquisition/unified-buyer-intake.service.ts:139-143` (backfill) | **`zip` only**, never overwrites | Yes | Only when matched by email |
| 5 | `app/api/buyer/account/route.ts:80-83` (account deletion) | all four | **No — sets NULL** | Deletion |
| 6 | `lib/services/admin/admin-buyer-command-center.service.ts:1245-48` (privacy purge) | all four | **No — sets NULL** | Purge |
| 7 | `scripts/seed-sandbox-deal.ts:60-63` | all four | Yes | Seed script, not production |

**Only paths 1 and 2 can ever set `address`, `city`, or `state`.** Paths 3–4 set
`zip` alone. So a buyer who arrives through signup + onboarding + prequal — the
canonical journey — ends with all four NULL unless an admin types them in.

### Which onboarding step is *meant* to capture them

**None.** This is explicit, not accidental:

> `components/buyer/OnboardingWizardClient.tsx:4`
> `// No credit checks, no FCRA consent, no MicroBilt, no DOB/address/employment.`
> `// Those live exclusively on /buyer/prequal.`

The wizard collects vehicle-type preference, new/used, email-notification
preference, and phone-if-absent (`:7-11`). Its submit block sends exactly three
requests (`:143-160`): `PATCH /api/buyer/profile` with **name + phone only**,
`PATCH /api/buyer/settings` with preferences, `POST /api/buyer/onboarding/complete`.

Prequal *is* where location is collected — `app/api/buyer/prequal/route.ts:44-47`
requires `address`, `city`, `state` (2-letter regex), `zip` (5-digit regex).
**But it never persists them to `buyers`.** They are passed to `initiatePrsequal`
(`:118-121`), assembled into `MicroBiltBuyerPII` (`prequal.service.ts:314-322`),
sent to iPredict, and dropped. `PreQualification` has **no** address/city/state/zip
columns (verified against the model in `schema.prisma`). There is no
`prisma.buyer.update` anywhere in `app/api/buyer/prequal/` or
`lib/services/prequal/`.

**So the wizard's own comment is wrong about the outcome.** Location does not
"live on /buyer/prequal" — it passes through it.

### Why `onboarding_complete` becomes true without them

`app/api/buyer/onboarding/complete/route.ts:41-49` writes
`onboardingComplete: true` gated on exactly two conditions:

- `accepted === true` in the body (`:19-21`), and
- `firstName` and `lastName` present (`:24-39`).

**There is no location check, and there could not usefully be one** — the wizard
that calls it never collects location. Buyer `6cc7bfa6` having
`onboarding_complete = true` with all four NULL is the designed behaviour of this
route, not a data anomaly.

### A second, historical cause for the older NULL rows

Before commit `69bfa2b` (2026-08-28), `PATCH /api/buyer/profile` was **not a
partial update** — it wrote all five of phone/address/city/state/zip
unconditionally:

```
-      phone: d.phone || null,
-      address: d.address || null,
-      city: d.city || null,
-      state: d.state ? d.state.toUpperCase() : null,
-      zip: d.zip || null,
```

The onboarding wizard sends name-only, so **completing onboarding actively nulled
any location a buyer already had.** That is now fixed (`route.ts:57-69`).

Two distinct causes therefore produced the 10 NULL rows, and they are separable
by date: rows last touched before 2026-08-28 could have been *nulled* by this
bug; buyer `64479e6c` (created 2026-08-30, after the fix) can only be
*never-captured*. **Which cause applies to which of the 10 is `NOT VERIFIED`** —
resolving it needs `buyers.updated_at` versus the fix date, which requires DB
access this session does not have. It does not change any proposed fix.

---

## 2. The dealer invitation matcher

`inviteDealersToAuction` — `lib/services/auction/dealer-invitation.service.ts:150`.

### Exactly which buyer fields it reads

**Three, and only three** (`:154-161`):

```
buyer: { select: { zip: true, city: true, state: true } }
```

No other buyer field is read anywhere in the function. `address` is never used.

### What it does when they are NULL

```
:181  const zipCoords  = buyerZip ? await geocodeZip(buyerZip) : null;
:184  const buyerCoords =
:185    (zipCoords ? {lat, lng} : null) ??
:186    (buyerCity && buyerState ? lookupCity(buyerCity, buyerState) : null);
:199  if (!buyerCoords) { logger.warn(...); return 0; }
```

With `zip`, `city`, `state` all NULL:
- `zipCoords` → `null` (guard short-circuits, no geocode call)
- `lookupCity` → not called (`buyerCity && buyerState` is false)
- `buyerCoords` → `null`
- **early return `0` at `:209`** — before the dealer query, before scoring, before
  any invitation upsert.

This is intentional and documented at `:17-21` and `:91-97`: an unplaceable buyer
invites **zero**, never the whole active roster. It is covered by a passing test:
`dealer-invitation.test.ts:201` — *"inviteDealersToAuction invites ZERO when the
buyer is unplaceable (never the whole roster)"*.

### Confirm or refute: is NULL location why auction `dc009660` produced zero invitations?

**CONFIRMED.** The trace is unconditional — given `zip`, `city`, and `state` all
NULL, `:199` is reached on every execution with no branch that avoids it. No
other early return exists between function entry and `:209`.

**One independently checkable artifact.** Every such call emits
`dealer-invitation.service.ts:204-207`:

```
[dealer-invitation] buyer for auction dc009660 is not geocodable
(zip=none, city=none, state=none) — no dealers invited (fail closed).
Set GOOGLE_GEOCODING_API_KEY to widen geocoding coverage.
```

Searching production logs for that line, scoped to auction `dc009660`, converts
this from a static trace claim into a runtime confirmation — and the repeat count
tells you how many `'invite'` retries have already burned. Worth doing; it costs
one log query and it is the only step that would *refute* the conclusion.

### Why the zero-invite outcome is invisible

`app/api/webhooks/stripe/route.ts:262-263` calls the matcher and attaches
`.catch()` — which only fires on a **throw**. A return of `0` is a successful
result. The webhook logs nothing, alerts nothing, and returns 200. The only
signal is the `logger.warn` above and the `'invite'`/`'close'` ladder in
`deposit-activation.service.ts:223-227`, which converges silently.

### A related exposure this trace surfaced

`GOOGLE_GEOCODING_API_KEY` is read at `geocoding.service.ts:101,124` but is
**declared nowhere** — not in `env.d.ts`, not in `.env.example`. When it is
absent, `geocodeZip` returns `null` for any ZIP outside the static table
(`:153`), and that table holds **123 ZIPs**; `CITY_COORDS` holds **127
city,state pairs**. **Whether the key is set in production is `NOT VERIFIED`.**
This directly bounds the backfill: a correct ZIP outside those 123 still yields
`buyerCoords = null` and still invites zero.

---

## 3. Every code path that looks up or upserts a Buyer keyed on phone

`buyers.phone` is `String?` — **nullable, non-unique, un-indexed** (verified
against the `Buyer` model; its only index is `@@index([affiliateId])`). It is
also **never normalised on write**: `normalizePhone` (`lib/utils/phone.ts:3`,
E.164) has 18 call sites across suppression, CRM, contacts, comms, and
dealer-identity — and **not one of them is a `buyers` write**. Phone is stored
verbatim as typed or as Twilio delivered it.

| # | Site | Operation | Ambiguity risk |
| --- | --- | --- | --- |
| **3a** | `app/api/finder/route.ts:189-207` | `buyer.findFirst({ where: { phone } })` then `buyer.update`, `leadScore.updateMany`, `conversation.update` | **HIGH — wrong-row mutation.** `findFirst` with no `orderBy` returns an arbitrary row among duplicates. It then overwrites that buyer's `leadScore`/`leadTemperature` and links an anonymous conversation to it. The route is **unauthenticated** and the phone comes from the request body. Given two shared phone values in production, this can silently write to the wrong person's record. (Also flagged as a HIGH finding in the Phase 1 registry, §D.3.) |
| **3b** | `app/api/twilio/sms/inbound/route.ts:100-103` | `buyer.updateMany({ where: { phone: from }, data: { optedOutSms: true } })` | **MEDIUM — normalisation mismatch, fails safe on duplicates.** `updateMany` across all matching rows is *correct* for an opt-out. But `from` is Twilio E.164 (`+15551234567`) and `buyers.phone` is unnormalised, so a buyer stored as `(555) 123-4567` matches **zero rows** and keeps `optedOutSms = false`. The canonical `sms_suppression` write on the line above (`:98`) does normalise and is the authoritative gate, so **no message is actually sent** — the `buyers` flag just silently drifts out of sync with it. |
| **3c** | `lib/services/voice/buyer-lookup.service.ts:105-118` | `buyerOpportunity.findFirst({ where: { phone: { in: variants } } })` | **LOW — reads only, wrong-row possible.** Queries `BuyerOpportunity`, not `buyers`. Builds phone variants (`:57-71`) to work around the missing normalisation — the one site that compensates. `findFirst` can still pick the wrong record among duplicates; the consequence is Zura greeting a caller with someone else's name and vehicle interest. |

### Why the duplicate exists

**No buyer identity path dedups on phone at all.** Both creation paths key on
**email**:

- `unified-buyer-intake.service.ts:127` — `prisma.user.findUnique({ where: { email } })`.
  Three branches: existing user + buyer → reuse (`:134-144`); user without buyer →
  create Buyer (`:147-157`); **no user → create guest User + Buyer** (`:161-176`).
- `lib/voice/dispatch-request.ts:128` — same shape, same email key.

A second intake with the same phone and a different (or newly supplied) email
falls to branch three and **creates a new Buyer row**. That is exactly the
`6cc7bfa6` / `64479e6c` pair: identical normalised phone, same initials, no
deposits on the newer row.

Note also `unified-buyer-intake.service.ts:120` — `if (!input.email || !input.firstName) return null;`. Intake **requires** an email, so phone-first
callers must synthesise one, which is itself a duplicate generator.

### The contrast that shows the fix shape

The CRM `contacts` plane already solved this. `ContactService.upsertContact`
(`lib/services/contact.service.ts:29-48`) normalises both identifiers
(`normalizeEmail`, `normalizePhone`) and looks up **by email first, then by
phone**, merging into one row. The `buyers` plane does neither. `SmsOptOut.phone`
is `@unique`; `DealerRooftop` carries an indexed `phoneKey`. Buyers are the
outlier.

---

## Proposed fixes — smallest correct change for each

Ordered by dependency. Each is independently shippable and behind its own test.

### Fix 1 — Persist prequal location onto the Buyer (root cause)

**The whole gap closes here.** Prequal already collects exactly the four fields,
already validates them (`state` 2-letter regex, `zip` 5-digit regex at
`prequal/route.ts:44-47`), and every buyer must pass prequal to reach an auction.
The data is in hand and thrown away.

Write it back inside `initiatePrsequal` (`lib/services/prequal/prequal.service.ts`),
in the same block that builds `pii` (`:314-322`), using the **never-overwrite**
semantics already established at `unified-buyer-intake.service.ts:139-143`:

```
// Only fills a NULL. Never overwrites a value the buyer or an admin set.
await prisma.buyer.update({
  where: { id: buyer.id },
  data: {
    ...(buyerRow.address ? {} : { address: input.address }),
    ...(buyerRow.city    ? {} : { city:    input.city }),
    ...(buyerRow.state   ? {} : { state:   input.state.toUpperCase() }),
    ...(buyerRow.zip     ? {} : { zip:     input.zip }),
  },
}).catch(err => logger.error("[prequal] buyer location backfill failed:", err));
```

- **Placement:** in the service, not the route — the admin `run-ipredict` path
  (`app/api/admin/buyers/[buyerId]/prequal/run-ipredict/route.ts:132`) goes
  through the same service and gets the fix for free.
- **Non-blocking `.catch`:** a location write must never fail a credit pull.
- **Not a schema change.** All four columns already exist and are nullable.
- **PII note:** `address` is already stored on `buyers` by two existing paths, so
  this introduces no new data class. If review prefers, persist only
  `city/state/zip` — the matcher never reads `address` (§2), so that alone fully
  fixes invitations. **Recommend the narrower version** unless `address` is needed
  elsewhere.

**Test (failing first):** `lib/services/prequal/__tests__/` — a buyer with NULL
location runs prequal → the four fields are set; a buyer with existing values
runs prequal → they are unchanged.

### Fix 2 — Make the zero-invite outcome visible (not a behaviour change)

Do **not** weaken the fail-closed matcher. Change only what the caller does with
a `0`.

At `app/api/webhooks/stripe/route.ts:262`, capture the return value and log an
error (not a warn) when a **paid** deposit produces zero invitations, mirroring
`deposit-activation.service.ts:224` which already logs its count:

```
const invited = await inviteDealersToAuction(createdAuction.id, deposit.buyerId)
  .catch(err => { logger.error(...); return 0; });
if (invited === 0) {
  logger.error("[stripe/webhook] paid deposit produced ZERO invitations", {
    auctionId: createdAuction.id, buyerId: deposit.buyerId, depositId: deposit.id,
  });
}
```

This is the signal that would have surfaced `dc009660` on day one. Whether it
should also raise a Sentry alert or an admin queue item is a **product decision
for review** — the log line is the minimum.

**Test:** extend `app/api/webhooks/__tests__/stripe-concierge-deposit.test.ts`
(already mocks the matcher) with a zero-return case asserting the error log.

### Fix 3 — Normalise phone on Buyer write

One-line-per-site, no schema change, no unique constraint (that would fail on the
existing duplicates and is a migration anyway).

Apply `normalizePhone` at the four Buyer phone writers:
`app/api/buyer/profile/route.ts:65`, `unified-buyer-intake.service.ts:152,173`,
`lib/voice/dispatch-request.ts:137,160`.

Guard against the empty-string return: `normalizePhone` returns `''` for
unparseable input (`lib/utils/phone.ts:10,24`), so write `normalizePhone(p) || null`
— never store `''`, which would collide across unrelated buyers.

This makes 3b match correctly and makes any future phone-based dedup viable. It
does **not** retroactively fix existing rows — that is the backfill.

### Fix 4 — Remove the wrong-row mutation at `/api/finder`

The narrowest correct change to 3a is to **stop writing to `buyers` from an
unauthenticated route**. Delete the `buyer.findFirst` → `buyer.update` →
`leadScore.updateMany` → `conversation.update` block
(`app/api/finder/route.ts:187-207`), keeping the `leadScore.create` and the
suppression-checked SMS.

Justification for deletion over repair: the route has **zero callers**
(`VehicleFinder.tsx:52` posts to `/api/concierge`, not here), so nothing
regresses; and no `orderBy` can make an anonymous phone string a safe key for
mutating an authenticated user's record. Repairing it means authenticating it,
which is a larger change than the value it delivers.

**Alternative for review:** if `/api/finder` is meant to stay live, gate the
buyer-linking block behind a verified-phone check instead. That is a bigger piece
of work and should be its own decision. Whether `/api/finder` is deliberately
retired is **open** (Phase 1 registry §F.6).

### Explicitly NOT proposed

- **No unique constraint on `buyers.phone`** — it is a migration and it would fail
  against the existing duplicates.
- **No merge of `6cc7bfa6` / `64479e6c`** — an entity merge touching deposits and
  auctions is its own reviewed operation, not a fix.
- **No change to the matcher's fail-closed behaviour.** It is correct.
- **No location requirement added to `/api/buyer/onboarding/complete`** — the
  wizard that calls it never collects location, so the gate would block every
  buyer at onboarding. Fix 1 makes it unnecessary.

---

## Backfill approach for the 10 existing buyers

**Constraint honoured: no production mutation in this session. This is a proposal.**

### Available sources, best first

Fix 1 only helps buyers who prequal *after* it ships. The existing 10 need data
from somewhere, and **`PreQualification` is not a source** — it has no location
columns (§1). Candidate sources, in descending confidence:

| Rank | Source | Fields | Confidence | Note |
| --- | --- | --- | --- | --- |
| 1 | `VehicleRequest` for that buyer | `zip` | High | The buyer stated it for their own request |
| 2 | `BuyerOpportunity` matched by normalised phone/email | `zip` | Medium-high | Public intake capture |
| 3 | `Conversation.extractedData` | `zip` | Medium | LLM-extracted, unvalidated |
| 4 | Stripe PaymentIntent billing address on the deposit | `city`/`state`/`zip`/`address` | **High where present** | Real billing data — best source for the *paid* buyers, and `6cc7bfa6` has a PAID deposit `b22c5013`. Read-only Stripe lookup |
| 5 | Ask the buyer | all four | Highest | Slowest |

**Recommended: source 4 first for buyers with a paid deposit, source 1–2 for the
rest, source 5 for whatever remains.** Sources 1–3 give `zip` only — which is
sufficient, because `geocodeZip` is tried before `lookupCity`
(`dealer-invitation.service.ts:184-186`).

### Mechanism — use the existing audited admin path, not a script

`updateBuyerProfileByAdmin` (`admin-buyer-command-center.service.ts:706`) already
writes all four fields and **requires a `reason`**, writing an
`AdminAuditLog` row with `action: "BUYER_PROFILE_UPDATED"` (`:728-738`). Ten rows
is small enough to do through the existing admin UI
(`AdminBuyerCommandCenter.tsx:295-308`), which gives a per-row audit trail and a
human check on each value. **No new script, no new write path.**

Two gaps to close first, or the backfill will silently produce unusable data:

- `updateBuyerProfileByAdmin:724-726` spreads `profileData` straight into the
  update — it does **not** uppercase `state`, unlike the buyer PATCH route
  (`profile/route.ts:68`). And `patchSchema`
  (`app/api/admin/buyers/[buyerId]/route.ts:26-30`) uses bare
  `z.string().optional()` — **no 2-letter state regex, no 5-digit zip regex**,
  where the buyer-facing prequal schema has both. An admin can save
  `state: "Texas"` or `zip: "787"` and `lookupCity`/`geocodeZip` will return
  `null`, reproducing the exact bug.
  **Tighten the admin schema to match `prequal/route.ts:46-47` and uppercase
  `state` in the service before backfilling.** This is a fifth small fix and it is
  a prerequisite, not optional.
- `lookupCity` keys on `"city,state"` lowercased (`zip-coords.ts:295`) against
  **127 pairs**; `lookupZip` covers **123 ZIPs**. **Verify each backfilled value
  resolves** — via `geocodeZip`/`lookupCity` in a dry run — before declaring a row
  fixed. A correct-but-uncovered ZIP still invites zero.

### Sequence

1. Ship Fix 1 (+ the admin-schema tightening) so no *new* buyer joins the backlog.
2. **Dry run, read-only:** for each of the 10, resolve a candidate location from
   the sources above and check it geocodes. Produce a table of
   buyer → proposed value → source → geocodes yes/no. **Review before any write.**
3. Prioritise `6cc7bfa6` — it has a PAID deposit and an ACTIVE auction on the
   no-dealer grace timer (§ Executive summary). Every other row can wait.
4. Backfill through the admin UI, one row at a time, with a `reason` naming this
   plan.
5. Re-trigger invitations for `dc009660`. The `'invite'` action in
   `deposit-activation.service.ts:222-227` already re-enters the matcher on its
   own schedule, so this may need no manual step — **confirm the deposit-activation
   cron is running and within grace before relying on that.**
6. Confirm via the `dealer-invitation` log line (§2) that the auction now places.

### Decisions needed before implementing

1. **Fix 1 scope:** persist all four fields, or `city/state/zip` only (narrower,
   still fully fixes invitations)? **Recommend narrower.**
2. **Fix 4:** delete the `/api/finder` buyer-linking block, or authenticate the
   route? **Recommend delete** — it has no callers.
3. **Fix 2:** log-only, or also alert/queue on a zero-invite paid deposit?
4. **`GOOGLE_GEOCODING_API_KEY`:** is it set in production? If not, the backfill
   is capped at 123 static ZIPs and setting it should precede step 2.
5. **Grace window:** how long until `dc009660` auto-closes? This sets the clock on
   step 3.

---

## Verification status

| Claim | Status |
| --- | --- |
| Write-path inventory (§1) is exhaustive | `CODE-VERIFIED` — `-A14` scan of all `prisma.buyer.{create,update,updateMany,upsert}` in `app/`, `lib/`, `scripts/` |
| Matcher reads only `zip`/`city`/`state` and returns 0 when all NULL | `CODE-VERIFIED` — `dealer-invitation.service.ts:154-210` |
| NULL location caused zero invitations on `dc009660` | `CODE-VERIFIED` by static trace. **Runtime confirmation available** via the log line in §2 — recommended |
| Prequal discards location; `PreQualification` has no location columns | `CODE-VERIFIED` |
| Both intake paths dedup on email only | `CODE-VERIFIED` — `unified-buyer-intake.service.ts:127`, `dispatch-request.ts:128` |
| `buyers.phone` non-unique, un-indexed, never normalised | `CODE-VERIFIED` |
| Which of the 10 were *nulled* by the pre-`69bfa2b` bug vs never captured | **NOT VERIFIED** — needs `buyers.updated_at` vs 2026-08-28 |
| `GOOGLE_GEOCODING_API_KEY` set in production | **NOT VERIFIED** — undeclared in `env.d.ts` and `.env.example` |
| `noDealerCloseGraceMinutes` value | **NOT VERIFIED** — injected, not literal in the policy module |
| Deposit-activation cron currently running | **NOT VERIFIED** — needs deployed cron config |

**No code was changed. No fix was applied. No production data was read or
mutated.** Awaiting review on the five decisions above.
