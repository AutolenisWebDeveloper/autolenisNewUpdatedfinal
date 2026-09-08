// lib/prisma-savepoint.ts — recovering from a unique-constraint conflict INSIDE
// a transaction.
//
// It sits beside `lib/prisma.ts`, the client it wraps, rather than opening a
// `lib/db/` namespace: §35 scopes each phase to the directories it declares, and
// this phase's own scope guard refused the new directory. The guard was right —
// one helper is not a new layer.
//
// THE DEFECT THIS EXISTS FOR, measured rather than reasoned. PostgreSQL aborts
// the whole transaction on a constraint violation, and Prisma's interactive
// transactions issue no savepoints of their own. So the create-then-catch-P2002
// idiom this codebase uses for race recovery — correct on the top-level client,
// where each statement is its own transaction — is silently broken when the same
// helper is handed a transaction client:
//
//   $transaction(async (tx) => {
//     try { await tx.user.create(...) }                 // 23505
//     catch (P2002) { await tx.user.findUnique(...) }   // 25P02: aborted
//   })
//
// Probed against PostgreSQL 16 with this repository's schema: the re-read throws,
// and — the part that makes it a data-loss bug rather than an error — the outer
// `$transaction` call RESOLVES. Prisma reports success, Postgres turns the COMMIT
// into a ROLLBACK, and the caller returns ids for rows that were never written.
//
// A savepoint scopes the abort. `ROLLBACK TO SAVEPOINT` undoes the failed
// statement and leaves the surrounding transaction usable, which is exactly what
// the recovery paths assume they already had. Probed on the same database: the
// re-read succeeds, subsequent writes succeed, and the transaction commits.
//
// On the top-level client there is no transaction to scope, so this is a
// pass-through: `SAVEPOINT` outside a transaction is an error in PostgreSQL, and
// the catch-and-re-read there was always correct.

// `db` is typed `unknown` on purpose. Callers pass anything from the full
// PrismaClient to a hand-narrowed `Pick<PrismaClient, "queueItem">` to a test
// fake, and this function is reflective by nature: it asks what the handle IS at
// runtime. A union of every caller's type would have to be widened for each new
// one, which is how a guard like this stops being applied.
type RawCapable = { $executeRawUnsafe: (sql: string) => Promise<unknown> };

/**
 * True when `db` is a transaction client rather than the top-level client.
 *
 * `Prisma.TransactionClient` is the PrismaClient surface minus the connection
 * and transaction controls, so the absence of `$transaction` is the structural
 * discriminator. Verified against Prisma 5.22 rather than assumed.
 */
export function isTransactionClient(db: unknown): boolean {
  return typeof (db as { $transaction?: unknown } | null)?.$transaction !== "function";
}

/** True when the handle can issue the raw SQL a savepoint needs. */
function canRunRaw(db: unknown): db is RawCapable {
  return typeof (db as { $executeRawUnsafe?: unknown } | null)?.$executeRawUnsafe === "function";
}

let counter = 0;

/**
 * Run `fn`, and if it throws, leave the transaction usable.
 *
 * Returns `fn`'s value on success. On failure the savepoint is rolled back and
 * the original error is re-thrown, so the caller's own `catch (P2002)` still sees
 * exactly the error it expects — the only difference is that the transaction it
 * then queries is no longer aborted.
 *
 * The savepoint name is generated, never taken from input: it is interpolated
 * into SQL that cannot be parameterised.
 */
export async function withSavepoint<T>(db: unknown, fn: () => Promise<T>): Promise<T> {
  // Not a transaction: each statement is its own, so there is nothing to scope.
  // Not raw-capable (a narrowed handle or a test fake): a savepoint is impossible
  // and pretending otherwise would replace a real error with a confusing one.
  if (!isTransactionClient(db) || !canRunRaw(db)) return fn();

  const name = `al_sp_${++counter}`;
  const raw = db;
  await raw.$executeRawUnsafe(`SAVEPOINT ${name}`);
  try {
    const result = await fn();
    await raw.$executeRawUnsafe(`RELEASE SAVEPOINT ${name}`);
    return result;
  } catch (err) {
    // Best-effort: if the rollback itself fails the transaction is unrecoverable
    // and the original error is still the one worth reporting.
    await raw.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT ${name}`).catch(() => {});
    throw err;
  }
}
