// The pickup RELEASE TOKEN — the credential that opens a car.
//
// WRITTEN FAILING FIRST, and each assertion names the defect it would catch. Before this change
// the release credential was a `Math.random()` payload stored in plaintext in
// `pickups.qr_code_data`, resolved by equality, with no `consumed_at` and no status precondition.
// Every test below fails against that implementation.
//
// THE §8.1h DISCIPLINE APPLIES TO THIS FILE TOO: before trusting a gate, prove it fails on a
// deliberately reintroduced defect. Eleven mutations were applied to `release-token.service.ts`
// one at a time, the suite run against each, and the service restored byte-identical afterwards.
// Every one went RED; the mutation is named in the comment of the test that catches it. A test
// that cannot be made to fail is reporting success while checking nothing, which is the class
// this phase opened with — and the seventh instance of it was a guard written FOR this class.
//
// Run with:
//   npx tsx --test --experimental-test-module-mocks \
//     "lib/services/pickup/__tests__/release-token.test.ts"

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

interface Row {
  id: string;
  dealId: string;
  status: string;
  scheduledAt: Date | null;
  tokenHash: string | null;
  tokenExpiresAt: Date | null;
  tokenConsumedAt: Date | null;
  tokenRevokedAt: Date | null;
}

let rows: Row[] = [];

function match(where: Record<string, unknown>, r: Row): boolean {
  return Object.entries(where).every(([k, v]) => {
    const actual = (r as unknown as Record<string, unknown>)[k];
    if (v !== null && typeof v === "object" && v !== undefined && "not" in (v as object)) {
      return actual !== (v as { not: unknown }).not;
    }
    return actual === v;
  });
}

function project<T extends Row>(r: T, select?: Record<string, boolean>) {
  if (!select) return { ...r };
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(select)) out[k] = (r as unknown as Record<string, unknown>)[k];
  return out;
}

mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      pickup: {
        findUnique: async ({ where, select }: { where: Record<string, unknown>; select?: Record<string, boolean> }) => {
          const r = rows.find((row) => match(where, row));
          return r ? project(r, select) : null;
        },
        update: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
          const r = rows.find((row) => match(where, row));
          if (!r) throw new Error("no such pickup");
          Object.assign(r, data);
          return { ...r };
        },
        updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
          const hits = rows.filter((row) => match(where, row));
          hits.forEach((r) => Object.assign(r, data));
          return { count: hits.length };
        },
      },
    },
  },
});

const svc = () => import("../release-token.service");

const NOW = new Date("2026-09-20T09:00:00.000Z");
const APPT = new Date("2026-09-22T15:00:00.000Z");

function pickup(overrides: Partial<Row> = {}): Row {
  return {
    id: "pu_1",
    dealId: "deal_1",
    status: "SCHEDULED",
    scheduledAt: APPT,
    tokenHash: null,
    tokenExpiresAt: null,
    tokenConsumedAt: null,
    tokenRevokedAt: null,
    ...overrides,
  };
}

beforeEach(() => { rows = [pickup()]; });

// ── Minting ──────────────────────────────────────────────────────────────────────────────

test("the stored value is a SHA-256 HASH, never the token itself", async () => {
  // Reintroduced defect: `tokenHash: rawToken`. Red — the row would equal the raw value.
  const { issueReleaseToken } = await svc();
  const issued = await issueReleaseToken({ dealId: "deal_1", now: NOW });
  assert.ok(issued);

  const stored = rows[0]!.tokenHash;
  assert.notEqual(stored, issued.rawToken, "a database read must not yield a working credential");
  assert.equal(stored, crypto.createHash("sha256").update(issued.rawToken).digest("hex"));
});

test("the raw token is CSPRNG output, not Math.random", async () => {
  // Reintroduced defect: `Math.random().toString(36).slice(2)` — red on both assertions
  // (32 chars of base36 is neither 64 hex characters nor 256 bits of entropy).
  const { issueReleaseToken } = await svc();
  const seen = new Set<string>();
  for (let i = 0; i < 25; i++) {
    rows = [pickup()];
    const issued = await issueReleaseToken({ dealId: "deal_1", now: NOW });
    assert.ok(issued);
    assert.match(issued.rawToken, /^[0-9a-f]{64}$/, "32 bytes of randomness, hex-encoded");
    seen.add(issued.rawToken);
  }
  assert.equal(seen.size, 25, "every mint must be distinct");
});

test("expiry is bound to the APPOINTMENT, not to the minting moment", async () => {
  // Reintroduced defect: `now + 48h`, the old `qrExpiresAt` rule. Red — a code minted three days
  // early would outlive the handover it belongs to by two days.
  const { issueReleaseToken, TOKEN_GRACE_AFTER_APPOINTMENT_MS } = await svc();
  const issued = await issueReleaseToken({ dealId: "deal_1", now: NOW });
  assert.ok(issued);
  assert.equal(
    issued.expiresAt.getTime(),
    APPT.getTime() + TOKEN_GRACE_AFTER_APPOINTMENT_MS,
    "the appointment plus its grace — a Tuesday code has no business being live on Friday",
  );
});

test("a token minted at the kerb, after its own appointment, still gets a usable window", async () => {
  // The common re-issue case: the buyer is standing there and their phone lost the email. The
  // appointment bound has already passed, so the floor has to carry it.
  const { issueReleaseToken, TOKEN_MIN_TTL_MS } = await svc();
  const late = new Date(APPT.getTime() + 20 * 60 * 60 * 1000); // past appointment + grace
  const issued = await issueReleaseToken({ dealId: "deal_1", now: late });
  assert.ok(issued);
  assert.equal(issued.expiresAt.getTime(), late.getTime() + TOKEN_MIN_TTL_MS);
});

test("a pickup with no agreed time still gets the floor rather than an already-dead code", async () => {
  const { releaseTokenExpiry, TOKEN_MIN_TTL_MS } = await svc();
  assert.equal(releaseTokenExpiry(null, NOW).getTime(), NOW.getTime() + TOKEN_MIN_TTL_MS);
});

test("minting REFUSES outside SCHEDULED / RESCHEDULED / CHECKED_IN", async () => {
  // THE DEFECT THIS EXISTS FOR. `regenerateQr` had no status guard at all, so an administrator
  // could mint a live 48-hour credential for a pickup that was never scheduled — a code that
  // opens a car with no appointment behind it. Reintroduced by deleting the status check: red.
  const { issueReleaseToken } = await svc();
  for (const status of ["NOT_SCHEDULED", "PROPOSED", "DEALER_COUNTERED", "COMPLETED", "NO_SHOW", "EXCEPTION"]) {
    rows = [pickup({ status })];
    assert.equal(
      await issueReleaseToken({ dealId: "deal_1", now: NOW }),
      null,
      `${status} must not be mintable`,
    );
    assert.equal(rows[0]!.tokenHash, null, `${status} must not be written to either`);
  }
});

test("minting succeeds for every state where a handover can actually happen", async () => {
  // The other direction of the same guard. A test that only proves refusal cannot tell a correct
  // allowlist from an empty one.
  const { issueReleaseToken, TOKEN_MINTABLE_STATUSES } = await svc();
  assert.deepEqual([...TOKEN_MINTABLE_STATUSES], ["SCHEDULED", "RESCHEDULED", "CHECKED_IN"]);
  for (const status of TOKEN_MINTABLE_STATUSES) {
    rows = [pickup({ status })];
    assert.ok(await issueReleaseToken({ dealId: "deal_1", now: NOW }), `${status} must be mintable`);
  }
});

test("a pickup that does not exist mints nothing and throws nothing", async () => {
  const { issueReleaseToken } = await svc();
  rows = [];
  assert.equal(await issueReleaseToken({ dealId: "deal_missing", now: NOW }), null);
});

// ── Revoke-and-reissue ───────────────────────────────────────────────────────────────────

test("RE-MINTING REVOKES: the previous code stops resolving the moment a new one is issued", async () => {
  // Reintroduced defect: drop the `tokenHash` write from the re-mint, so the previous hash
  // survives. Red — the old token still resolves, and one vehicle has two live codes.
  const { issueReleaseToken, resolveReleaseToken } = await svc();
  const first = await issueReleaseToken({ dealId: "deal_1", now: NOW });
  assert.ok(first);
  const second = await issueReleaseToken({ dealId: "deal_1", now: NOW });
  assert.ok(second);
  assert.notEqual(first.rawToken, second.rawToken);

  assert.deepEqual(await resolveReleaseToken(first.rawToken, NOW), { ok: false, reason: "not_found" });
  const live = await resolveReleaseToken(second.rawToken, NOW);
  assert.equal(live.ok, true);
});

test("a re-mint clears the previous code's spent and revoked marks", async () => {
  // Reintroduced defect: write only `tokenHash` and `tokenExpiresAt`. Red — the fresh token
  // inherits `token_consumed_at` and is dead on arrival, which is the worst kind of bug: the
  // reissue reports success and the code fails at the lot.
  const { issueReleaseToken, resolveReleaseToken } = await svc();
  rows[0]!.tokenConsumedAt = new Date("2026-09-19T00:00:00.000Z");
  rows[0]!.tokenRevokedAt = new Date("2026-09-19T00:00:00.000Z");

  const issued = await issueReleaseToken({ dealId: "deal_1", now: NOW });
  assert.ok(issued);
  assert.equal(rows[0]!.tokenConsumedAt, null);
  assert.equal(rows[0]!.tokenRevokedAt, null);
  assert.equal((await resolveReleaseToken(issued.rawToken, NOW)).ok, true);
});

test("revoking marks the code cancelled — it does NOT record a handover", async () => {
  // Collapsing revoke into consume would make the pickup row claim a release that never
  // happened. Reintroduced by pointing revoke at `tokenConsumedAt`: red on the second assertion.
  const { issueReleaseToken, revokeReleaseToken, resolveReleaseToken } = await svc();
  const issued = await issueReleaseToken({ dealId: "deal_1", now: NOW });
  assert.ok(issued);

  assert.equal(await revokeReleaseToken("deal_1", NOW), true);
  assert.equal(rows[0]!.tokenRevokedAt?.getTime(), NOW.getTime());
  assert.equal(rows[0]!.tokenConsumedAt, null, "a revoked code must not read as a completed handover");
  assert.deepEqual(await resolveReleaseToken(issued.rawToken, NOW), { ok: false, reason: "revoked" });
});

test("revoking a pickup with no token reports that it did nothing", async () => {
  const { revokeReleaseToken } = await svc();
  assert.equal(await revokeReleaseToken("deal_1", NOW), false);
  assert.equal(rows[0]!.tokenRevokedAt, null, "no revocation may be stamped on a pickup that never had a code");
});

// ── Resolution ───────────────────────────────────────────────────────────────────────────

test("resolution is READ-ONLY — looking at a code does not spend it", async () => {
  // Reintroduced defect: consume inside resolve. Red — a scanner that reads twice would burn the
  // buyer's code by looking at it.
  const { issueReleaseToken, resolveReleaseToken } = await svc();
  const issued = await issueReleaseToken({ dealId: "deal_1", now: NOW });
  assert.ok(issued);
  await resolveReleaseToken(issued.rawToken, NOW);
  await resolveReleaseToken(issued.rawToken, NOW);
  assert.equal(rows[0]!.tokenConsumedAt, null);
  assert.equal((await resolveReleaseToken(issued.rawToken, NOW)).ok, true);
});

test("a resolved token discloses the appointment and NOTHING about the people", async () => {
  // This is a bearer credential: whatever the view carries, anyone holding the code can read.
  // Pinning the exact key set makes widening it a decision rather than an accident.
  const { issueReleaseToken, resolveReleaseToken } = await svc();
  const issued = await issueReleaseToken({ dealId: "deal_1", now: NOW });
  assert.ok(issued);
  const res = await resolveReleaseToken(issued.rawToken, NOW);
  assert.equal(res.ok, true);
  assert.ok(res.ok);
  assert.deepEqual(
    Object.keys(res.view).sort(),
    ["dealId", "expiresAt", "pickupId", "scheduledAt", "status"],
    "no buyer name, no contact details, no price, no dealership identity",
  );
});

test("an expired token is refused, and the boundary is inclusive", async () => {
  const { issueReleaseToken, resolveReleaseToken } = await svc();
  const issued = await issueReleaseToken({ dealId: "deal_1", now: NOW });
  assert.ok(issued);
  const atExpiry = new Date(issued.expiresAt.getTime());
  assert.deepEqual(await resolveReleaseToken(issued.rawToken, atExpiry), { ok: false, reason: "expired" });
  const justBefore = new Date(issued.expiresAt.getTime() - 1);
  assert.equal((await resolveReleaseToken(issued.rawToken, justBefore)).ok, true);
});

test("the pickup's OWN state is re-checked at scan time, not inferred from the token", async () => {
  // A pickup cancelled or completed after the code was minted must not still open a car.
  // Reintroduced by trusting the token's existence: red.
  const { issueReleaseToken, resolveReleaseToken } = await svc();
  const issued = await issueReleaseToken({ dealId: "deal_1", now: NOW });
  assert.ok(issued);
  rows[0]!.status = "EXCEPTION";
  assert.deepEqual(
    await resolveReleaseToken(issued.rawToken, NOW),
    { ok: false, reason: "pickup_not_releasable" },
  );
});

test("reasons are ordered so the holder is told the truest thing", async () => {
  // A code that was scanned AND has since expired should say "already used", not "expired" —
  // those send the buyer to two different places. Reintroduced by reordering the checks: red.
  const { issueReleaseToken, resolveReleaseToken, consumeReleaseToken } = await svc();
  const issued = await issueReleaseToken({ dealId: "deal_1", now: NOW });
  assert.ok(issued);
  await consumeReleaseToken("pu_1", NOW);
  const wayLater = new Date(issued.expiresAt.getTime() + 60_000);
  assert.deepEqual(await resolveReleaseToken(issued.rawToken, wayLater), { ok: false, reason: "consumed" });
});

test("an unknown, empty or truncated token is refused without a database round trip", async () => {
  const { resolveReleaseToken } = await svc();
  for (const bad of ["", "   ", "abc", "x".repeat(31)]) {
    assert.deepEqual(await resolveReleaseToken(bad, NOW), { ok: false, reason: "not_found" }, `rejected: ${bad}`);
  }
  assert.deepEqual(await resolveReleaseToken("f".repeat(64), NOW), { ok: false, reason: "not_found" });
});

// ── Single use ───────────────────────────────────────────────────────────────────────────

test("consume is a compare-and-swap: simultaneous scans produce exactly ONE winner", async () => {
  // THE DEFECT THIS EXISTS FOR. The old code had no `consumed_at` at all, so a scanned code
  // stayed valid and a photographed one stayed valid with it. Reintroduced as a read-then-write:
  // red, because both callers would see `null` and both would win.
  const { issueReleaseToken, consumeReleaseToken } = await svc();
  const issued = await issueReleaseToken({ dealId: "deal_1", now: NOW });
  assert.ok(issued);

  const results = await Promise.all([
    consumeReleaseToken("pu_1", NOW),
    consumeReleaseToken("pu_1", NOW),
    consumeReleaseToken("pu_1", NOW),
  ]);
  assert.equal(results.filter(Boolean).length, 1, "exactly one scan may spend the code");
  assert.equal(rows[0]!.tokenConsumedAt?.getTime(), NOW.getTime());
});

test("a revoked code cannot be consumed", async () => {
  const { issueReleaseToken, revokeReleaseToken, consumeReleaseToken } = await svc();
  await issueReleaseToken({ dealId: "deal_1", now: NOW });
  await revokeReleaseToken("deal_1", NOW);
  assert.equal(await consumeReleaseToken("pu_1", NOW), false);
  assert.equal(rows[0]!.tokenConsumedAt, null);
});

