# Fabricated `public_form` contacts — root cause, fix, and cleanup

**Status:** cause identified · fix merged (`c1cac50`, PR #382) · Step 0 **resolved by production
query** · **cleanup NOT executed**

**Rate:** 2 rows/hour at `:00:04–:00:05` — every fabricated row `email NULL`, `first_name` blank,
the same phone, no `ip_address`, no `consent_sms`, `source = 'public_form'`.

**Population (production, 2026-08-31):** **415** contacts total, **366** matching the fabricated
signature, **397** with `email IS NULL`.

> The first report of this incident quoted *72 rows in 36 hours*. That was **one sampled window,
> not the population**, and reading it as the population led to a materially wrong conclusion —
> that the pattern began ~36h ago and that the cleanup should expect ~72 rows. Both are corrected
> below. The pattern has been running since the scanner became reachable on **2026-08-23**.
> `d54131c` was committed **20:06:41 UTC**, so the first possible hourly run is **21:00 on
> 2026-08-23**; to the 2026-08-31 measurement that is **195 runs** (inclusive of both ends), a ceiling of
> **390** rows at 2/run, against **366** observed — 94% of ceiling, i.e. ~11 runs that failed or found nothing.
> (Do not compute this as "48/day × 8 days = 384": the window does not start at midnight.)
>
> Read the residual arithmetic too: 397 − 366 = **31 email-less rows that are NOT fabricated**,
> and 415 − 397 = **18 rows carrying a real email**. The 18 are out of scope entirely — **nothing
> in this cleanup may touch them.**
>
> The 31 are mostly legitimate SMS-originated contacts (`01_phase1_foundation.sql` says so in
> situ: *"Nullable email is intentional: SMS-originated contacts may not have one"*) — but **the
> seed rows are inside this group**, since they are email-less by construction. Step 1 must not
> match any of the 31; Step 3 deliberately merges two of them. Those are the only rows in the
> group the cleanup may alter, and only by the merge, never the Step 2 delete.

## The writer

**`/api/cron/inactivity-scan`** — `vercel.json` schedule `0 * * * *` (hourly, on the hour),
which matches the `:00:04` creation timestamps. Neither of the two suspected crons is
responsible: `intake-reconcile` (`*/5 * * * *`) runs `processEligibleBuyerIntakes` and never
touches `contacts`; `lead-nurture-drain` (`* * * * *`) only `select`s and `update`s contacts —
it has no insert path.

Call chain:

```
/api/cron/inactivity-scan            (hourly)
  └─ scanInactiveContacts()          lib/services/crm/inactivity-scanner.service.ts
       └─ emitDomainEvent('buyer_inactive', …)   lib/events/emit.ts:87
            └─ ContactService.upsertContact()    lib/services/contact.service.ts
                 └─ INSERT INTO contacts …       ← the fabricated row
```

## Root cause

Three defects compose. The third is the one that writes the row.

### 1. The dedup lookups fail **open**

`upsertContact` resolves a person by "email match → phone match → insert". Both lookups
destructured only `data` and discarded `error`:

```ts
const { data } = await supabase.from('contacts').select('*')
  .eq('phone', standardizedPhone).is('deleted_at', null).maybeSingle();
existing = data;                    // an ERROR is indistinguishable from "no match"
```

A dedup query that fails open does not degrade — it **fabricates**. Any failed lookup falls
through to the `INSERT` branch.

### 2. `.maybeSingle()` errors when a phone matches more than one live row

`migrations/01_phase1_foundation.sql` creates:

```sql
CREATE INDEX        idx_contacts_phone              ON contacts(phone) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX idx_contacts_email_unique_not_null
  ON contacts(lower(email)) WHERE email IS NOT NULL AND deleted_at IS NULL;
```

Email uniqueness is enforced by the database; **phone uniqueness is not**. Once two live rows
shared a phone, `.maybeSingle()` returned an error for that phone on *every* subsequent call,
so defect 1 fired deterministically — once per scan, forever.

**This is why every fabricated row has `email IS NULL` — and the reason is ordering, not
rejection.** `upsertContact` tries the email lookup *first*, and that lookup runs against a
column the database keeps unique, so it can never raise the multi-row error. A contact that has
an email therefore always resolves, takes the UPDATE branch, and **never reaches the phone lookup
or the insert at all**. Only an email-less contact falls through to the phone lookup, where the
ambiguity lives.

> An earlier draft explained this as the unique index *rejecting* duplicate inserts that carried
> an email. That is wrong: the index is a backstop that never fires in this flow, because the
> insert is never attempted for those rows. The observed "0 distinct emails" is a consequence of
> **which rows can reach the failing lookup**, not of anything the database refused.

A second, independent path into defect 1: `normalizePhone` returns `''` — not `null` — for a
number it cannot render in E.164. `''` is falsy, so the phone lookup was **skipped entirely**
and the row was written with `phone: ''`, an identity that matches nothing and therefore mints
a fresh duplicate on every later call. **This variant is NOT what happened here** — Step 0 settled
that by production query — but the same fix closes it.

### 3. The scanner's idempotency guard lands on the wrong row

`inactivity-scanner.service.ts` documents its guard as: *"an emitted contact moves to
'inactive' and drops out of the next scan — that stage advance IS the idempotency guard."*

But the advance in `emit.ts:108` targets `contact.id`, the id returned by `upsertContact`:

```ts
.update({ lifecycle_stage: advancedStage, … }).eq('id', contact.id);   // the NEW duplicate
```

not `input.domainEntityId` (`row.id`, the row that was actually scanned). So the **scanned row
never advances**, stays in `EARLY_STAGES` with an unchanged `updated_at`, and is re-selected on
the next hourly run — while the freshly minted duplicate is advanced to `inactive` and drops
out. That is the loop: one new row per affected contact per hour, indefinitely, at a constant
rate. Two stale, unresolvable contacts ⇒ exactly the observed **2 rows/hour**.

## Is `'public_form'` deliberate?

**No — it is inherited, and the label is meaningless on these rows.** The scanner passes the
source it read off the row it is scanning:

```ts
source: (row.source as ContactSource | null) ?? "import",
// comment in situ: "Ignored on update (existing contact); never overwrites the
// original source. Only used on the impossible insert path."
```

The insert path the comment calls impossible is the one that is executing. The duplicates
therefore carry the *original's* source verbatim, and the originals are `public_form` — which
is itself the default in `app/api/admin/crm/contacts/route.ts:95`
(`const source = (body.source ?? 'public_form')`). So `public_form` is a default twice over,
never a deliberate classification of these rows. It is not a usable signal for "came from a
public form", and the 403/413 concentration is partly this artifact.

## How far back

| Component | First commit | Date |
| --- | --- | --- |
| `contact.service.ts` (fail-open dedup) + `lib/events/emit.ts` | `8b3d8b8` (merge of #316) | 2026-08-19 |
| `inactivity-scanner.service.ts` (the hourly driver) | `d54131c` — *migrate campaign fan-out + scheduled cron off Inngest (Batch 8)* | 2026-08-23 |

The fail-open dedup has been latent since **2026-08-19**. It began *firing* on **2026-08-23**,
when the inactivity scan moved onto Vercel Cron and the precondition was already present — a
contact the scanner selects but `upsertContact` cannot resolve.

**The corrupted window is ~8 days, not ~1.5.** `d54131c` landed at **2026-08-23 20:06:41 UTC**, so
the first hourly run it could have driven is **21:00 that day**. From there to the 2026-08-31
measurement is **195 hourly runs** inclusive of both ends — a ceiling of **390** rows at 2 per run — against
**366** observed. That is 94% of ceiling, leaving ~12 runs that failed, found nothing, or were
skipped.
The observed count sits *below* the ceiling, as it must.

An earlier draft put the onset at 36–40 hours ago by mistaking a 36-hour sample for the whole
population — that error, uncorrected, would have made the cleanup's stop-condition reject a correct
result. See Step 1.

Note the existing test `lib/services/crm/__tests__/inactivity-scanner.test.ts` mocks
`emitDomainEvent` to return `contactId: input.domainEntityId` — it *assumes* the identity that
production violates, so the suite could never have caught this.

## The fix (smallest correct) — merged as `c1cac50` (PR #382)

`lib/services/contact.service.ts` only — the funnel all ~20 call sites share:

1. **Fail closed.** Both dedup lookups now capture `error` and throw. A failed or ambiguous
   identity lookup halts; it is never read as "no match".
2. **`''` → `null`.** An unparseable phone is absent, not empty, so it can neither skip the
   lookup nor be written as a phantom identity.
3. **Refuse an identity-less contact.** No email and no E.164 phone means nothing to dedup on
   and a guaranteed duplicate every call. `app/api/admin/crm/contacts/route.ts` already returns
   `EMAIL_OR_PHONE_REQUIRED`; this makes the invariant true at the funnel.

This stops the writes on its own: `upsertContact` throws, `emitDomainEvent` catches it at
`emit.ts:88`, logs `contact resolve failed`, and returns `contactId: null` — **no row**. The
scanner will log one error per hour for each unresolvable contact until the cleanup runs, which
is the correct visible failure in place of a silent fabrication. Once the phone matches exactly
one live row again, `upsertContact` resolves to that row, the stage advance lands on it, and it
drops out of the scan as designed — but **Step 2 alone does not guarantee that state**; the seed
rows survive it. See Step 3, which is required.

Because the fix fails closed, it also makes the affected number *unresolvable* rather than merely
duplicated until the cleanup runs. That is why the cleanup is time-sensitive and not a queued
chore — see the `+19547562609` note below.

Covered by `lib/services/__tests__/contact-dedup-fail-closed.test.ts` (6 tests, written
red-first: 4 of 6 failed before the change; the two that passed are the
contract-preservation cases).

### Recommended follow-up — NOT in this change

Defect 3 is a real bug that survives this fix (the guard still targets the resolved contact, not
the scanned row). It is currently masked, because resolution can no longer return a *different*
contact — it either returns the right one or throws. Making it correct means giving
`emitDomainEvent` a pre-resolved `contactId` and having the scanner pass `row.id`, since the
scanner already holds the contact and re-resolving it by identity fields is the mistake. That
touches the shared event spine used by every emitter, so it is proposed separately rather than
folded into a containment fix.

## Cleanup — **NOT EXECUTED**

### Step 0 — RESOLVED by production query. No action needed.

**The live trigger is the multi-row `.maybeSingle()` error.** The `normalizePhone` `''` variant is
*not* what is happening here.

| Question | Production answer |
| --- | --- |
| What phone do the fabricated rows carry? | **`+19547562609`** — a well-formed E.164 value, on all 72 sampled rows |
| Empty-string phones? | **zero** |
| NULL phones? | **zero** |
| `idx_contacts_email_unique_not_null` | **UNIQUE** on `lower(email)` `WHERE email IS NOT NULL AND deleted_at IS NULL` |
| `idx_contacts_phone` | **plain btree** — no uniqueness |

So the index asymmetry described above is confirmed *in production*, not merely inferred from the
migration file, and it is the reason every fabricated row is email-less: the database rejected
every duplicate that carried an email and permitted every duplicate that did not.

The `''` variant remains a real hole in `normalizePhone` and is closed by the same fix, but it is
not the cause of these rows and no cleanup step should look for empty-string phones.

<details>
<summary>The query that resolved this (kept for the record — already run)</summary>

```sql
SELECT phone,
       count(*)                              AS live_rows,
       count(*) FILTER (WHERE email IS NULL) AS email_null_rows,
       min(created_at)                       AS first_seen,
       max(created_at)                       AS last_seen
FROM contacts
WHERE deleted_at IS NULL
GROUP BY phone
HAVING count(*) > 1
ORDER BY live_rows DESC;
```
</details>

### ⚠ `+19547562609` is a real person — cleanup is time-sensitive

That number is **not** a placeholder or a test value. It belongs to a real person who is also
present as **3 rows in `buyers`**.

This changes the urgency of the cleanup, because of how the merged fix behaves. `upsertContact`
now **fails closed**: while more than one live `contacts` row carries `+19547562609`,
every attempt to resolve that number raises `contact dedup lookup by phone failed` instead of
silently minting a duplicate. Until the cleanup completes, **that person cannot be resolved to a
contact at all**, on any path.

What that costs, by caller:

| Path | Behaviour while duplicates remain |
| --- | --- |
| `app/api/webhooks/twilio/inbound` | `findContactByPhone` also uses `.maybeSingle()`, returns null on the multi-row error, so the route falls through to `upsertContact`, which throws. The outer handler (line 166) returns **HTTP 500**. The claim is **not** settled — `inboxClaim.settle()` is line 163, *after* the throw at 101 — so `processed` stays false and a Twilio redelivery returns `claimed`, **re-drives the handler, and fails again**. Every retry in Twilio's schedule 500s. The message never lands, but it fails **loudly and repeatedly**, not silently. |
| `/api/cron/inactivity-scan` | `emitDomainEvent` catches, logs `contact resolve failed`, returns `contactId: null`. Degraded, not user-facing. This is the intended visible failure. |
| `app/api/public/crm/partial-lead` | **Quietest, and worst for data integrity.** Email is matched first, so it only breaks when the email is *also* new — but its catch returns **HTTP 200 `{ ok: true }`**, so the browser is told the lead was captured while no contact row exists. A silently lost lead, with no error surfaced anywhere but the log. |
| `request-vehicle`, `dealer-fee-lead`, `prequal`, `trade-in`, `buyer/searches`, `voice/dispatch-request` | Each wraps the call in `try/catch` and continues; the CRM contact is simply not created or updated. |

**Note the pre-fix behaviour was not better — only quieter.** Before the fix, an inbound SMS from
this person landed on a brand-new duplicate contact every time, fragmenting their conversation
history across hundreds of rows. The fix converts silent fragmentation into a loud failure. Both
are broken; only one is visible.

> **Two corrections to an earlier draft of this table.** It claimed the Twilio retry was *deduped
> and dropped* — that is backwards. `claimProviderEvent` returns `duplicate` only when `processed`
> is true, and `settle()` (route line 163) runs *after* the throwing upsert (line 101), so the flag
> is never set and the retry **re-drives**. It also claimed `partial-lead` returns 500; it returns
> **200 `{ ok: true }`**. The corrected reading inverts which path is most dangerous: the SMS path
> is noisy and self-evident in logs, while the lead-capture path fails **silently and reports
> success**.

**Recommendation: run the cleanup promptly after the fix deploys — do not queue it for a later
maintenance window.** The deploy and the cleanup should be treated as one operation. If they must
be separated, the cleanup should follow within hours, not days, and inbound SMS from
`+19547562609` should be treated as lost for the gap.

### Step 1 — identify the fabricated rows

A fabricated row is one **born from its own inactivity event**: created by the spine in the same
instant the spine marked it inactive. A real contact is created long before it goes inactive.
That single property, plus the absence of every field a genuine capture writes, isolates them.

```sql
WITH fabricated AS (
  SELECT DISTINCT ON (c.id)          -- a contact with >1 matching stage_changed row would
         c.id, c.phone, c.created_at, t.created_at AS advanced_at   -- otherwise fan out and
  FROM contacts c                    -- inflate the count above the rows Step 2 updates
  JOIN contact_timeline_events t
    ON  t.contact_id      = c.id
    AND t.event_type      = 'stage_changed'
    AND t.event_data->>'via' = 'buyer_inactive'
    AND t.event_data->>'to'  = 'inactive'
  WHERE c.deleted_at     IS NULL
    AND c.email          IS NULL          -- only email-less rows could duplicate
    AND c.source          = 'public_form'
    AND c.lifecycle_stage = 'inactive'    -- the spine advanced the duplicate
    AND c.ip_address     IS NULL
    AND c.consent_sms     = false
    AND c.consent_email   = false
    AND c.consent_at     IS NULL
    AND c.consent_ip     IS NULL
    AND c.consent_text   IS NULL
    AND c.utm_source     IS NULL
    AND c.utm_medium     IS NULL
    AND c.utm_campaign   IS NULL
    AND c.source_url     IS NULL
    AND c.notes          IS NULL
    AND c.assigned_to    IS NULL
    AND coalesce(array_length(c.tags, 1), 0) = 0
    -- born FROM the emit: row and its own inactivity advance seconds apart
    AND t.created_at - c.created_at < interval '60 seconds'
)
SELECT f.*
FROM fabricated f
WHERE NOT EXISTS (                        -- never linked to a buyer/dealer/affiliate
        SELECT 1 FROM contact_identities ci WHERE ci.contact_id = f.id)
  AND NOT EXISTS (                        -- no human-meaningful history: the spine's
        SELECT 1 FROM contact_timeline_events t2   -- own two event types are all it has
        WHERE t2.contact_id = f.id
          AND t2.event_type NOT IN ('stage_changed', 'domain_event'))
ORDER BY f.created_at;
```

> **`DISTINCT ON (c.id)` requires `ORDER BY c.id` inside the CTE.** Add it there if your client
> rejects the statement; the outer `ORDER BY f.created_at` is only for reading the output.

**This query under-matches by design, and the residual is not zero.** Both of its defining
predicates depend on writes that `emit.ts` performs **best-effort inside `try/catch`** — the
`stage_changed` timeline row and the `lifecycle_stage` advance. A fabricated row whose stage
advance failed carries neither, so it is invisible to this query *and* it stayed in an early
lifecycle stage, which means the scanner keeps selecting it. Expect a small residue. After Step 2,
sweep for it explicitly rather than assuming it away:

```sql
-- Fabricated rows the main query cannot see: same signature, but the spine's
-- best-effort stage write did not land. Review by hand — do NOT bulk-delete.
SELECT c.id, c.lifecycle_stage, c.created_at
FROM contacts c
WHERE c.deleted_at IS NULL
  AND c.email IS NULL
  AND c.phone = '+19547562609'
  AND c.source = 'public_form'
  AND c.ip_address IS NULL
  AND c.consent_sms = false AND c.consent_email = false
  AND coalesce(array_length(c.tags, 1), 0) = 0
  AND NOT EXISTS (SELECT 1 FROM contact_identities ci WHERE ci.contact_id = c.id)
ORDER BY c.created_at;
```

The rows this returns that are **not** in the Step 1 set are either that residue or the seed rows
from Step 3 — distinguish them by `lifecycle_stage` and `created_at`, and treat any row you cannot
positively classify as real.

**Verify before deleting.**

> **Corrected twice.** The first draft said *"expect 72, growing 2/hour"* — 72 was a 36-hour
> sample, so against production's **366** that would have halted a correct cleanup. The second
> draft replaced it with a fixed band (340–450) and a fixed tripwire (397). Those are **absolute
> numbers applied to a quantity that grows**, which reintroduces the same class of error from the
> other side: 366 + 2h ≤ 450 silently expires after ~42 hours, and 397 is not a constant either.
> The rule below is stated as **time-invariant invariants** instead, so it cannot go stale.

Take all three counts in **one snapshot**, so they cannot drift relative to each other:

```sql
SELECT
  (SELECT count(*) FROM contacts WHERE deleted_at IS NULL)                        AS total_live,
  (SELECT count(*) FROM contacts WHERE deleted_at IS NULL AND email IS NULL)      AS email_null,
  (SELECT count(*) FROM ( /* the Step 1 SELECT */ ) m)                            AS matched;
```

Then check the **gaps**, not the magnitudes. Every fabricated row is email-less by construction
(the Step 1 signature requires `email IS NULL`), so `email_null` grows at exactly the same
+2/hour as `matched`. The difference between them does not grow — which is what makes it a usable
tripwire at any point in the future:

| Invariant | Expected | Meaning if violated |
| --- | --- | --- |
| `email_null − matched` | **≈ 31** | Falling toward 0 ⇒ the query is **over-matching**, eating the legitimate SMS-originated contacts. **STOP.** |
| `total_live − email_null` | **≈ 18** | The rows carrying a real email. Should not move at all. |
| `matched` | **≥ 366**, normally | The scanner only ever *adds*, so the count should not fall. But `ContactService.softDeleteContact` exists and is reachable from `DELETE /api/admin/crm/contacts/[id]`, so an admin tidying rows by hand **can** legitimately lower it. Below 366 ⇒ **investigate before proceeding**: check for admin soft-deletes in that window (`deleted_at IS NOT NULL` on rows matching the signature). Unexplained ⇒ STOP, do not "clean up what you can". |
| `matched` growth | ≈ **+2/hour** from 366 until `c1cac50` is deployed, then flat | Materially faster ⇒ a second affected number or a second writer. Slower ⇒ the scan is erroring; check the logs. |

There is deliberately **no upper bound in absolute rows**: at 2/hour the count is a function of how
long the fix takes to deploy, and any fixed ceiling would expire silently. If you want a sanity
figure, compute it at query time as `366 + 2 × (hours since 2026-08-31 23:00 UTC, capped at the
deploy of c1cac50)`.

**Shape checks, independent of any count:** every matched row's `created_at` should sit within a
few seconds of the top of an hour, and every matched row should carry `phone = '+19547562609'`.

Note the provenance: that phone was confirmed on the **72 sampled rows**, not on all 366. Treat a
matched row bearing a *different* phone as **new information rather than proof of an error** — it
would mean a second number is affected, the population is larger than this document models, and
the Step 3 seed analysis has to be repeated per phone. Stop and re-derive; do not simply widen the
delete to cover it. Run this before Step 2 to find out:

```sql
SELECT phone, count(*) FROM ( /* the Step 1 SELECT */ ) m
JOIN contacts c USING (id) GROUP BY phone ORDER BY 2 DESC;
-- expect exactly one row: '+19547562609'
```

**Hard stop — any one of these means do not delete:** a matched row with a non-NULL `email`; a
matched row with a `contact_identities` link; a matched row with a timeline event outside
`('stage_changed', 'domain_event')`. The Step 1 query already excludes all three, so any of them
appearing means the query was edited or the schema moved.

### Step 2 — remove them (prefer soft delete)

**Freeze the id set first.** Do *not* inline the Step 1 SELECT as a subquery in the UPDATE: the
predicate would be re-evaluated at UPDATE time, so if an hourly boundary is crossed between
verifying and deleting, the UPDATE touches rows Step 1 never showed you — and the "rollback if the
count differs" rule below would then reject a *correct* cleanup. Materialise the ids, verify
against that frozen list, and delete from it.

```sql
BEGIN;

-- 1. Freeze exactly the rows you verified.
CREATE TEMP TABLE fabricated_ids ON COMMIT DROP AS
SELECT id FROM ( /* the Step 1 SELECT */ ) m;

-- 2. Re-run the Step 1 invariant checks against THIS frozen set before deleting.
SELECT count(*) FROM fabricated_ids;   -- this is the number you are about to soft-delete

-- 3. Delete only from the frozen set.
UPDATE contacts SET deleted_at = now(), updated_at = now()
WHERE id IN (SELECT id FROM fabricated_ids);
-- rows updated MUST equal the count from step 2 exactly

COMMIT;   -- ROLLBACK on any mismatch
```

Rows created by the scanner *between* the freeze and the commit are simply not in the frozen set;
they are picked up by a second pass, which is correct and safe. Once `c1cac50` is deployed no new
rows are produced at all, so a single pass suffices.

Soft delete is sufficient and is the safer default: every application read path and both dedup
lookups filter `deleted_at IS NULL`, and the unique email index is likewise partial on it, so a
soft-deleted row is invisible to the dedup lookup exactly as a hard-deleted one would be — and it
is reversible. A hard `DELETE` also works — the CASCADE children would go with it — but discards
the evidence and cannot be undone.

> **Step 2 does NOT on its own resolve the phone ambiguity.** The seed rows are not in the Step 1
> set and survive this delete, so `.maybeSingle()` keeps erroring and the affected person stays
> unresolvable. Only Step 3 closes that. Do not stop here.

### Step 3 — REQUIRED. Reduce the phone to exactly one live row (expect to find 2+).

**Deleting the 366 fabricated rows may not, on its own, restore contact resolution for
`+19547562609`. Do not close this out after Step 2 without running this check.**

The reasoning is forced by the mechanism. A *single* live row cannot start the loop: the scanner
would find it, `.maybeSingle()` would match exactly one, `upsertContact` would UPDATE it, the stage
advance would land on it, and it would drop out of the scan. The loop can only begin when **two or
more** live rows already share the phone. Those seed rows are not fabricated — they predate the
first duplicate, so they do **not** match the Step 1 signature and Step 2 will **not** remove them.

If two or more remain afterwards, `.maybeSingle()` still errors, `upsertContact` still fails
closed, and that real person is *still* unresolvable — with the cleanup appearing to have
succeeded. Inbound SMS from them stays broken.

```sql
-- Run AFTER Step 2 commits. The EXPECTED result is 2 or more, not 1 — see below.
SELECT id, email, first_name, last_name, source, lifecycle_stage,
       consent_sms, consent_email, created_at, updated_at
FROM contacts
WHERE phone = '+19547562609'
  AND deleted_at IS NULL
ORDER BY created_at;
```

**Expect 2 or more — that is success, not failure.** The seed rows are what the model predicts
survive Step 2, and two independent facts pin the number at ~2: the loop cannot start below two,
and the steady rate of **2 rows/hour** means exactly two scanned-but-unresolvable rows are
producing duplicates each run. Step 1 cannot have removed them, because it requires
`lifecycle_stage = 'inactive'` and these are precisely the rows that never advance.

- **2 or more rows** → **the expected outcome.** The seed. These are real rows, so this is a
  **merge, not a delete** — proceed to the merge below. Resolution is *not* yet restored.
- **Exactly 1 row** → possible but unexpected: the seed was already reduced (a prior manual
  merge, or one row soft-deleted). Resolution is restored — on the next hourly scan the row
  resolves to itself, the advance lands on it, it moves to `inactive`, and it leaves the scan.
  Satisfy yourself as to *why* it is 1 before closing out; under this document's model it should
  have been ≥2.
- **0 rows** → Step 2 over-matched and soft-deleted a real contact. Step 2 has **already
  committed**, so there is nothing to `ROLLBACK`; the repair is a compensating **un-delete**. This
  is why Step 2 keeps its frozen id list — restore from it, then re-derive Step 1:

  ```sql
  -- Only valid if the temp table still exists in this session; otherwise restore by
  -- the exact deleted_at timestamp Step 2 stamped.
  UPDATE contacts SET deleted_at = NULL, updated_at = now()
  WHERE id IN (SELECT id FROM fabricated_ids);
  ```

  If the session is gone, `deleted_at` is your key: every row Step 2 touched carries the identical
  `now()` value from that one statement. **Record that timestamp when you run Step 2.**

To merge: keep the row that best represents the person — richest identity, earliest `created_at`,
any `contact_identities` link.

> **Merge the row-level state first, or the merge loses consent.** Re-pointing child rows moves
> *history*; it does not move anything stored **on** the loser. `contacts.do_not_contact` is the
> one that matters: if a loser carries `do_not_contact = true` and the keeper does not, soft-
> deleting the loser **silently discards an opt-out** and the surviving row is contactable. The
> same applies to `consent_sms` / `consent_email` (merge upward — `upsertContact` never downgrades
> consent, and neither should this), and to `lead_score` / `lead_temperature`, which are
> denormalised columns on `contacts`: re-pointing `lead_scoring_events` moves the ledger but does
> **not** recompute the score on the keeper.

```sql
-- Merge row-level state onto the keeper BEFORE touching the children.
-- Restrictive wins for suppression; permissive never overwrites restrictive.
UPDATE contacts k SET
  do_not_contact = k.do_not_contact OR l.dnc,
  consent_sms    = k.consent_sms   OR l.sms,
  consent_email  = k.consent_email OR l.email_ok,
  first_name     = coalesce(k.first_name, l.first_name),
  last_name      = coalesce(k.last_name,  l.last_name),
  email          = coalesce(k.email,      l.email),
  updated_at     = now()
FROM (
  SELECT bool_or(do_not_contact) AS dnc,
         bool_or(consent_sms)    AS sms,
         bool_or(consent_email)  AS email_ok,
         min(first_name)         AS first_name,
         min(last_name)          AS last_name,
         min(email)              AS email
  FROM contacts WHERE id = ANY(:loser_ids)
) l
WHERE k.id = :keep_id;
```

`email` can only ever be merged when the keeper's is NULL — the unique partial index on
`lower(email)` guarantees no two live rows hold the same address, so there is nothing to
reconcile. Re-derive `lead_score` from `lead_scoring_events` after the re-point if the score
matters operationally; this document does not attempt it.

Then re-point what references the losers:

**Nine tables reference `contacts(id)`, not two.** Because the losers are *soft*-deleted, no
`ON DELETE CASCADE` ever fires, so nothing is destroyed — but every child row stays attached to a
contact that all application reads filter out. Left unmoved, the person's SMS thread vanishes from
the inbox, their tasks and campaign history detach, and their lead score stops accruing to the
surviving row.

| Table | FK rule | Re-point? | Note |
| --- | --- | --- | --- |
| `contact_timeline_events` | CASCADE | yes | no unique constraint — safe bulk update |
| `conversations` | CASCADE | yes | the SMS inbox thread; safe bulk update |
| `crm_tasks` | CASCADE | yes | nullable FK, no unique constraint |
| `lead_scoring_events` | CASCADE | yes | unique index is on `idempotency_key` only — cannot collide |
| `contact_identities` | CASCADE | **guarded** | `UNIQUE(entity_type, entity_id)` |
| `workflow_enrollments` | CASCADE | **guarded** | `UNIQUE(workflow_id, contact_id)` |
| `campaign_recipients` | CASCADE | **guarded** | `UNIQUE(campaign_id, contact_id)` |
| `email_suppression` | SET NULL | **no** | keyed on `email` (`NOT NULL UNIQUE`) |
| `sms_suppression` | SET NULL | **no** | keyed on `phone` (`NOT NULL UNIQUE`) |

**The two suppression tables need no action and must not be re-pointed.** Their `contact_id` is
decorative provenance; `SuppressionService` looks opt-outs up by address and number, both of which
are independently unique. A soft-deleted loser therefore cannot lose someone's STOP or
unsubscribe — worth stating plainly, because getting this wrong would be a consent violation.

```sql
BEGIN;

-- Unconstrained children: plain re-point.
UPDATE contact_timeline_events SET contact_id = :keep_id WHERE contact_id = ANY(:loser_ids);
UPDATE conversations           SET contact_id = :keep_id WHERE contact_id = ANY(:loser_ids);
UPDATE crm_tasks               SET contact_id = :keep_id WHERE contact_id = ANY(:loser_ids);
UPDATE lead_scoring_events     SET contact_id = :keep_id WHERE contact_id = ANY(:loser_ids);

-- Constrained children: move only where the keeper does not already hold the row,
-- otherwise the unique index rejects the whole statement. What stays behind is a
-- duplicate of something the keeper already has, so leaving it is correct.
UPDATE workflow_enrollments w SET contact_id = :keep_id
 WHERE w.contact_id = ANY(:loser_ids)
   AND NOT EXISTS (SELECT 1 FROM workflow_enrollments k
                    WHERE k.workflow_id = w.workflow_id AND k.contact_id = :keep_id);

UPDATE campaign_recipients r SET contact_id = :keep_id
 WHERE r.contact_id = ANY(:loser_ids)
   AND NOT EXISTS (SELECT 1 FROM campaign_recipients k
                    WHERE k.campaign_id = r.campaign_id AND k.contact_id = :keep_id);

UPDATE contact_identities i SET contact_id = :keep_id
 WHERE i.contact_id = ANY(:loser_ids)
   AND NOT EXISTS (SELECT 1 FROM contact_identities k
                    WHERE k.entity_type = i.entity_type AND k.entity_id = i.entity_id
                      AND k.contact_id = :keep_id);

UPDATE contacts SET deleted_at = now(), updated_at = now()
 WHERE id = ANY(:loser_ids)
   AND id <> :keep_id;          -- belt and braces: never soft-delete the row you kept

COMMIT;
```

**Re-verify after the merge** — the same query from the top of this step must now return exactly
one row, and that row must carry the merged `do_not_contact` / consent flags:

```sql
SELECT id, email, first_name, do_not_contact, consent_sms, consent_email, lifecycle_stage
FROM contacts WHERE phone = '+19547562609' AND deleted_at IS NULL;
-- expect exactly 1 row
```

Only when that returns one row is contact resolution for this person actually restored.

Do **not** hard-delete the losers: every CASCADE child above would be destroyed, including the
real person's conversation and timeline history.

**Related, and out of scope here:** the same person has **3 rows in `buyers`**. That is a separate
duplication in a different table which this incident does not cover and this cleanup must not
touch. It is worth its own investigation — it may share a root cause with the seed rows.

## Boundary

No schema change. No production mutation by this document or the change that accompanies it —
**the cleanup in Steps 1–3 has NOT been run.** No cron disabled: `inactivity-scan` is still
scheduled and, with the fix deployed, fails loudly instead of fabricating. Disabling it needs
owner approval and, given the fix, should not be necessary.

Every production figure in this document was supplied by the owner from queries run against
production — the `+19547562609` value, 415/366/397, the index definitions, the 3 `buyers` rows,
**the 2 rows/hour rate, and the `:00:04–:00:05` creation timestamps**. The rate and timestamps
came from a 36-hour sample, and the phone from a 72-row sample; neither has been confirmed across
the full 366.

No session authoring this document has had database access. **Nothing here was measured by the
author** — the code, DDL and git history are first-hand; every number is second-hand. Re-measure
every count in the stop-condition at cleanup time rather than trusting this page.
