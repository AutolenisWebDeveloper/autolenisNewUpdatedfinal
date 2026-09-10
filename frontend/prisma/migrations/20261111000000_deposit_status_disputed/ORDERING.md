# ORDERING — a correction to this migration's own header

**This file corrects `migration.sql` in this directory. Where the two disagree, this file is
right.** The header sentence quoted below was wrong, and it was wrong in the direction that gets
someone hurt: it understated a hard ordering constraint as an optional one.

`migration.sql` is not edited. See *Why this is a separate file* at the bottom before "just
fixing the comment".

> **State of this migration.** It **has been applied to production**, at
> `2026-09-10T04:15:47Z`, two minutes before the Phase 3 merge. Owner-supplied and verified by
> the owner against production; not re-derived here, and no session that wrote this file held a
> production credential. Several artifacts around it still read "WRITTEN BUT NOT APPLIED"
> (`migration.sql:3`, `docs/transaction-flow/phase-3-proof/README.md:3`) — they were true when
> written and are now stale. Trust the ledger row and `pg_enum`, not the prose.

---

## The sentence that is wrong

`migration.sql:45-48`, under "ORDERING AGAINST THE APPLICATION DEPLOY":

> This one is additive and safe in either order, which is not true of most of this wave's
> siblings: a deployment that does not yet know the label simply never writes it, and one
> that does write it fails with 22P02 invalid_text_representation until the label lands.
> Apply the migration first.

**It is not safe in either order.** Deploying the application before this migration would have
broken checkout.

**It reasons only about writes.** "A deployment that does not yet know the label simply never
writes it" is true and irrelevant. The label also travels on a **read**.

**It exempts itself from a rule it states correctly.** Read carefully, "which is not true of
most of this wave's siblings" says the *siblings* are order-dependent — and they are. The
immediate sibling, `20261110000000_claim_token_purpose/migration.sql:41-46`, states its own
constraint accurately and defers to the runbook. The error is not the observation about the
siblings; it is the self-exemption, claimed by the one migration in the wave whose label sits in
the hottest read predicate of the set.

It also contradicts itself: it claims either order is safe and then instructs "Apply the
migration first". If either order were safe there would be no order to state. Reaching the right
conclusion from a wrong premise is worse than silence, because the next reader can reverse it.

## Why the order is a requirement — the read predicate

`OBLIGATION_BEARING` is a plain array of enum literals:

```ts
// lib/services/payment/deposit-obligation.ts:164
const OBLIGATION_BEARING = ["PENDING", "PAID", "FAILED", "DISPUTED"] as const;
```

It is spread, with no flag or branch, into a query predicate:

```ts
// lib/services/payment/deposit-obligation.ts:195, inside db.deposit.findMany
status: { in: [...OBLIGATION_BEARING] },
```

Prisma emits `WHERE status IN ($1,$2,$3,$4)` with each value bound and cast to
`"DepositStatus"`. Against a database whose type has only the four original labels, the fourth
bind raises **`22P02 invalid_text_representation`** — the same mechanism Phase 1 already
recorded at `docs/transaction-flow/phase-1-proof/preflight.sql:83-90`. And because the label is
in the predicate rather than in the data, the failure is not scoped to rows in the new state: it
is the whole query, for every caller that reaches it.

## What breaks, exactly

`findExistingDepositObligation` has three callers:

| Caller | Reached by |
| --- | --- |
| `app/api/buyer/deposit/create-intent/route.ts:217` | a buyer at checkout |
| `app/api/admin/payments/deposit/create-intent/route.ts:62` | an admin issuing a $99 |
| `app/api/admin/payments/deposit/send-link/route.ts:60` | an admin mailing a payment link |

**Sized precisely, because overstating it is its own failure.** The buyer route is not reached by
everyone who loads the page. Four exits precede the obligation query: the entry throttle
(`:38`), the per-call limiter (`:140-141`), `REQUEST_REQUIRED` when the buyer has no open request
(`:166`), and the §5a transition gate (`:183`). So the 500 lands on **every eligible buyer with
an open request who was about to pay** — which is the population that matters, and it is still
far wider than "disputed deposits".

It is also not limited to buyers who click. The checkout page fires the same call as a probe on
mount (`app/buyer/deposit/page.tsx:259`), so an eligible buyer who merely opened `/buyer/deposit`
would have hit it.

The remaining sites that put the label in front of PostgreSQL are narrower, and none of them
would have surfaced the problem first:

| Site | Kind | Reached by |
| --- | --- | --- |
| `lib/services/payment/fulfillment-hold.service.ts:125` | the **write** (`status: "DISPUTED"`) | `charge.dispute.created` |
| `lib/services/payment/fulfillment-hold.service.ts:270` (`DISPUTE_WON_FROM`) | predicate | `charge.dispute.closed`, won |
| `lib/services/payment/fulfillment-hold.service.ts:320` (`REFUND_FROM`) | predicate | `charge.dispute.closed`, lost |
| `app/api/webhooks/stripe/route.ts:946` (`REFUND_FROM`) | predicate | `charge.refunded` |
| `lib/services/payment/refund.service.ts:113` (`REFUND_FROM`) | predicate | three admin routes **and** the `refund_deposit` AI action intent |

*(The refund predicate's four call paths: `admin/payments/deposit/[depositId]/refund/route.ts:50`,
`admin/deals/[dealId]/action/route.ts:261`, `admin/auctions/[auctionId]/action/route.ts:176`, and
`processRefund` at `refund.service.ts:180`, which the AI action-intent catalogue names as the
canonical service. Still narrow — but it is not "the admin refund route" alone.)*

Two further sites name the label and **never send it to PostgreSQL**, which is worth stating so
an auditor does not have to re-derive it: `lib/payments/deposit-state.ts` (the enum's canonical
module — `DEPOSIT_STATUSES` at `:36`, the transition matrix, and the per-event predecessor sets;
all in-memory), and `app/admin/payments/deposits/page.tsx:21`, whose filter chips are applied in
JavaScript over rows already fetched.

That distribution is exactly why the header's author reached the wrong conclusion. Every
*obvious* use of `DISPUTED` really is a webhook-only write. The hot-path read does not look like
a dispute feature at all.

**The reverse order is safe**, and that half of the header was right. An application that
predates this phase neither sends the label nor can receive it — nothing writes it, so no row can
carry it — and the label sits inert until the code that uses it ships.

## The same query carries a second ordering hazard, of a different class

The `findMany` at `lib/services/payment/deposit-obligation.ts:192` — the same call whose predicate
is quoted above — has **no `select`** and no `include`. Prisma's default read therefore selects
every scalar the `Deposit` model declares in `schema.prisma`, not just the columns this function
reads. So the query is also coupled to every *column* migration on `deposits`, and a column the
deployed database lacks fails earlier and differently: **`42703 undefined_column`**, before the
enum bind is reached.

That is precisely the mechanism the sibling migration documented, and it is why a `select` on a
hot query is a deploy-order control and not only a performance one.

**On reading the baseline as production state — don't.** The physical-schema snapshot under
`docs/transaction-flow/phase-1-proof/production-baseline/` was synthesised on 2026-09-03
(`00-header.sql:3`) and shows `deposits` without the Phase 1 columns (`14-tables-e.sql:318-328`).
That is what production looked like that day, not what it looks like now, and reading it as
current state produces a confidently wrong answer.

Nor is the ledger the authority to reach for instead. This project's defining incident is
migrations physically applied with **no** ledger row — `CLAUDE.md` puts it as "out-of-band DDL is
how six migrations went unrecorded". **The physical schema is the authority on what is applied;
the ledger is known to trail it, and both are checked** (`phase-3-proof/README.md:63`: both
halves, because neither alone is sufficient).

## Nothing in CI catches the ordering hazard

The `Migration chain (empty DB -> schema)` job runs `prisma migrate deploy` against a **fresh,
empty** PostgreSQL service container, asserting zero `public` tables first. The chain is always
fully applied before any query runs there, so the mismatch cannot occur. The `ci` job runs the
suite against a placeholder DSN.

The mismatch exists only in the window between a production application deploy and a production
migration, and no job in this repository observes that window. What stands in it is the runbook
order in `docs/transaction-flow/IMPLEMENTATION-WORKFLOW.md` §8.1a.2, and comments like the one
above — which is why a comment that understates the constraint is a real defect and not a wording
quibble.

## The correct rule, stated generally

> A migration that adds an enum label is **not** order-independent merely because it is additive.
> If any application code names the new label in a **query predicate**, the migration must be
> applied before the deploy, without exception. Check for reads, not just writes — a predicate is
> a read, and it fails for every caller that reaches it, not only for rows in the new state.

This is recorded in three places a future author will actually hit, in the order they hit them:

1. `lib/payments/deposit-state.ts`, beside `DEPOSIT_STATUSES` — the file you edit *first* when
   adding a `DepositStatus` label, and the one with least obvious reason to mention deployment.
2. `lib/services/payment/deposit-obligation.ts`, at the definition of `OBLIGATION_BEARING` — the
   array that actually creates the coupling.
3. `.claude/skills/autolenis-supabase-postgres/SKILL.md`, "Add a status value" — the curated
   workflow, for a label anywhere in the schema.

## A second, smaller correction — `rollback.sql:17-19`

`rollback.sql` says a row left at `DISPUTED` when the reverted code ships means "every read of it
raises 22P02 on the way into the old enum's TypeScript union."

**The substance is right and the instruction stands**: move those rows to `PAID` before deploying
reverted code. **The error code is misattributed.** `22P02 invalid_text_representation` is what
PostgreSQL raises when an unknown label is sent *to* it. Reading a row whose stored label the
database still recognises produces no PostgreSQL error at all; the failure happens client-side,
when the Prisma client — regenerated from a four-label enum — decodes a value its union does not
contain. Same outcome, different layer, and worth knowing when you are reading a stack trace at
2am to decide which side is broken.

*(Reasoned from the semantics of the two layers. The exact client-side error code was not
confirmed against a live database. The instruction it qualifies is unaffected either way.)*

## Why this is a separate file, and not an edit to `migration.sql`

**Two independent reasons. Either alone is sufficient.**

**1. `CLAUDE.md` forbids it, without qualification:** never edit an existing file under
`frontend/prisma/migrations/**`. That rule does not turn on whether the file has been applied,
and it is enforced by a PreToolUse guard.

**2. This one has been applied, so it is now fingerprinted.** Production's ledger carries
`checksum character varying(64) NOT NULL`
(`docs/transaction-flow/phase-1-proof/production-baseline/10-tables-a.sql:3`), holding
`sha256(migration.sql)` as of apply time. Editing a byte changes the digest, and the value
recorded in production stops describing the file in the repository.

That the checksum is `sha256(migration.sql)` is not an inference:
`docs/plans/MIGRATION-LEDGER-RECONCILIATION.md:462` states it, and §7.3 proved it against this
project's live ledger — recomputing the digest reproduced the stored value for **61 of the 67**
rows recorded at the time.

**And the six that did not match are the argument.** Every one was a migration whose repository
file had been edited *after* it was recorded, leaving the ledger holding, in that document's
words, "a fossil of the pre-edit file". Their consequence is concrete and current: §7.1 records
that they made the planned reconciliation sequence's stated post-condition **already unachievable
before it began**, and §7.6 that Prisma ships no CLI command to repair a stale checksum.

**They are still unrepaired.** §7.8 is explicit that no `prisma migrate` command was run — not
`resolve`, not `deploy`, not `status` — that the six were not repaired, and that the
`migrate status` / `migrate deploy` consequences in that document are themselves labelled **NOT
VERIFIED**, for want of a production credential. `docs/plans/sql/003_migration_ledger_reconciliation.sql`
is a *proposed* repair awaiting an owner with a real DSN, not a repair that happened.

So: six live stale checksums, no tool to fix them, and a reconciliation still outstanding.
Editing this migration to correct its own comment *about ordering discipline* would make seven.

**A new file here is safe.** `prisma migrate deploy` reads only `migration.sql` per directory;
`prisma/__tests__/migration-chain.test.ts:26-31,100-112` enumerates **directories** and requires
a `migration.sql` in each, so a `.md` inside an existing directory trips nothing; and
`rollback.sql` already sits beside `migration.sql` here and in seven other directories with the
migration CI job green.

**If the header itself should be changed anyway**, that is the owner's call, and it should be
paired with a ledger checksum realignment rather than done alone — otherwise it creates the
seventh fossil while fixing a comment about not creating fossils.

### Checking the fingerprint

A read-only query, permitted under the per-run protocol:

```sql
SELECT migration_name, checksum, finished_at, applied_steps_count
  FROM _prisma_migrations
 WHERE migration_name = '20261111000000_deposit_status_disputed';
```

and against the file:

```
sha256sum frontend/prisma/migrations/20261111000000_deposit_status_disputed/migration.sql
```

At the time this file was written that command returned:

```
c91b2b173069c7fc771307131f873cd571d67fd6d8c4bc9971eb0f71758cea2a
```

Expected: one row, `applied_steps_count` 1, and the two digests equal. They should stay equal for
the life of this migration.

- **Digests differ** → someone edited an applied migration. §7.3 of the reconciliation plan is the
  procedure; the repair is an owner-approved realignment, never a re-apply.
- **Zero rows** → do **not** reach for `migrate resolve --applied`. Recording it as applied
  without running the `ALTER TYPE` leaves `pg_enum` with four labels while `migrate status`
  reports clean — which manufactures the exact 22P02-on-every-checkout this file exists to
  prevent, with the one detector silenced. Check `pg_enum` for the label first, and treat a
  present label with an absent row as the recorded incident class it is.
