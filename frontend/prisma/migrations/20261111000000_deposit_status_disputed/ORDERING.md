# ORDERING — a correction to this migration's own header

**This file corrects `migration.sql` in this directory. Where the two disagree, this file is
right.** The header sentence quoted below was wrong, and it was wrong in the direction that
gets someone hurt: it understated a hard ordering constraint as an optional one.

`migration.sql` is not edited, and the reason is in *Why this is a separate file* at the
bottom. Read that before "just fixing the comment".

---

## The sentence that is wrong

`migration.sql:45-48`, under "ORDERING AGAINST THE APPLICATION DEPLOY":

> This one is additive and safe in either order, which is not true of most of this wave's
> siblings: a deployment that does not yet know the label simply never writes it, and one
> that does write it fails with 22P02 invalid_text_representation until the label lands.
> Apply the migration first.

Three things are wrong with it.

**It is not safe in either order.** Deploying the application before this migration breaks
every buyer at checkout.

**It reasons only about writes.** "A deployment that does not yet know the label simply never
writes it" is true and irrelevant. The label also travels on a **read**.

**Its contrast with its siblings is backwards.** It says the weak constraint is "not true of
most of this wave's siblings". The immediate sibling,
`20261110000000_claim_token_purpose/migration.sql:41-46`, reasons correctly about reads and
states the order as a requirement. That one got it right. This one did not.

The sentence also contradicts itself: it claims either order is safe and then instructs
"Apply the migration first". If either order were safe there would be no order to state.

## Why the order is a requirement — the read predicate

`OBLIGATION_BEARING` is a plain array of enum literals:

```ts
// lib/services/payment/deposit-obligation.ts:164
const OBLIGATION_BEARING = ["PENDING", "PAID", "FAILED", "DISPUTED"] as const;
```

It is spread, unconditionally, into a query predicate:

```ts
// lib/services/payment/deposit-obligation.ts:195, inside db.deposit.findMany
status: { in: [...OBLIGATION_BEARING] },
```

Prisma emits `WHERE status IN ($1,$2,$3,$4)` with each value bound and cast to
`"DepositStatus"`. Against a database whose type has only the four original labels, the fourth
bind raises **`22P02 invalid_text_representation`** — and because the predicate is
unconditional, the failure is not scoped to rows in the new state. It is the whole query, for
every caller, immediately.

There is no feature flag, branch, environment check or fallback around it.

## What breaks, exactly

`findExistingDepositObligation` is called from three places, all unconditionally:

| Caller | Reached by |
| --- | --- |
| `app/api/buyer/deposit/create-intent/route.ts:217` | every buyer at checkout |
| `app/api/admin/payments/deposit/create-intent/route.ts:62` | an admin issuing a $99 |
| `app/api/admin/payments/deposit/send-link/route.ts:60` | an admin mailing a payment link |

The buyer path is the severe one, and it is worse than "a buyer who tries to pay". The
checkout page fires a probe on mount — `app/buyer/deposit/page.tsx:259` calls
`postCreateIntent(false, token)` from its effect — so the query runs for **every buyer who
merely opens `/buyer/deposit`**, before they touch anything.

The remaining sites that name the label are narrower, and none of them would have surfaced the
problem first:

| Site | Reached by |
| --- | --- |
| `lib/services/payment/fulfillment-hold.service.ts:109-110` | the **write**, on `charge.dispute.created` |
| `lib/services/payment/fulfillment-hold.service.ts:270` (`DISPUTE_WON_FROM`) | `charge.dispute.closed`, won |
| `lib/services/payment/fulfillment-hold.service.ts:320` (`REFUND_FROM`) | `charge.dispute.closed`, lost |
| `app/api/webhooks/stripe/route.ts:946` (`REFUND_FROM`) | `charge.refunded` |
| `lib/services/payment/refund.service.ts:113` (`REFUND_FROM`) | the admin refund route |

That distribution is exactly why the header's author reached the wrong conclusion: every
*obvious* use of `DISPUTED` really is a webhook-only write. The hot-path read is the one that
does not look like a dispute feature at all.

**The reverse order is safe**, and that half of the header was right. An application that
predates this phase neither sends the label nor can receive it — nothing writes it, so no row
can carry it — and the label sits inert until the code that uses it ships.

## Nothing in CI catches this

The `Migration chain (empty DB -> schema)` job runs `pnpm exec prisma migrate deploy` against a
**fresh, empty** PostgreSQL service container. The chain is always fully applied before any
query runs there, so the mismatch cannot occur.

The mismatch exists only in the window between a production application deploy and a production
migration. No automated check in this repository looks at that window. The only thing standing
in it is the runbook order in `docs/transaction-flow/IMPLEMENTATION-WORKFLOW.md` §8.1a.2 — and
a comment like the one above, which is why a comment that understates the constraint is a real
defect and not a wording quibble.

## The same query carries a second ordering hazard, of a different class

Worth knowing, because it changes what "check the predicate" means in practice.

The `findMany` at `lib/services/payment/deposit-obligation.ts:192` (the same call whose predicate is quoted above) has **no `select`**. Prisma's
default read therefore selects every scalar the `Deposit` model declares in `schema.prisma` — not
just the columns this function reads. So the same hot-path query is also coupled to every
*column* migration on `deposits`, and a column the deployed database lacks fails earlier and
differently: **`42703 undefined_column`**, before the enum bind is ever reached.

That is precisely the mechanism the sibling migration
(`20261110000000_claim_token_purpose/migration.sql:41-46`) documented correctly, and it is the
reason a `select` on a hot query is a deploy-order control and not just a performance one.

**This is not a claim about production's current state.** The physical-schema baseline under
`docs/transaction-flow/phase-1-proof/production-baseline/` is a snapshot synthesised on
2026-09-03 and does not show the Phase 1 wave's `deposits` columns. It is stale for that
purpose: this repository has 107 migration directories and production's ledger holds 107 rows,
so the whole chain — the Phase 1 wave included — is recorded as applied. Reading the baseline as
current production state is an easy mistake and produces the wrong conclusion; the ledger is the
authority on what is applied, and the baseline is the authority only on what the schema looked
like on the day it was taken.

## The correct rule, stated generally

> A migration that adds an enum label is **not** order-independent merely because it is
> additive. If any application code names the new label in a **query predicate**, the
> migration must be applied before the deploy, without exception. Check for reads, not just
> writes — a predicate is a read, and it fails for everyone, not only for rows in the new
> state.

This is now recorded in two places a future author will actually hit: at the definition of
`OBLIGATION_BEARING` itself (`lib/services/payment/deposit-obligation.ts`), and in the "Add a
status value" workflow of `.claude/skills/autolenis-supabase-postgres/SKILL.md`.

## A second, smaller correction — `rollback.sql:17-19`

`rollback.sql` says a row left at `DISPUTED` when the reverted code ships means "every read of
it raises 22P02 on the way into the old enum's TypeScript union."

**The substance is right and the instruction stands**: move those rows to `PAID` before
deploying reverted code. **The error code is misattributed.** `22P02
invalid_text_representation` is what PostgreSQL raises when an unknown label is sent *to* it.
Reading a row whose stored label the database still recognises produces no PostgreSQL error at
all; the failure happens client-side, when the Prisma client — regenerated from a
four-label enum — deserializes a value its union does not contain. Same outcome, different
layer, and worth knowing when you are reading a stack trace at 2am to decide which side is
broken.

*(Reasoned from the semantics of the two layers, not executed against a live rollback. The
instruction it qualifies is unaffected either way.)*

## Why this is a separate file, and not an edit to `migration.sql`

**Because `migration.sql` has been applied to production, and Prisma fingerprints it.**

Production's ledger table carries a checksum column —
`checksum character varying(64) NOT NULL`, per the committed physical-schema baseline at
`docs/transaction-flow/phase-1-proof/production-baseline/10-tables-a.sql:2`. That is a 64-character
hex digest: a SHA-256 of the migration file's bytes, recorded when the migration was applied.
Editing so much as a comment in `migration.sql` changes those bytes and therefore the digest,
and the value recorded in production no longer describes the file in the repository.

`CLAUDE.md` states the rule without qualification: **never edit an existing file under
`frontend/prisma/migrations/**`.** Adding a *new* file there is ordinary work, and this
directory already demonstrates that a non-`migration.sql` companion is safe — `rollback.sql`
has always sat beside it, in this directory and seven others, with the CI migration job green.
`prisma migrate deploy` reads `migration.sql` from each directory and ignores everything else.

So the correction lands here, in the migration's own directory, where the person who opens this
migration will find it, and the fingerprinted file is left exactly as production recorded it.

**To confirm this from the production side** (a read-only query, permitted under the per-run
protocol):

```sql
SELECT migration_name, checksum
  FROM _prisma_migrations
 WHERE migration_name = '20261111000000_deposit_status_disputed';
```

At the time this file was written, the repository's `migration.sql` hashed to:

```
c91b2b173069c7fc771307131f873cd571d67fd6d8c4bc9971eb0f71758cea2a
```

If the recorded checksum matches, the file is untouched since it was applied — which is the
state it should stay in. If someone later edits `migration.sql` anyway, that is the query that
will tell you.
