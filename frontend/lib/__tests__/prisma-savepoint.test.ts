// The savepoint guard for P2002 recovery inside a transaction.
//
// WHAT THIS PINS, and why it is not a style rule. Measured against PostgreSQL 16
// with this repository's schema:
//
//   $transaction(async (tx) => {
//     try { await tx.user.create({ data: { email: taken, ... } }) }   // 23505
//     catch (P2002) { await tx.user.findUnique({ where: { email } }) } // 25P02
//   })
//
// the re-read throws AND the outer `$transaction` RESOLVES. Prisma reports
// success, PostgreSQL turns the COMMIT into a ROLLBACK, and the caller returns
// ids for rows that were never written. Every race-recovery path this phase added
// has that exact shape, and the in-memory fakes the unit tests use model neither
// the abort nor the rollback — so nothing here could have caught it.
//
// Run: pnpm test:operations

import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { withSavepoint, isTransactionClient } from "../prisma-savepoint";

let sql: string[] = [];
beforeEach(() => { sql = []; });

/** A transaction client: PrismaClient minus `$transaction` and `$connect`. */
const txHandle = {
  $executeRawUnsafe: async (s: string) => { sql.push(s); return 0; },
};

/** The top-level client: has `$transaction`. */
const topLevel = {
  $transaction: async () => undefined,
  $executeRawUnsafe: async (s: string) => { sql.push(s); return 0; },
};

test("a transaction client is discriminated by the ABSENCE of $transaction", () => {
  assert.equal(isTransactionClient(txHandle), true);
  assert.equal(isTransactionClient(topLevel), false);
});

test("on the top-level client it is a pass-through — SAVEPOINT outside a transaction is an error", async () => {
  const out = await withSavepoint(topLevel, async () => "ok");
  assert.equal(out, "ok");
  assert.deepEqual(sql, [], "no savepoint SQL may be issued outside a transaction");
});

test("inside a transaction it brackets the call and releases on success", async () => {
  const out = await withSavepoint(txHandle, async () => "ok");
  assert.equal(out, "ok");
  assert.equal(sql.length, 2);
  assert.match(sql[0]!, /^SAVEPOINT al_sp_\d+$/);
  assert.match(sql[1]!, /^RELEASE SAVEPOINT al_sp_\d+$/);
  assert.equal(sql[0]!.split(" ").pop(), sql[1]!.split(" ").pop(), "release the savepoint it opened");
});

test("on a throw it rolls back to the savepoint and RE-THROWS the original error", async () => {
  const boom = Object.assign(new Error("unique"), { code: "P2002" });
  await assert.rejects(
    () => withSavepoint(txHandle, async () => { throw boom; }),
    (err: unknown) => {
      // The caller's own `catch (P2002)` must still see exactly its error. The
      // only difference is that the transaction it then queries is not aborted.
      assert.equal(err, boom);
      return true;
    },
  );
  assert.equal(sql.length, 2);
  assert.match(sql[0]!, /^SAVEPOINT /);
  assert.match(sql[1]!, /^ROLLBACK TO SAVEPOINT /);
});

test("nested uses get distinct savepoint names", async () => {
  await withSavepoint(txHandle, async () => {
    await withSavepoint(txHandle, async () => "inner");
    return "outer";
  });
  const names = sql.map((s) => s.split(" ").pop());
  assert.equal(new Set(names).size, 2, "an inner savepoint must not release the outer one");
});

test("a handle that cannot run raw SQL falls through rather than inventing an error", async () => {
  // A narrowed handle (`Pick<PrismaClient, "queueItem">`) or a test fake. A
  // savepoint is impossible there, and replacing the caller's real P2002 with
  // "$executeRawUnsafe is not a function" would hide the defect being reported.
  const narrowed = { queueItem: {} };
  const out = await withSavepoint(narrowed, async () => "ok");
  assert.equal(out, "ok");
  assert.deepEqual(sql, []);
});
