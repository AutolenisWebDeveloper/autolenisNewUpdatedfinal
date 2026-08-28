# Dealer invitation tokens — schema-compat shim

## What broke

PR #348 changed `DealerInvitation` to store its token **hashed at rest** with an
explicit `consumedAt` marker, and added the columns to `prisma/schema.prisma`.
The migration that creates those physical columns
(`prisma/migrations/20260828000000_dealer_invitation_token_hash`) was
deliberately **not applied** — it was written for owner approval. The schema
change merged; the migration did not run.

Production (`aieybibvewmvrubcpthm`) therefore looks like this:

```
token_hash   absent
consumed_at  absent
token        TEXT NOT NULL
rows         11  (1 PENDING/expired, 4 ACCEPTED, 6 EXPIRED — no live links)
```

Prisma selects **every model scalar by default**, so an unqualified query on
`DealerInvitation` asks for `token_hash` and fails with P2022; and an insert that
omits `token` violates a `NOT NULL` constraint. Verified against a byte-faithful
local replica of the production table — 6 of the 7 invite-path queries the
merged code issues fail:

| Path | merged `main` |
| --- | --- |
| `POST /api/admin/dealers/invite` (create with `tokenHash`, no `token`) | ✗ `token_hash` does not exist |
| `GET`/`POST /api/dealer/invite/claim` (findUnique by `tokenHash`) | ✗ `token_hash` does not exist |
| claim plaintext fallback (findUnique by `token`, default select) | ✗ `token_hash` does not exist |
| `GET /api/admin/dealers/invitations` (findMany, default select) | ✗ `token_hash` does not exist |
| invitation cancel / resend (findUnique by id, default select) | ✗ `token_hash` does not exist |
| claim consume (`updateMany where consumedAt: null`) | ✗ `consumed_at` does not exist |
| `expireStaleInvitations` (status + `expiresAt` only) | ✓ |

## The fix

Every invitation query now **names its columns explicitly** and is shaped by a
cached runtime probe of the live table
(`lib/services/dealer-recruitment/invitation-schema-compat.ts`). All token reads
and writes go through `invitation-token.service.ts`, so exactly one module knows
which columns exist.

* **Legacy schema** (production today): the raw token is written to `token`,
  looked up by `token`, and single use is enforced by the `status = PENDING`
  update guard. This is the pre-existing behaviour, restored.
* **Migrated schema**: only `tokenHash` is written, `token` is nulled on resend,
  and `consumedAt` is stamped alongside the status flip.
* The probe resolves the table via `to_regclass`, so it reads the same physical
  table Prisma's own queries hit even under a `?schema=` override.
* A failed probe **fails safe to legacy**, because legacy queries are valid
  against both schemas while modern queries against the legacy schema are a hard
  failure. A failed probe does not poison the cache.

No redeploy is needed when the migration is applied: the next process to start
probes the new columns and switches itself to the hashed path.

## Security position during the window

On the legacy schema there is nowhere to put a hash, so invitation tokens remain
**plaintext at rest** — exactly as they were before PR #348. This is not a new
regression; the migration is the remedy. Storing the raw value is also what the
migration's backfill expects (`digest(token) == token_hash`), so no row written
during the window becomes unresolvable afterwards. A token minted on the legacy
schema is proven to still redeem after the migration
(`tests/integration/dealer-invitation-schema.itest.ts`).

## Applying the migration

The migration is additive and reversible; it keeps `token` so links already in
inboxes keep resolving. Its own header carries the verification queries, the
rollback, the deferred column drop, and a separate data-hygiene item (3 ACCEPTED
rows referencing dealer ids that no longer exist). Run its three verification
queries after applying — all must return 0.

## Removing the shim

Once every environment carries the migration:

1. Delete `invitation-schema-compat.ts` and its test.
2. In `invitation-token.service.ts`, drop the `caps` parameter and the legacy
   branch of each builder; keep the hashed path.
3. Drop the plaintext `token` column (the follow-up migration sketched at the end
   of `20260828000000`), and remove `token` from the Prisma model.

## Verifying either generation

`tests/integration/dealer-invitation-schema.itest.ts` creates its own table and
runs the real service functions, so it can be pointed at a legacy-shaped
database, a migrated one, or one in between. Its header has the exact commands.
It refuses to run unless `DATABASE_URL` names an `autolenis_e2e*` database.
