// lib/services/operations/lineage.service.ts
//
// §3's orphan rule, both halves.
//
//   "Every record locates its parent by stored reference. Never by name, email, or
//    phone. A payment, auction, offer, deal, contract, or pickup that cannot
//    resolve its parent is an orphan: it raises an Operations exception and is
//    never silently re-parented or duplicated into a parallel transaction."
//
// Half one — the FORWARD GUARD. `assertParentResolvable()` is called by every
// creation path for the six classes. A supplied parent reference that does not
// resolve raises `LINEAGE_ORPHAN` through the single writer and then throws, so the
// child is never written under a parent that is not there. A parent that is absent
// on a class where this phase does not yet require one passes quietly; the sweep,
// not the guard, is what finds those.
//
// Half two — the SWEEP. `sweepLineageOrphans()` walks existing rows whose parent is
// null or unresolvable and raises exactly one `LINEAGE_ORPHAN` per row, for a human.
// IT NEVER RE-PARENTS ANYTHING. Re-parenting is a human decision taken through
// `POST /api/admin/lineage/reparent`, which writes an audit row; the build-failing
// rule `lib/services/operations/__tests__/no-service-reparent.test.ts` is what stops
// a service from doing it instead.
//
// WHY `required` IS PER-CLASS AND PER-PHASE. Two of the six classes legitimately
// carry a null parent today: `deposits.vehicle_request_id` is written by no code
// path at all, and `auctions.vehicle_request_id` is left NULL by design by the
// deposit-activation reconciler (`deposit-activation.service.ts:207`,
// `auction.service.ts:15-19`). Phase 3 neutralises that legacy path and flips both
// to required. Making them required NOW would refuse writes on a path this phase
// does not own — which is how a guard turns into an outage. The registry records
// the phase that flips each one so the deferral is visible rather than assumed.
//
// The sweep's own findings against production are recorded in §8.2 and are
// point-in-time: auctions 7 rows with 6 holding a NULL vehicle_request_id; deposits
// 8 rows all needing attachment once Phase 1's column exists; offers, deals,
// pickups and contract_versions empty, so for those four the rule ships as a
// forward guard rather than a cleanup. Whether a back-sweep raises one exception
// per pre-existing parentless auction, or those rows are grandfathered, is an owner
// decision (`control/L3-01`) and is why nothing here runs on a schedule: the sweep
// is a callable function with no cron registration in this phase.
//
// Run: pnpm test:operations

import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { raiseException, type ExceptionRefs } from "./queue-item.service";

type Db = typeof prisma | Prisma.TransactionClient;

/** The six record classes §3 names. */
export type LineageClass = "deposit" | "auction" | "offer" | "deal" | "contractVersion" | "pickup" | "auctionVehicle";

/** A parent reference: which kind of parent, and the id claimed for it. */
export interface ParentRef {
  kind: ParentKind;
  id: string | null | undefined;
}

export type ParentKind = "vehicleRequest" | "auction" | "offer" | "vehicleRequestOffer" | "deal" | "buyer";

interface LineageSpec {
  /** The parent references this class must be able to resolve, in priority order. */
  parents: readonly ParentKind[];
  /**
   * Whether a MISSING (null/undefined) parent is an orphan in this phase. A
   * present-but-unresolvable parent is always an orphan regardless.
   */
  requiredFromPhase: number;
  /** Why, when `requiredFromPhase` is later than 2. */
  deferralReason?: string;
}

/** The registry. One row per class §3 names; nothing is implicit. */
export const LINEAGE_SPECS: Readonly<Record<LineageClass, LineageSpec>> = {
  deposit: {
    parents: ["vehicleRequest"],
    requiredFromPhase: 3,
    deferralReason:
      "deposits.vehicle_request_id is written by no code path today; Phase 3 makes one PaymentIntent per Vehicle Request and backfills.",
  },
  auction: {
    parents: ["vehicleRequest"],
    requiredFromPhase: 3,
    deferralReason:
      "the deposit-settlement legacy path creates auctions with vehicle_request_id NULL by design; §8.4 neutralises it in Phase 3.",
  },
  offer: { parents: ["auction"], requiredFromPhase: 2 },
  deal: {
    parents: ["offer", "vehicleRequestOffer"],
    requiredFromPhase: 6,
    deferralReason: "Deal lineage columns are written by Phase 6 selection; nothing writes them today.",
  },
  contractVersion: { parents: ["deal"], requiredFromPhase: 2 },
  pickup: { parents: ["deal"], requiredFromPhase: 2 },
  // PHASE 4. A candidate belongs to a Vehicle Request: `auction_vehicles_enforce_cap_trg`
  // counts the five-cap per request, so a candidate with no request is outside the cap as
  // well as outside the lineage. Nothing wrote the column before Phase 4
  // (`ensureAuctionVehicleFromRequest` read the request and discarded its id), so production's
  // three rows are all orphans. They are LEFT IN PLACE with an exception raised rather than
  // backfilled or dropped: they predate the transaction spine, their auctions carry
  // vehicle_request_id NULL too, so there is no request to attribute them to — and deleting
  // them would remove the record of a real auction.
  //
  // ONE parent, not two. `parents` is an alternatives list judged in priority order — any one
  // resolving clears the row (that is what lets a Deal satisfy lineage through EITHER offer
  // link) — so naming `auction` alongside `vehicleRequest` would let a candidate with a valid
  // auction and NO request pass, which is exactly the population being looked for. The auction
  // link needs no lineage check: `auction_vehicles.auction_id` is NOT NULL with a foreign key,
  // so the database already refuses an unresolvable one.
  auctionVehicle: { parents: ["vehicleRequest"], requiredFromPhase: 4 },
};

/**
 * The phase this code belongs to. Bump with the phase; the registry compares against it.
 *
 * STILL 2 IN PHASE 4, DELIBERATELY, AND REPORTED RATHER THAN QUIETLY RAISED. Bumping it to 4
 * would also activate the `deposit` and `auction` classes, whose deferral is not a stale note
 * but an open owner ruling — `control/L3-01`, named in `SweepOptions.includeDeferred` and
 * asserted by test: "the owner rules control/L3-01 before historical rows are swept". Turning
 * that on would raise a LINEAGE_ORPHAN for every historical deposit and auction, which is the
 * owner's call and not this phase's.
 *
 * Phase 4's own class, `auctionVehicle`, is registered at `requiredFromPhase: 4` and is
 * reachable WITHOUT that bump: `sweepLineageOrphans({ only: ["auctionVehicle"],
 * includeDeferred: true })` raises for exactly the candidate rows and nothing else. That is the
 * runnable form of the ruling on production's three orphaned candidates — leave them in place,
 * with an exception raised.
 */
export const CURRENT_PHASE = 2;

/**
 * Raised after the `LINEAGE_ORPHAN` exception has been written. Creation paths let
 * it propagate: §3 says an orphan is never "duplicated into a parallel
 * transaction", and writing the child anyway is exactly that.
 */
export class LineageOrphanError extends Error {
  constructor(
    readonly recordClass: LineageClass,
    readonly parent: ParentRef,
    readonly queueItemId: string
  ) {
    super(
      `${recordClass}: parent ${parent.kind}=${parent.id ?? "NULL"} does not resolve. Raised LINEAGE_ORPHAN ${queueItemId}; the record was not created.`
    );
    this.name = "LineageOrphanError";
  }
}

/** Does this parent id exist? One narrow read per kind — never a name/email/phone lookup. */
async function parentExists(db: Db, kind: ParentKind, id: string): Promise<boolean> {
  switch (kind) {
    case "vehicleRequest":
      return (await db.vehicleRequest.findUnique({ where: { id }, select: { id: true } })) !== null;
    case "auction":
      return (await db.auction.findUnique({ where: { id }, select: { id: true } })) !== null;
    case "offer":
      return (await db.offer.findUnique({ where: { id }, select: { id: true } })) !== null;
    case "vehicleRequestOffer":
      return (await db.vehicleRequestOffer.findUnique({ where: { id }, select: { id: true } })) !== null;
    case "deal":
      return (await db.deal.findUnique({ where: { id }, select: { id: true } })) !== null;
    case "buyer":
      return (await db.buyer.findUnique({ where: { id }, select: { id: true } })) !== null;
  }
}

export interface AssertParentInput {
  recordClass: LineageClass;
  /** Every parent reference the child is about to be written with. */
  parents: readonly ParentRef[];
  /** Refs to attach to the exception so a human can find the subject. */
  refs?: ExceptionRefs;
  /** Extra context for the exception's required action. */
  detail?: string | null;
}

/**
 * Assert that a record about to be created can resolve its parent.
 *
 * Resolves quietly when every supplied parent exists, or when no parent is supplied
 * and this phase does not yet require one for the class.
 *
 * Raises `LINEAGE_ORPHAN` and throws `LineageOrphanError` when a supplied parent id
 * does not resolve, or when no parent is supplied for a class that requires one.
 */
export async function assertParentResolvable(input: AssertParentInput, db: Db = prisma): Promise<void> {
  const spec = LINEAGE_SPECS[input.recordClass];
  const supplied = input.parents.filter((p) => spec.parents.includes(p.kind));

  // 1. Anything supplied must resolve. This holds in every phase.
  for (const parent of supplied) {
    if (!parent.id) continue;
    if (await parentExists(db, parent.kind, parent.id)) continue;
    const queueItemId = await raiseOrphan(db, input, parent);
    throw new LineageOrphanError(input.recordClass, parent, queueItemId);
  }

  // 2. At least one must be present, once the class requires it.
  const anyPresent = supplied.some((p) => Boolean(p.id));
  if (anyPresent) return;
  if (CURRENT_PHASE < spec.requiredFromPhase) return;

  const missing: ParentRef = { kind: spec.parents[0], id: null };
  const queueItemId = await raiseOrphan(db, input, missing);
  throw new LineageOrphanError(input.recordClass, missing, queueItemId);
}

async function raiseOrphan(db: Db, input: AssertParentInput, parent: ParentRef): Promise<string> {
  const { item } = await raiseException(
    {
      code: "LINEAGE_ORPHAN",
      ...(input.refs ?? {}),
      detail: [`${input.recordClass} could not resolve ${parent.kind}=${parent.id ?? "NULL"}`, input.detail?.trim()]
        .filter(Boolean)
        .join("; "),
    },
    db
  );
  return item.id;
}

export interface SweepFinding {
  recordClass: LineageClass;
  recordId: string;
  parentKind: ParentKind;
  parentId: string | null;
  reason: "MISSING" | "UNRESOLVABLE";
  queueItemId: string;
}

export interface SweepReport {
  scanned: Record<LineageClass, number>;
  findings: SweepFinding[];
  /** Classes skipped because this phase does not require their parent yet. */
  skipped: LineageClass[];
}

export interface SweepOptions {
  /** Cap per class, so a sweep of a large table cannot run unbounded. */
  limitPerClass?: number;
  /**
   * Include classes whose parent this phase does not yet require. Off by default:
   * turning it on before the owner rules `control/L3-01` would raise one exception
   * for every historical auction and deposit.
   */
  includeDeferred?: boolean;
  /**
   * Sweep only these classes. Added in Phase 4 so a single deferred class can be swept without
   * dragging every other deferred class in with it — `includeDeferred` is all-or-nothing, and
   * the candidate rows needed raising while the deposit and auction ruling is still open.
   */
  only?: readonly LineageClass[];
}

/**
 * Sweep existing rows for unresolvable parents and raise one `LINEAGE_ORPHAN` each.
 *
 * NEVER re-parents, never deletes, never writes to the swept row. The raise is
 * keyed on the swept record, so a repeated sweep does not multiply rows.
 */
export async function sweepLineageOrphans(opts: SweepOptions = {}, db: Db = prisma): Promise<SweepReport> {
  const take = opts.limitPerClass ?? 500;
  const report: SweepReport = {
    scanned: { deposit: 0, auction: 0, offer: 0, deal: 0, contractVersion: 0, pickup: 0, auctionVehicle: 0 },
    findings: [],
    skipped: [],
  };

  const only = opts.only ? new Set(opts.only) : null;

  for (const recordClass of Object.keys(LINEAGE_SPECS) as LineageClass[]) {
    if (only && !only.has(recordClass)) continue;
    const spec = LINEAGE_SPECS[recordClass];
    if (CURRENT_PHASE < spec.requiredFromPhase && !opts.includeDeferred) {
      report.skipped.push(recordClass);
      continue;
    }
    const rows = await loadForSweep(db, recordClass, take);
    report.scanned[recordClass] = rows.length;
    for (const row of rows) {
      const present = row.parents.find((p) => Boolean(p.id));
      if (!present) {
        report.findings.push(await recordFinding(db, recordClass, row, { kind: spec.parents[0], id: null }, "MISSING"));
        continue;
      }
      if (!(await parentExists(db, present.kind, present.id as string))) {
        report.findings.push(await recordFinding(db, recordClass, row, present, "UNRESOLVABLE"));
      }
    }
  }
  return report;
}

interface SweepRow {
  id: string;
  parents: ParentRef[];
  refs: ExceptionRefs;
}

async function loadForSweep(db: Db, recordClass: LineageClass, take: number): Promise<SweepRow[]> {
  switch (recordClass) {
    case "deposit": {
      const rows = await db.deposit.findMany({ select: { id: true, vehicleRequestId: true, buyerId: true }, take });
      return rows.map((r) => ({
        id: r.id,
        parents: [{ kind: "vehicleRequest" as const, id: r.vehicleRequestId }],
        refs: { depositId: r.id, buyerId: r.buyerId, vehicleRequestId: r.vehicleRequestId },
      }));
    }
    case "auction": {
      const rows = await db.auction.findMany({ select: { id: true, vehicleRequestId: true, buyerId: true }, take });
      return rows.map((r) => ({
        id: r.id,
        parents: [{ kind: "vehicleRequest" as const, id: r.vehicleRequestId }],
        refs: { auctionId: r.id, buyerId: r.buyerId, vehicleRequestId: r.vehicleRequestId },
      }));
    }
    case "offer": {
      const rows = await db.offer.findMany({ select: { id: true, auctionId: true, dealerId: true }, take });
      return rows.map((r) => ({
        id: r.id,
        parents: [{ kind: "auction" as const, id: r.auctionId }],
        refs: { auctionId: r.auctionId, dealerId: r.dealerId },
      }));
    }
    case "deal": {
      const rows = await db.deal.findMany({
        select: { id: true, offerId: true, vehicleRequestOfferId: true, buyerId: true },
        take,
      });
      return rows.map((r) => ({
        id: r.id,
        parents: [
          { kind: "offer" as const, id: r.offerId },
          { kind: "vehicleRequestOffer" as const, id: r.vehicleRequestOfferId },
        ],
        refs: { dealId: r.id, buyerId: r.buyerId },
      }));
    }
    case "contractVersion": {
      const rows = await db.contractVersion.findMany({ select: { id: true, dealId: true }, take });
      return rows.map((r) => ({ id: r.id, parents: [{ kind: "deal" as const, id: r.dealId }], refs: { dealId: r.dealId } }));
    }
    case "pickup": {
      const rows = await db.pickup.findMany({ select: { id: true, dealId: true }, take });
      return rows.map((r) => ({ id: r.id, parents: [{ kind: "deal" as const, id: r.dealId }], refs: { dealId: r.dealId } }));
    }
    case "auctionVehicle": {
      // DROPPED candidates are excluded: a dropped row is a record of a decision, not a live
      // child, and raising an exception for one would ask an operator to fix history.
      const rows = await db.auctionVehicle.findMany({
        where: { candidateStatus: { not: "DROPPED" } },
        select: { id: true, vehicleRequestId: true, auctionId: true },
        take,
      });
      return rows.map((r) => ({
        id: r.id,
        parents: [{ kind: "vehicleRequest" as const, id: r.vehicleRequestId }],
        refs: { auctionId: r.auctionId, vehicleRequestId: r.vehicleRequestId },
      }));
    }
  }
}

async function recordFinding(
  db: Db,
  recordClass: LineageClass,
  row: SweepRow,
  parent: ParentRef,
  reason: SweepFinding["reason"]
): Promise<SweepFinding> {
  const { item } = await raiseException(
    {
      code: "LINEAGE_ORPHAN",
      ...row.refs,
      // A sweep finding is keyed on the swept row, not on the parent, so two rows
      // orphaned from the same parent raise two exceptions — one per record a human
      // has to place. Once-ever: a resolved sweep finding is not re-raised.
      idempotencyKey: `LINEAGE_ORPHAN:sweep:${recordClass}:${row.id}`,
      detail: `sweep: ${recordClass} ${row.id} has ${reason === "MISSING" ? "no" : "an unresolvable"} ${parent.kind} parent${parent.id ? ` (${parent.id})` : ""}`,
    },
    db
  );
  return { recordClass, recordId: row.id, parentKind: parent.kind, parentId: parent.id ?? null, reason, queueItemId: item.id };
}
