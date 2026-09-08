// lib/services/operations/queue-item.service.ts
//
// THE single writer for `queue_items`. §26 requires that every exception names an
// owner, a buyer-visible status, a required action, a deadline and a return point,
// and that all of them are written to `queue_items`. §8.2 Phase 2 requires that
// there be exactly one writer: later phases add exception TYPES, never a second
// writer. `lib/services/comms/__tests__/no-second-exception-writer.test.ts` is the
// build-failing rule that keeps it that way.
//
// WHY NOT `upsert`. §8.2 describes the raise as "idempotency key → upsert".
// `prisma.queueItem.upsert({ where: { idempotencyKey } })` DOES NOT TYPECHECK:
// `idempotencyKey` is declared without `@unique` in schema.prisma:6489, so it is
// not a member of `QueueItemWhereUniqueInput`. The uniqueness is real but PHYSICAL
// ONLY — `queue_items_idempotency_key_key ... WHERE idempotency_key IS NOT NULL`
// at 20261106000100_transaction_spine_foundation/migration.sql:1089-1090. Prisma
// cannot see a partial index. So this service uses the idiom the repository already
// proved against the same shape of index — create, catch P2002, return the winner —
// as `lib/services/financing/review-queue.service.ts:50-58` does. The divergence
// between §8.2's wording and the schema is recorded in §8.1a.
//
// WHY THE KEY IS SUFFIXED ON RECURRENCE. The physical index is once-EVER, not
// once-while-open. A deterministic key of (code, subject) would mean that once an
// exception is resolved the same condition can never be raised again — the second
// raise would collide and silently return the resolved row. So a derived key that
// collides with an OPEN row returns that row (correct dedup), and one that collides
// with a RESOLVED or CLOSED row is suffixed `#2`, `#3`, … and retried: the
// condition recurred and deserves its own row and its own deadline. A caller that
// wants strict once-ever semantics — a webhook event id, say — passes an explicit
// `idempotencyKey`, and a collision on that returns the existing row whatever its
// status.
//
// THIS WRITER NEVER SWALLOWS A DATABASE ERROR. `control/X-01` records the defect
// this replaces: `resolveQueueItem` swallowed a failed write and still audited the
// item as resolved. Every mutation here is a compare-and-swap that throws
// `QueueItemConcurrencyError` when zero rows matched, and no method returns a
// success value it did not observe. Callers on a request hot path decide for
// themselves whether to catch — the writer does not decide for them.
//
// Schema facts this service works around, both verified against schema.prisma:
//   • `QueueItem.id` has no `@default` (:6469) — every insert supplies its own id.
//   • `QueueItem.updatedAt` is `@default(now())`, not `@updatedAt` (:6491) — every
//     mutation sets it by hand or the column freezes at creation time.
//
// Run: pnpm test:operations

import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { withSavepoint } from "@/lib/prisma-savepoint";
import type { Prisma, QueueItem, QueueItemStatus, QueueItemType, QueueOwnerRole } from "@prisma/client";
import { requireException, type ExceptionDefinition } from "./exception-catalogue";

/** Statuses that mean "this exception still needs a human". */
export const OPEN_QUEUE_STATUSES: readonly QueueItemStatus[] = ["OPEN", "ASSIGNED", "ESCALATED"];

/** Statuses that mean "this exception is finished". */
export const TERMINAL_QUEUE_STATUSES: readonly QueueItemStatus[] = ["RESOLVED", "CLOSED"];

/**
 * A compare-and-swap matched zero rows: the item does not exist, or it left the
 * status the caller believed it was in. Never swallowed — see the header.
 */
export class QueueItemConcurrencyError extends Error {
  constructor(
    readonly queueItemId: string,
    readonly attempted: string
  ) {
    super(`Queue item ${queueItemId} did not match the ${attempted} compare-and-swap (0 rows). It was concurrently changed or does not exist.`);
    this.name = "QueueItemConcurrencyError";
  }
}

/** The transaction records an exception may point at. All optional; at least one is required. */
export interface ExceptionRefs {
  vehicleRequestId?: string | null;
  dealId?: string | null;
  auctionId?: string | null;
  depositId?: string | null;
  buyerId?: string | null;
  dealerId?: string | null;
}

export interface RaiseExceptionInput extends ExceptionRefs {
  /** A code from the §26 register. An uncatalogued code is a programming error and throws. */
  code: string;
  /**
   * Strict once-ever key. Supply this when the trigger itself is already unique —
   * a provider event id, a reconciliation run id. Omit it for the ordinary case and
   * the key is derived from the code and the refs.
   */
  idempotencyKey?: string | null;
  /** Overrides the catalogue's deadline. Rarely needed; the catalogue is the rule. */
  deadlineAt?: Date | null;
  /**
   * Appended to the catalogue's required action, for the facts only this
   * occurrence knows (a Stripe reference, a failing field). The catalogue text is
   * never replaced — an owner reading the queue sees the same instruction every
   * time, plus what is specific to this row.
   */
  detail?: string | null;
  /** Overrides the catalogue's owner. Used only where §26 splits an owner by branch. */
  ownerRole?: QueueOwnerRole | null;
}

/** How `raiseException` resolved. `created` false means an equivalent row was already open. */
export interface RaiseExceptionResult {
  item: QueueItem;
  created: boolean;
}

/** Prisma client or an interactive-transaction handle. Lets a raise join a caller's transaction. */
type Db = Pick<typeof prisma, "queueItem"> | Prisma.TransactionClient;

const MAX_RECURRENCE_SUFFIX = 50;

function isUniqueViolation(err: unknown): boolean {
  return (err as { code?: string } | null)?.code === "P2002";
}

/** Refs in a fixed order, so the derived key does not depend on object key order. */
function refFingerprint(refs: ExceptionRefs): string {
  const parts = [
    refs.vehicleRequestId && `vr=${refs.vehicleRequestId}`,
    refs.dealId && `deal=${refs.dealId}`,
    refs.auctionId && `auction=${refs.auctionId}`,
    refs.depositId && `deposit=${refs.depositId}`,
    refs.buyerId && `buyer=${refs.buyerId}`,
    refs.dealerId && `dealer=${refs.dealerId}`,
  ].filter(Boolean);
  return parts.join("|");
}

function hasAnyRef(refs: ExceptionRefs): boolean {
  return refFingerprint(refs) !== "";
}

function buildRequiredAction(def: ExceptionDefinition, detail?: string | null): string {
  const extra = detail?.trim();
  return extra ? `${def.requiredAction} — ${extra}` : def.requiredAction;
}

function deadlineFrom(def: ExceptionDefinition, override: Date | null | undefined, now: Date): Date | null {
  if (override !== undefined) return override;
  if (def.deadlineHours === null) return null;
  return new Date(now.getTime() + def.deadlineHours * 3_600_000);
}

/**
 * Raise a §26 exception. Idempotent per (code, refs) while an equivalent row is
 * open; a recurrence after resolution gets its own row.
 *
 * THROWS rather than returning a falsy value on a database failure. A caller on a
 * request hot path that must not fail because of the queue wraps this call itself
 * — the writer does not silently drop an exception on the caller's behalf.
 */
export async function raiseException(input: RaiseExceptionInput, db: Db = prisma): Promise<RaiseExceptionResult> {
  const def = requireException(input.code);

  // An exception must be findable. Normally that means a stored reference to the
  // record it is about, per §3. But the most severe payments exception —
  // "Payment unroutable to an obligation" — is precisely the case where NO
  // platform record resolves: a Stripe intent arrived with metadata that matches
  // nothing, so there is no deposit, no request and often no buyer to point at.
  // Requiring a ref there would make the one exception §26 marks "never absorbed"
  // the one exception that cannot be raised.
  //
  // So the requirement is: a stored reference OR an explicit idempotency key. The
  // explicit key is a durable handle on the external subject (`PAYMENT_UNROUTABLE:pi_…`)
  // and is indexed, so a human can find the row from the Stripe dashboard. What is
  // refused is a raise with neither — an exception nobody could ever locate.
  if (!hasAnyRef(input) && !input.idempotencyKey) {
    throw new Error(
      `raiseException(${input.code}): needs either a stored reference (vehicleRequestId, dealId, auctionId, depositId, buyerId, dealerId) or an explicit idempotencyKey naming the external subject. An exception with neither cannot be routed or found.`
    );
  }

  const now = new Date();
  const base: Omit<Prisma.QueueItemUncheckedCreateInput, "id" | "idempotencyKey"> = {
    type: def.type,
    status: "OPEN",
    exceptionCode: def.code,
    ownerRole: input.ownerRole ?? def.ownerRole,
    vehicleRequestId: input.vehicleRequestId ?? null,
    dealId: input.dealId ?? null,
    auctionId: input.auctionId ?? null,
    depositId: input.depositId ?? null,
    buyerId: input.buyerId ?? null,
    dealerId: input.dealerId ?? null,
    buyerVisibleStatus: def.buyerVisibleStatus,
    requiredAction: buildRequiredAction(def, input.detail),
    deadlineAt: deadlineFrom(def, input.deadlineAt, now),
    returnPoint: def.returnPoint,
    createdAt: now,
    updatedAt: now,
  };

  // Explicit key: strict once-ever. A collision returns the existing row whatever
  // its status, because the caller told us this trigger happens exactly once.
  if (input.idempotencyKey) {
    const attempt = await attemptCreate(db, base, input.idempotencyKey, /* acceptTerminal */ true);
    // `acceptTerminal: true` never yields null — null is only the "try the next
    // suffix" signal, and the explicit-key path does not suffix. Checked rather
    // than asserted so a future change to attemptCreate cannot make this silent.
    if (!attempt) throw new Error(`raiseException(${def.code}): explicit idempotency key produced no row.`);
    return attempt;
  }

  const baseKey = `${def.code}:${refFingerprint(input)}`;
  for (let suffix = 1; suffix <= MAX_RECURRENCE_SUFFIX; suffix++) {
    const key = suffix === 1 ? baseKey : `${baseKey}#${suffix}`;
    const attempt = await attemptCreate(db, base, key, /* acceptTerminal */ false);
    if (attempt) return attempt;
    // The key is taken by a RESOLVED or CLOSED row: the condition recurred. Try
    // the next suffix.
  }

  throw new Error(
    `raiseException(${def.code}): ${MAX_RECURRENCE_SUFFIX} resolved occurrences already exist for ${refFingerprint(input)}. This is a stuck loop, not an exception — investigate the raise site rather than widening the bound.`
  );
}

/**
 * One create attempt against one key.
 * Returns the row when it created it or found a live duplicate.
 * Returns `null` — only when `acceptTerminal` is false — when the key is held by a
 * finished row, meaning the caller should try the next suffix.
 */
async function attemptCreate(
  db: Db,
  base: Omit<Prisma.QueueItemUncheckedCreateInput, "id" | "idempotencyKey">,
  idempotencyKey: string,
  acceptTerminal: boolean
): Promise<RaiseExceptionResult | null> {
  try {
    // Savepointed. The partial unique index makes a conflict here routine, and
    // `raiseException` is frequently handed a transaction client so the exception
    // commits with the business write. Inside a transaction a raw P2002 aborts
    // everything and the read below would throw while `$transaction` still
    // resolved — the caller would be told the write landed (lib/db/savepoint.ts).
    const item = await withSavepoint(db, () =>
      db.queueItem.create({ data: { ...base, id: randomUUID(), idempotencyKey } }),
    );
    return { item, created: true };
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
  }

  // Lost the race, or the key is already held. Read the holder.
  const existing = await db.queueItem.findFirst({ where: { idempotencyKey } });
  if (!existing) {
    // The unique index rejected the insert but nothing is there to find. That is a
    // real inconsistency, not a race we can absorb.
    throw new Error(`raiseException: unique violation on "${idempotencyKey}" but no row holds that key.`);
  }
  if (acceptTerminal || OPEN_QUEUE_STATUSES.includes(existing.status)) {
    return { item: existing, created: false };
  }
  return null;
}

export interface AssignInput {
  queueItemId: string;
  adminId: string;
}

/** Assign an open exception to an admin. Compare-and-swap on the open statuses. */
export async function assign(input: AssignInput, db: Db = prisma): Promise<QueueItem> {
  const updated = await db.queueItem.updateMany({
    where: { id: input.queueItemId, status: { in: [...OPEN_QUEUE_STATUSES] } },
    data: { status: "ASSIGNED", assignedAdminId: input.adminId, updatedAt: new Date() },
  });
  if (updated.count === 0) throw new QueueItemConcurrencyError(input.queueItemId, "assign");
  return requireRow(db, input.queueItemId);
}

export interface EscalateInput {
  queueItemId: string;
  /** Appended to the required action so the queue records why it was escalated. */
  reason?: string | null;
}

/** Escalate an open exception. Stamps `escalated_at`; the item stays open. */
export async function escalate(input: EscalateInput, db: Db = prisma): Promise<QueueItem> {
  const current = await requireRow(db, input.queueItemId);
  if (!OPEN_QUEUE_STATUSES.includes(current.status)) {
    throw new QueueItemConcurrencyError(input.queueItemId, "escalate");
  }
  const reason = input.reason?.trim();
  const updated = await db.queueItem.updateMany({
    where: { id: input.queueItemId, status: { in: [...OPEN_QUEUE_STATUSES] } },
    data: {
      status: "ESCALATED",
      escalatedAt: new Date(),
      updatedAt: new Date(),
      ...(reason ? { requiredAction: `${current.requiredAction ?? ""} — ESCALATED: ${reason}`.trim() } : {}),
    },
  });
  if (updated.count === 0) throw new QueueItemConcurrencyError(input.queueItemId, "escalate");
  return requireRow(db, input.queueItemId);
}

export interface ResolveInput {
  queueItemId: string;
  resolution: string;
  /** Admin id, or a service name for a system resolution. */
  resolvedBy: string;
  /** RESOLVED (the condition was fixed) or CLOSED (it no longer applies). */
  status?: Extract<QueueItemStatus, "RESOLVED" | "CLOSED">;
}

/**
 * Resolve an open exception.
 *
 * `control/X-01`: the path this replaces caught the database error, returned as if
 * the write had happened, and wrote an audit row saying "resolved". This one lets
 * the database error propagate and throws `QueueItemConcurrencyError` when the
 * compare-and-swap matched nothing. A caller may not record a resolution this
 * function did not perform.
 */
export async function resolve(input: ResolveInput, db: Db = prisma): Promise<QueueItem> {
  const now = new Date();
  const updated = await db.queueItem.updateMany({
    where: { id: input.queueItemId, status: { in: [...OPEN_QUEUE_STATUSES] } },
    data: {
      status: input.status ?? "RESOLVED",
      resolution: input.resolution,
      resolvedBy: input.resolvedBy,
      resolvedAt: now,
      updatedAt: now,
    },
  });
  if (updated.count === 0) throw new QueueItemConcurrencyError(input.queueItemId, "resolve");
  return requireRow(db, input.queueItemId);
}

export interface ListOpenFilter extends ExceptionRefs {
  type?: QueueItemType | QueueItemType[];
  ownerRole?: QueueOwnerRole | QueueOwnerRole[];
  exceptionCode?: string | string[];
  assignedAdminId?: string;
  /** Only items whose deadline has passed. */
  overdueOnly?: boolean;
  take?: number;
  skip?: number;
}

function inClause<T>(v: T | T[] | undefined): { in: T[] } | undefined {
  if (v === undefined) return undefined;
  return { in: Array.isArray(v) ? v : [v] };
}

/**
 * The open queue, newest deadline first (items with no deadline last).
 *
 * Reads throw. A caller that renders this must render the failure — never an empty
 * list, which reads as "no exceptions" and is the most expensive possible lie on
 * an operations queue.
 */
export async function listOpen(filter: ListOpenFilter = {}, db: Db = prisma): Promise<QueueItem[]> {
  const where: Prisma.QueueItemWhereInput = {
    status: { in: [...OPEN_QUEUE_STATUSES] },
    ...(inClause(filter.type) ? { type: inClause(filter.type) } : {}),
    ...(inClause(filter.ownerRole) ? { ownerRole: inClause(filter.ownerRole) } : {}),
    ...(inClause(filter.exceptionCode) ? { exceptionCode: inClause(filter.exceptionCode) } : {}),
    ...(filter.assignedAdminId ? { assignedAdminId: filter.assignedAdminId } : {}),
    ...(filter.vehicleRequestId ? { vehicleRequestId: filter.vehicleRequestId } : {}),
    ...(filter.dealId ? { dealId: filter.dealId } : {}),
    ...(filter.auctionId ? { auctionId: filter.auctionId } : {}),
    ...(filter.depositId ? { depositId: filter.depositId } : {}),
    ...(filter.buyerId ? { buyerId: filter.buyerId } : {}),
    ...(filter.dealerId ? { dealerId: filter.dealerId } : {}),
    ...(filter.overdueOnly ? { deadlineAt: { lt: new Date() } } : {}),
  };
  return db.queueItem.findMany({
    where,
    orderBy: [{ deadlineAt: "asc" }, { createdAt: "asc" }],
    take: filter.take ?? 200,
    skip: filter.skip ?? 0,
  });
}

async function requireRow(db: Db, id: string): Promise<QueueItem> {
  const row = await db.queueItem.findUnique({ where: { id } });
  if (!row) throw new QueueItemConcurrencyError(id, "read-back");
  return row;
}
