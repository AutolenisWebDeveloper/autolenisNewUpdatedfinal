# Fabricated `public_form` contacts — root cause, fix, and cleanup

**Status:** cause identified · fix on branch · **cleanup NOT executed**
**Observed:** 72 contacts in 36h, 2/hour at `:00:04–:00:05`; `contacts` 375 → 413 in ~19h;
403 of 413 rows `source = 'public_form'`; every fabricated row `email NULL`, `first_name`
blank, identical phone, no `ip_address`, no `consent_sms`; 0 distinct emails across all 72.

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

**This is why every fabricated row has `email IS NULL`.** The insert is attempted for whatever
contact the scanner is processing; the unique partial index rejects any duplicate carrying a
real email (that path throws, is caught by `emitDomainEvent`, and is logged as
"contact resolve failed" — no row). Only the email-less ones survive to disk. The observed
"0 distinct emails across all 72" is the index doing its job on the rows it *could* police.

A second, independent path into defect 1: `normalizePhone` returns `''` — not `null` — for a
number it cannot render in E.164. `''` is falsy, so the phone lookup was **skipped entirely**
and the row was written with `phone: ''`, an identity that matches nothing and therefore mints
a fresh duplicate on every later call. Both variants produce rows with an identical phone
value; see the confirmation query below for which one is live.

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

The fail-open dedup has been latent since **2026-08-19**. It became reachable on a schedule on
**2026-08-23**, when the inactivity scan moved onto Vercel Cron. It only began *firing* when the
precondition appeared — a contact the scanner selects but `upsertContact` cannot resolve — which
the row timestamps put at roughly **36–40 hours ago**. The code was vulnerable for 12 days; the
data has been corrupted for ~1.5.

Note the existing test `lib/services/crm/__tests__/inactivity-scanner.test.ts` mocks
`emitDomainEvent` to return `contactId: input.domainEntityId` — it *assumes* the identity that
production violates, so the suite could never have caught this.

## The fix (smallest correct)

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
is the correct visible failure in place of a silent fabrication. After cleanup, the phone
matches exactly one row again, `upsertContact` resolves to the original, the stage advance
lands on it, and it drops out of the scan as designed.

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

### Step 0 — confirm which variant is live (read-only)

```sql
-- Which phone values carry more than one live row, and what do they look like?
-- A valid E.164 value with >1 row  ⇒ the multi-row `.maybeSingle()` trigger.
-- An empty-string ('') phone       ⇒ the normalizePhone '' trigger.
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

### Step 1 — identify the fabricated rows

A fabricated row is one **born from its own inactivity event**: created by the spine in the same
instant the spine marked it inactive. A real contact is created long before it goes inactive.
That single property, plus the absence of every field a genuine capture writes, isolates them.

```sql
WITH fabricated AS (
  SELECT c.id, c.phone, c.created_at, t.created_at AS advanced_at
  FROM contacts c
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

**Verify before deleting:** the count should match the fabricated population (72 at time of
report, growing by 2/hour until the fix deploys), every `created_at` should sit within a few
seconds of the top of an hour, and the set must contain **no** row with an email, an identity
link, or a message/note event. If the count is materially different, stop — the mechanism is not
what this document describes.

### Step 2 — remove them (prefer soft delete)

```sql
BEGIN;
UPDATE contacts SET deleted_at = now(), updated_at = now()
WHERE id IN ( /* the SELECT above, id only */ );
-- expect: 72 (or 72 + 2 per hour elapsed since this report)
COMMIT;   -- ROLLBACK if the count is not what Step 1 showed
```

Soft delete is sufficient and is the safer default: every application read path and both dedup
lookups filter `deleted_at IS NULL`, and the unique email index is likewise partial on it. So
soft-deleting the duplicates **also resolves the phone ambiguity** that triggers the bug, and it
is reversible. A hard `DELETE` also works — `contact_identities` and `contact_timeline_events`
are `ON DELETE CASCADE` — but discards the evidence and is not reversible.

## Boundary

No schema change. No production mutation. No cron disabled — `inactivity-scan` is still
scheduled and, with the fix deployed, fails loudly instead of fabricating. Disabling it needs
owner approval and, given the fix, should not be necessary.
