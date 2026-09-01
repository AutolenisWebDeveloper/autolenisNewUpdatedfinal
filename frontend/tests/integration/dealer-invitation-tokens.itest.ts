// Dealer invitation tokens — integration tests against a REAL Postgres.
//
// These assert DATABASE STATE through the real service functions and the real
// Prisma client, not HTTP status or visible text. They cover the write guards
// that the unit tests can only pin as predicates: that exactly one of two
// concurrent claims wins, that a resend genuinely invalidates the link it
// replaces, and that neither a resend nor a cancel can undo a claim that landed
// between an admin's read and their write.
//
// The schema is single-generation: migration
// 20260828000000_dealer_invitation_token_hash is applied everywhere, so
// token_hash and consumed_at exist and `token` is nullable. The table is created
// in that shape below.
//
// HOW TO RUN (throwaway Postgres, never production credentials):
//   createdb autolenis_e2e_invitations
//   DATABASE_URL=postgresql://…/autolenis_e2e_invitations \
//     npx tsx --test tests/integration/dealer-invitation-tokens.itest.ts
//
// It refuses to run unless DATABASE_URL names an autolenis_e2e* database, so it
// can never touch production (project aieybibvewmvrubcpthm).

import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@/lib/prisma";
import {
  issueInvitationToken,
  validateInvitationToken,
  consumeInvitationToken,
  refreshInvitationToken,
  cancelInvitation,
  expireStaleInvitations,
} from "@/lib/services/dealer-recruitment/invitation-token.service";
import { hashToken } from "@/lib/services/dealer-recruitment/account-claim.service";

const url = process.env.DATABASE_URL ?? "";
if (!/autolenis_e2e/.test(url)) {
  throw new Error(
    `Refusing to run: DATABASE_URL must target a local autolenis_e2e* database (got ${url.slice(0, 40)}…)`,
  );
}

before(async () => {
  await prisma.$executeRawUnsafe(`
    DO $$ BEGIN
      CREATE TYPE "DealerInvitationStatus" AS ENUM ('PENDING','ACCEPTED','EXPIRED','CANCELLED');
    EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  `);
  // The post-migration shape: token nullable, token_hash + consumed_at present.
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS public.dealer_invitations (
      id               TEXT PRIMARY KEY DEFAULT (gen_random_uuid())::text,
      dealership_name  TEXT NOT NULL,
      contact_name     TEXT NOT NULL,
      email            TEXT NOT NULL,
      personal_message TEXT,
      token            TEXT,
      token_hash       TEXT,
      consumed_at      TIMESTAMP(3),
      expires_at       TIMESTAMP(3) NOT NULL,
      status           "DealerInvitationStatus" NOT NULL DEFAULT 'PENDING',
      invited_by       TEXT NOT NULL,
      accepted_at      TIMESTAMP(3),
      dealer_id        TEXT,
      created_at       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  for (const ddl of [
    `CREATE UNIQUE INDEX IF NOT EXISTS dealer_invitations_token_key ON public.dealer_invitations (token);`,
    `CREATE UNIQUE INDEX IF NOT EXISTS dealer_invitations_token_hash_key ON public.dealer_invitations (token_hash);`,
    `CREATE UNIQUE INDEX IF NOT EXISTS dealer_invitations_dealer_id_key ON public.dealer_invitations (dealer_id);`,
    `CREATE INDEX IF NOT EXISTS dealer_invitations_status_idx ON public.dealer_invitations (status);`,
  ]) {
    await prisma.$executeRawUnsafe(ddl);
  }
});

after(async () => {
  await prisma.dealerInvitation.deleteMany({ where: { email: { contains: "@invite.test" } } });
  await prisma.$disconnect();
});

let seq = 0;
/** Mint an invitation exactly as POST /api/admin/dealers/invite does. */
async function newInvitation(tag: string) {
  seq += 1;
  const issued = issueInvitationToken();
  const row = await prisma.dealerInvitation.create({
    data: {
      dealershipName: `${tag} Motors`,
      contactName: "Pat",
      email: `${tag}-${Date.now()}-${seq}@invite.test`,
      tokenHash: issued.tokenHash,
      expiresAt: issued.expiresAt,
      invitedBy: "admin-itest",
      status: "PENDING",
    },
    select: { id: true },
  });
  return { id: row.id, rawToken: issued.rawToken };
}

function dealerId(tag: string): string {
  seq += 1;
  return `dealer-${Date.now()}-${seq}-${tag}`;
}

// ── minting and validation ──────────────────────────────────────────────────

test("an invitation persists only the hash — the raw token is never stored", async () => {
  const inv = await newInvitation("mint");
  const row = await prisma.dealerInvitation.findUniqueOrThrow({ where: { id: inv.id } });
  assert.equal(row.tokenHash, hashToken(inv.rawToken));
  assert.notEqual(row.tokenHash, inv.rawToken);
  assert.equal(row.token, null);
});

test("a freshly issued link validates", async () => {
  const inv = await newInvitation("validate");
  const v = await validateInvitationToken(inv.rawToken);
  assert.equal(v.ok, true);
  assert.equal(v.ok && v.invitationId, inv.id);
});

test("an unknown token is not_found, not a crash", async () => {
  assert.deepEqual(await validateInvitationToken("0".repeat(64)), { ok: false, reason: "not_found" });
});

// ── consume: the status guard ───────────────────────────────────────────────

test("exactly one of two concurrent claims wins", async () => {
  const inv = await newInvitation("race");
  const [a, b] = await Promise.all([
    consumeInvitationToken(inv.id, dealerId("a")),
    consumeInvitationToken(inv.id, dealerId("b")),
  ]);
  assert.equal([a, b].filter(Boolean).length, 1, "exactly one claim may win");

  const row = await prisma.dealerInvitation.findUniqueOrThrow({ where: { id: inv.id } });
  assert.equal(row.status, "ACCEPTED");
  assert.ok(row.consumedAt, "consumedAt must be stamped");
  assert.deepEqual(await validateInvitationToken(inv.rawToken), { ok: false, reason: "consumed" });
});

test("consume refuses a row the sweep retired between validation and consumption", async () => {
  // The case a consumedAt-only guard would let through: the row is still
  // unconsumed, but it is no longer PENDING, so it must not be claimable.
  const inv = await newInvitation("swept");
  assert.equal((await validateInvitationToken(inv.rawToken)).ok, true, "claimable at first");

  await prisma.dealerInvitation.updateMany({
    where: { id: inv.id }, data: { expiresAt: new Date(Date.now() - 60_000) },
  });
  assert.ok((await expireStaleInvitations()) >= 1);

  const row = await prisma.dealerInvitation.findUniqueOrThrow({ where: { id: inv.id } });
  assert.equal(row.status, "EXPIRED");
  assert.equal(row.consumedAt, null, "the sweep does not consume — only the guard stops this");

  assert.equal(await consumeInvitationToken(inv.id, dealerId("swept")), false);
  assert.deepEqual(await validateInvitationToken(inv.rawToken), { ok: false, reason: "expired" });
});

test("an expired invitation is rejected before the sweep has even run", async () => {
  const inv = await newInvitation("expired");
  await prisma.dealerInvitation.updateMany({
    where: { id: inv.id }, data: { expiresAt: new Date(Date.now() - 1000) },
  });
  assert.deepEqual(await validateInvitationToken(inv.rawToken), { ok: false, reason: "expired" });
});

test("consuming inside a transaction works, and a lost race rolls the whole claim back", async () => {
  const inv = await newInvitation("txn");
  const winner = dealerId("winner");

  // The shape POST /api/dealer/invite/claim uses: consume through the SAME
  // transaction that would create the User and Dealer.
  const won = await prisma.$transaction((tx) =>
    consumeInvitationToken(inv.id, winner, new Date(), tx),
  );
  assert.equal(won, true);

  await assert.rejects(
    prisma.$transaction(async (tx) => {
      const ok = await consumeInvitationToken(inv.id, dealerId("loser"), new Date(), tx);
      if (!ok) throw new Error("INVITATION_ALREADY_CONSUMED");
    }),
    /INVITATION_ALREADY_CONSUMED/,
  );

  const row = await prisma.dealerInvitation.findUniqueOrThrow({ where: { id: inv.id } });
  assert.equal(row.status, "ACCEPTED");
  assert.equal(row.dealerId, winner, "the winner's dealer id must survive the loser's rollback");
});

// ── resend: one token scheme, and rotation kills the old link ───────────────

test("a resend rotates the token — the superseded link stops resolving", async () => {
  const inv = await newInvitation("resend");
  const rotated = await refreshInvitationToken(inv.id);
  assert.ok(rotated);
  assert.notEqual(rotated.rawToken, inv.rawToken);

  assert.equal((await validateInvitationToken(inv.rawToken)).ok, false, "the old link must die");
  assert.equal((await validateInvitationToken(rotated.rawToken)).ok, true);

  const row = await prisma.dealerInvitation.findUniqueOrThrow({ where: { id: inv.id } });
  assert.equal(row.tokenHash, hashToken(rotated.rawToken));
  assert.equal(row.token, null, "rotation must leave no plaintext behind");
});

test("a resend revives an EXPIRED invitation with a fresh 7-day window", async () => {
  const inv = await newInvitation("revive");
  await prisma.dealerInvitation.updateMany({
    where: { id: inv.id }, data: { status: "EXPIRED", expiresAt: new Date(Date.now() - 60_000) },
  });

  const rotated = await refreshInvitationToken(inv.id);
  assert.ok(rotated);
  assert.equal((await validateInvitationToken(rotated.rawToken)).ok, true);
  assert.ok(rotated.expiresAt.getTime() > Date.now() + 6 * 24 * 3600_000);
});

test("a resend cannot resurrect a consumed invitation", async () => {
  const inv = await newInvitation("resurrect");
  assert.equal(await consumeInvitationToken(inv.id, dealerId("r")), true);
  assert.equal(await refreshInvitationToken(inv.id), null);

  const row = await prisma.dealerInvitation.findUniqueOrThrow({ where: { id: inv.id } });
  assert.equal(row.status, "ACCEPTED", "status must be untouched");
});

test("a resend cannot resurrect a cancelled invitation", async () => {
  const inv = await newInvitation("resend-cancelled");
  assert.equal(await cancelInvitation(inv.id), true);
  assert.equal(await refreshInvitationToken(inv.id), null);
});

// ── cancel: the TOCTOU guard ────────────────────────────────────────────────

test("a cancelled invitation is reported as cancelled and cannot be consumed", async () => {
  const inv = await newInvitation("cancel");
  assert.equal(await cancelInvitation(inv.id), true);
  assert.deepEqual(await validateInvitationToken(inv.rawToken), { ok: false, reason: "cancelled" });
  assert.equal(await consumeInvitationToken(inv.id, dealerId("c")), false);
});

test("cancel cannot undo a claim that landed between the admin's read and write", async () => {
  // The TOCTOU: the route read PENDING, the dealer claimed, then the route wrote.
  const inv = await newInvitation("toctou");
  const claimer = dealerId("claimer");
  assert.equal(await consumeInvitationToken(inv.id, claimer), true);

  assert.equal(await cancelInvitation(inv.id), false, "an accepted invitation is not cancellable");
  const row = await prisma.dealerInvitation.findUniqueOrThrow({ where: { id: inv.id } });
  assert.equal(row.status, "ACCEPTED", "the dealer's claim must survive");
  assert.equal(row.dealerId, claimer);
});

test("cancelling twice is reported honestly the second time", async () => {
  const inv = await newInvitation("double-cancel");
  assert.equal(await cancelInvitation(inv.id), true);
  assert.equal(await cancelInvitation(inv.id), false);
});
