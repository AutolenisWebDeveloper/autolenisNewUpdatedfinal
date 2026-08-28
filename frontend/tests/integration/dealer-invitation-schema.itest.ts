// The invite path, exercised against a REAL Postgres in BOTH physical schema
// generations.
//
// WHY THIS EXISTS. Production's dealer_invitations has no token_hash and no
// consumed_at, and `token` is still NOT NULL — migration
// 20260828000000_dealer_invitation_token_hash has not been applied. Prisma
// selects every model scalar by default, so an unqualified query on the model
// fails there with P2022. Unit tests can prove the query SHAPE; only a real
// database can prove the query RUNS. This file runs the real service functions
// against a table it creates itself, so it can be pointed at a legacy-shaped
// database, a migrated one, or one in between.
//
// HOW TO RUN (throwaway Postgres, no production credentials):
//
//   createdb autolenis_e2e_invite_legacy
//   DATABASE_URL=postgresql://…/autolenis_e2e_invite_legacy \
//     npx tsx --test tests/integration/dealer-invitation-schema.itest.ts
//
//   # then apply the migration to a second database and run it again:
//   createdb autolenis_e2e_invite_modern
//   psql …/autolenis_e2e_invite_modern -f \
//     prisma/migrations/20260828000000_dealer_invitation_token_hash/migration.sql
//   DATABASE_URL=postgresql://…/autolenis_e2e_invite_modern \
//     npx tsx --test tests/integration/dealer-invitation-schema.itest.ts
//
// It never touches production (project aieybibvewmvrubcpthm): DATABASE_URL must
// name an autolenis_e2e* database or the suite refuses to run.

import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@/lib/prisma";
import {
  createInvitation,
  validateInvitationToken,
  consumeInvitationToken,
  refreshInvitationToken,
  expireStaleInvitations,
} from "@/lib/services/dealer-recruitment/invitation-token.service";
import {
  getInvitationSchemaCapabilities,
  __setInvitationSchemaCapabilities,
  type InvitationSchemaCapabilities,
} from "@/lib/services/dealer-recruitment/invitation-schema-compat";
import { hashToken } from "@/lib/services/dealer-recruitment/account-claim.service";

const url = process.env.DATABASE_URL ?? "";
if (!/autolenis_e2e/.test(url)) {
  throw new Error(
    `Refusing to run: DATABASE_URL must target a local autolenis_e2e* database (got ${url.slice(0, 40)}…)`,
  );
}

let caps: InvitationSchemaCapabilities;

before(async () => {
  // The LEGACY shape — exactly what production has today. A run against a
  // database that already carries the migration keeps its own columns.
  await prisma.$executeRawUnsafe(`
    DO $$ BEGIN
      CREATE TYPE "DealerInvitationStatus" AS ENUM ('PENDING','ACCEPTED','EXPIRED','CANCELLED');
    EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS public.dealer_invitations (
      id               TEXT PRIMARY KEY DEFAULT (gen_random_uuid())::text,
      dealership_name  TEXT NOT NULL,
      contact_name     TEXT NOT NULL,
      email            TEXT NOT NULL,
      personal_message TEXT,
      token            TEXT NOT NULL,
      expires_at       TIMESTAMP(3) NOT NULL,
      status           "DealerInvitationStatus" NOT NULL DEFAULT 'PENDING',
      invited_by       TEXT NOT NULL,
      accepted_at      TIMESTAMP(3),
      dealer_id        TEXT,
      created_at       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  await prisma.$executeRawUnsafe(
    `CREATE UNIQUE INDEX IF NOT EXISTS dealer_invitations_token_key ON public.dealer_invitations (token);`,
  );
  await prisma.$executeRawUnsafe(
    `CREATE UNIQUE INDEX IF NOT EXISTS dealer_invitations_dealer_id_key ON public.dealer_invitations (dealer_id);`,
  );
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS dealer_invitations_status_idx ON public.dealer_invitations (status);`,
  );

  // Probe only after the table exists.
  __setInvitationSchemaCapabilities(null);
  caps = await getInvitationSchemaCapabilities();
});

after(async () => {
  await prisma.dealerInvitation.deleteMany({ where: { email: { contains: "@invite.test" } } });
  await prisma.$disconnect();
});

let seq = 0;
function seedEmail(tag: string): string {
  seq += 1;
  return `${tag}-${Date.now()}-${seq}@invite.test`;
}

async function newInvitation(tag: string) {
  return createInvitation({
    dealershipName: `${tag} Motors`,
    contactName: "Pat",
    email: seedEmail(tag),
    invitedBy: "admin-itest",
  });
}

/** Read the token columns without asking for any that may not exist. */
async function tokenColumns(id: string) {
  const [row] = await prisma.$queryRawUnsafe<Array<{ token: string | null; token_hash: string | null }>>(
    `SELECT ${caps.hasToken ? '"token"' : "NULL AS token"},
            ${caps.hasTokenHash ? '"token_hash"' : "NULL AS token_hash"}
       FROM public.dealer_invitations WHERE id = $1`,
    id,
  );
  return row;
}

// ── The whole invite path, in whichever generation is connected ─────────────

test("an invitation can be created at all — the write satisfies the live constraints", async () => {
  const inv = await newInvitation("create");
  assert.ok(inv.id);
  const row = await tokenColumns(inv.id);
  if (caps.hasTokenHash) {
    assert.equal(row.token_hash, hashToken(inv.rawToken));
    if (!caps.tokenRequired) {
      assert.equal(row.token, null, "the raw token must not be persisted once a hash column exists");
    }
  } else {
    // Nowhere to put a hash: the raw token goes in `token`, which is exactly
    // what the migration's backfill (digest(token)) expects.
    assert.equal(row.token, inv.rawToken);
    assert.equal(row.token_hash, null);
  }
});

test("a freshly issued link validates", async () => {
  const inv = await newInvitation("validate");
  const v = await validateInvitationToken(inv.rawToken);
  assert.equal(v.ok, true);
  assert.equal(v.ok && v.invitationId, inv.id);
});

test("an unknown token is not_found, not a crash", async () => {
  const v = await validateInvitationToken("0".repeat(64));
  assert.deepEqual(v, { ok: false, reason: "not_found" });
});

test("exactly one of two concurrent claims wins", async () => {
  const inv = await newInvitation("race");
  const [a, b] = await Promise.all([
    consumeInvitationToken(inv.id, `dealer-${Date.now()}-a`),
    consumeInvitationToken(inv.id, `dealer-${Date.now()}-b`),
  ]);
  assert.equal([a, b].filter(Boolean).length, 1);
  const after = await validateInvitationToken(inv.rawToken);
  assert.deepEqual(after, { ok: false, reason: "consumed" });
});

test("an expired invitation is rejected and the sweep retires it", async () => {
  const inv = await newInvitation("expire");
  await prisma.dealerInvitation.updateMany({
    where: { id: inv.id }, data: { expiresAt: new Date(Date.now() - 60_000) },
  });
  assert.deepEqual(await validateInvitationToken(inv.rawToken), { ok: false, reason: "expired" });

  assert.ok((await expireStaleInvitations()) >= 1);
  const row = await prisma.dealerInvitation.findUniqueOrThrow({
    where: { id: inv.id }, select: { status: true },
  });
  assert.equal(row.status, "EXPIRED");
  // Still rejected once the status is EXPIRED rather than merely past its TTL.
  assert.deepEqual(await validateInvitationToken(inv.rawToken), { ok: false, reason: "expired" });
});

test("a resend rotates the token and kills the superseded link", async () => {
  const inv = await newInvitation("resend");
  const rotated = await refreshInvitationToken(inv.id);
  assert.ok(rotated);
  assert.notEqual(rotated.rawToken, inv.rawToken);
  assert.equal((await validateInvitationToken(inv.rawToken)).ok, false, "the old link must die");
  assert.equal((await validateInvitationToken(rotated.rawToken)).ok, true);
});

test("a resend cannot resurrect a consumed invitation", async () => {
  const inv = await newInvitation("resurrect");
  assert.equal(await consumeInvitationToken(inv.id, `dealer-${Date.now()}-r`), true);
  assert.equal(await refreshInvitationToken(inv.id), null);
});

test("a cancelled invitation is reported as cancelled, and cannot be consumed", async () => {
  const inv = await newInvitation("cancel");
  await prisma.dealerInvitation.updateMany({
    where: { id: inv.id, status: { in: ["PENDING", "EXPIRED"] } },
    data: { status: "CANCELLED" },
  });
  assert.deepEqual(await validateInvitationToken(inv.rawToken), { ok: false, reason: "cancelled" });
  assert.equal(await consumeInvitationToken(inv.id, `dealer-${Date.now()}-c`), false);
});

test("the admin listing select runs — it is the query that fails with P2022 unqualified", async () => {
  await newInvitation("listing");
  const rows = await prisma.dealerInvitation.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
    select: {
      id: true, dealershipName: true, contactName: true, email: true,
      status: true, expiresAt: true, acceptedAt: true, createdAt: true,
    },
  });
  assert.ok(rows.length >= 1);
});

// ── The upgrade path ────────────────────────────────────────────────────────

test("a link minted on the LEGACY schema still redeems after the migration", async (t) => {
  if (!caps.hasTokenHash) {
    t.skip("connected database is pre-migration; run this file again against a migrated one");
    return;
  }
  // Reproduce a row written before the migration, then the migration's own
  // backfill (token_hash = encode(digest(token,'sha256'),'hex')).
  const rawToken = `legacy-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  await prisma.$executeRawUnsafe(
    `INSERT INTO public.dealer_invitations
       (id, dealership_name, contact_name, email, token, expires_at, status, invited_by)
     VALUES (gen_random_uuid()::text, 'Legacy Motors', 'Pat', $1, $2, now() + interval '7 days', 'PENDING', 'admin-itest')`,
    seedEmail("legacy"),
    rawToken,
  );
  await prisma.$executeRawUnsafe(`
    UPDATE public.dealer_invitations
       SET token_hash = encode(digest(token, 'sha256'), 'hex')
     WHERE token IS NOT NULL AND token_hash IS NULL
  `);

  const v = await validateInvitationToken(rawToken);
  assert.equal(v.ok, true, "a link emailed before the migration must still work after it");
});

test("consuming inside a transaction works, and a lost race rolls the whole claim back", async () => {
  const inv = await newInvitation("txn");
  const dealerId = `dealer-${Date.now()}-t`;

  // The shape POST /api/dealer/invite/claim uses: consume through the SAME
  // transaction that would create the User and Dealer.
  const won = await prisma.$transaction(async (tx) => {
    return consumeInvitationToken(inv.id, dealerId, new Date(), tx);
  });
  assert.equal(won, true);

  // A second claim of the same link must lose, and its transaction must abort —
  // which is what stops a duplicate dealer from being created.
  await assert.rejects(
    prisma.$transaction(async (tx) => {
      const ok = await consumeInvitationToken(inv.id, `${dealerId}-2`, new Date(), tx);
      if (!ok) throw new Error("INVITATION_ALREADY_CONSUMED");
    }),
    /INVITATION_ALREADY_CONSUMED/,
  );

  const row = await prisma.dealerInvitation.findUniqueOrThrow({
    where: { id: inv.id }, select: { status: true, dealerId: true },
  });
  assert.equal(row.status, "ACCEPTED");
  assert.equal(row.dealerId, dealerId, "the winner's dealer id must survive the loser's rollback");
});
