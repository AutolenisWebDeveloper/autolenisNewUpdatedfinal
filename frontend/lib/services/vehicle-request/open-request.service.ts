// lib/services/vehicle-request/open-request.service.ts
//
// §5 rule 5 — ONE OPEN REQUEST PER BUYER.
//
//   "If a buyer already has an open Vehicle Request, a new Lane 1 submission
//    attaches to it and updates it. It never creates a second open request and
//    never creates a second buyer record."
//
// THE STATUS SET IS THE DATABASE'S, NOT A SECOND OPINION. `OPEN_REQUEST_STATUSES`
// below is character-for-character the predicate of
// `vehicle_requests_one_open_per_buyer_key`
// (20261106000100_transaction_spine_foundation/migration.sql:1249-1253). Two
// definitions of "open" would eventually disagree, and the one that loses is the
// service's: the index would reject a write the service thought was fine, and the
// buyer would get a raw 23505. The test asserts the two lists match by parsing the
// migration, so a future edit to either fails the build.
//
// `OFFER_DECLINED` IS INCLUDED, by owner Ruling 1 (§8.1a.1): the status has an
// explicit exit (`REOPEN_SOURCING`), so no buyer is stranded by it, and a request
// there still holds offers that may be revalidated — a second request against it is
// exactly the duplicate the index exists to prevent, and would spend a second $99
// on work the first may still deliver. `DRAFT` is included too, which is the
// interaction §6.4's recovery sequence turns on: a buyer with an abandoned draft
// does not get a second request, they get their draft back.
//
// THE RACE IS REAL AND IS HANDLED HERE. §7.2's regression case (i) is two
// concurrent Lane 1 submissions with the same normalised email: both read "no open
// request", both insert, and the partial unique index rejects one with P2002. That
// is the correct database behaviour and a terrible user experience, so the loser
// re-reads and UPDATES the winner's row — compare-and-swap, not a retry loop, and
// the buyer sees one request either way.
//
// §8.1a.1 assigns this to Phase 2 explicitly: "the three `vehicleRequest.create`
// call sites have no pre-check and `hasActiveRequest()` has zero callers, so a
// buyer who declines and resubmits gets a raw 23505 until a service-side guard and
// a buyer-facing 'you already have an open request' path land. That guard is Phase
// 2 work."
//
// Run: pnpm test:vehicle-request

import { prisma } from "@/lib/prisma";
import { withSavepoint } from "@/lib/prisma-savepoint";
import type { Prisma, VehicleRequest, VehicleRequestStatus } from "@prisma/client";
import { logger } from "@/lib/logger";

type Db = typeof prisma | Prisma.TransactionClient;

/**
 * The ten statuses the partial unique index counts as open. Character-for-character
 * the migration's predicate; the test parses the SQL and compares.
 */
export const OPEN_REQUEST_STATUSES: readonly VehicleRequestStatus[] = [
  "DRAFT",
  "SUBMITTED",
  "INTAKE",
  "PAYMENT_REQUIRED",
  "ACTIVE_SOURCING",
  "RADIUS_AUTHORIZATION_REQUIRED",
  "OFFER_READY",
  "OFFER_SENT",
  "OFFER_ACCEPTED",
  "OFFER_DECLINED",
];

/** The buyer's open Vehicle Request, or null. At most one can exist. */
export async function findOpenRequest(buyerId: string, db: Db = prisma): Promise<VehicleRequest | null> {
  return db.vehicleRequest.findFirst({
    where: { buyerId, status: { in: [...OPEN_REQUEST_STATUSES] } },
    orderBy: { createdAt: "desc" },
  });
}

/** Does this buyer already hold an open request? Replaces the never-called `hasActiveRequest`. */
export async function hasOpenRequest(buyerId: string, db: Db = prisma): Promise<boolean> {
  return (await findOpenRequest(buyerId, db)) !== null;
}

export type AttachOutcome =
  /** No open request existed; this submission created one. */
  | "CREATED"
  /** An open request existed; this submission merged into it. */
  | "ATTACHED"
  /** Lost the create race to a concurrent submission; merged into the winner. */
  | "ATTACHED_AFTER_RACE";

export interface AttachResult {
  vehicleRequest: VehicleRequest;
  outcome: AttachOutcome;
  /** Fields this submission actually changed. Empty on a no-op merge. */
  updatedFields: string[];
  /**
   * True when this submission moved an existing DRAFT to SUBMITTED.
   *
   * The caller needs to know because §6.4's recovery sequence has to stop the
   * moment the request advances — the send-time recheck alone would keep the four
   * rows claimable, and a request that is no longer a draft must not still be
   * chased as one.
   */
  promotedFromDraft: boolean;
}

/** Fields a later submission may fill in or improve on an existing open request. */
export type MergeableRequestData = Partial<
  Pick<
    Prisma.VehicleRequestUncheckedCreateInput,
    | "makePreference"
    | "modelPreference"
    | "yearMin"
    | "yearMax"
    | "maxBudgetCents"
    | "statedBudgetCents"
    | "notes"
    | "zip"
    | "city"
    | "state"
    | "latitude"
    | "longitude"
    | "entryType"
    | "buyerOpportunityId"
    | "acquisitionChannel"
    | "utmSource"
    | "utmMedium"
    | "utmCampaign"
    | "utmContent"
    | "sourceUrl"
    | "referrer"
    | "landingSource"
    | "affiliateId"
    | "ipAddress"
    | "ipUnavailableReason"
    | "consentVersion"
    | "consentTextHash"
    | "consentSurface"
    | "consentIp"
    | "consentIpUnavailableReason"
  >
>;

/**
 * Merge policy: a later submission FILLS IN what is missing and never erases what
 * is there.
 *
 * The asymmetry is deliberate. A buyer who submits a second form with a blank
 * budget has not told us their budget is unknown — they have told us nothing about
 * their budget, and the first answer is still the best one we have. Attribution is
 * the sharpest case: overwriting the FIRST touch's `utm_source` with the second
 * touch's null would destroy the acquisition record §6.5 settles a commission on.
 *
 * `notes` is the exception and appends, because two submissions are two things the
 * buyer said and the second does not replace the first.
 */
function computeMerge(existing: VehicleRequest, incoming: MergeableRequestData): { data: Record<string, unknown>; fields: string[] } {
  const data: Record<string, unknown> = {};
  const fields: string[] = [];
  const current = existing as unknown as Record<string, unknown>;

  for (const [key, value] of Object.entries(incoming)) {
    if (value === null || value === undefined) continue;
    if (key === "notes") {
      const prior = typeof current.notes === "string" ? current.notes : "";
      const next = String(value);
      if (prior.includes(next)) continue;
      data.notes = prior ? `${prior}\n\n${next}` : next;
      fields.push("notes");
      continue;
    }
    const held = current[key];
    if (held !== null && held !== undefined && held !== "") continue;
    data[key] = value;
    fields.push(key);
  }
  return { data, fields };
}

export interface AttachInput {
  buyerId: string;
  /** Status for a NEWLY created request. An existing open request keeps its own. */
  createStatus: Extract<VehicleRequestStatus, "DRAFT" | "SUBMITTED">;
  data: MergeableRequestData;
}

/**
 * Attach this submission to the buyer's open request, or create one.
 *
 * NEVER creates a second open request. When the create loses a race to a
 * concurrent submission, the P2002 from the partial unique index is caught, the
 * winner is re-read, and this submission merges into it — so two simultaneous
 * form posts yield one buyer and one request, which is §7.2's regression case (i).
 */
export async function attachOrCreateOpenRequest(input: AttachInput, db: Db = prisma): Promise<AttachResult> {
  const existing = await findOpenRequest(input.buyerId, db);
  if (existing) {
    return mergeInto(existing, input.data, "ATTACHED", input.createStatus, db);
  }

  try {
    // The create is savepointed: a P2002 inside an interactive transaction aborts
    // the WHOLE transaction, so the re-read below would throw and `$transaction`
    // would still resolve — reporting success for a request that was rolled back.
    // See lib/db/savepoint.ts; measured, not assumed.
    const created = await withSavepoint(db, () =>
      db.vehicleRequest.create({
        data: { buyerId: input.buyerId, status: input.createStatus, ...input.data },
      }),
    );
    return { vehicleRequest: created, outcome: "CREATED", updatedFields: Object.keys(input.data), promotedFromDraft: false };
  } catch (err) {
    if ((err as { code?: string } | null)?.code !== "P2002") throw err;
    // The partial unique index rejected this insert: a concurrent submission won.
    // Merge into the winner rather than surfacing a 23505 to the buyer.
    const winner = await findOpenRequest(input.buyerId, db);
    if (!winner) {
      // P2002 with no open row means the collision was on some OTHER unique key —
      // re-raise rather than silently swallowing an unrelated constraint failure.
      throw err;
    }
    logger.info("[open-request] lost the create race; merging into the concurrent winner", {
      buyerId: input.buyerId,
      vehicleRequestId: winner.id,
    });
    return mergeInto(winner, input.data, "ATTACHED_AFTER_RACE", input.createStatus, db);
  }
}

async function mergeInto(
  existing: VehicleRequest,
  incoming: MergeableRequestData,
  outcome: AttachOutcome,
  createStatus: AttachInput["createStatus"],
  db: Db
): Promise<AttachResult> {
  const { data, fields } = computeMerge(existing, incoming);

  // FORWARD ONLY, and only out of DRAFT.
  //
  // An existing open request keeps its own status — regressing OFFER_SENT to
  // SUBMITTED because a buyer re-submitted a form would rewind a live auction.
  // DRAFT is the one exception, and it is not a rewind: a buyer who captured a
  // partial request and then submitted a complete one has finished the thing the
  // draft stood for. Leaving it DRAFT was a defect with two visible halves — the
  // §6.4 recovery sequence kept telling a buyer who had finished to finish, and
  // `abandonStaleDrafts` would have stamped a completed request abandoned at 14
  // days. Nothing else is promoted, and nothing is ever demoted.
  const promotedFromDraft = existing.status === "DRAFT" && createStatus === "SUBMITTED";
  if (promotedFromDraft) {
    data.status = "SUBMITTED";
    fields.push("status");
  }

  if (fields.length === 0) {
    return { vehicleRequest: existing, outcome, updatedFields: [], promotedFromDraft: false };
  }
  const updated = await db.vehicleRequest.update({ where: { id: existing.id }, data });
  return { vehicleRequest: updated, outcome, updatedFields: fields, promotedFromDraft };
}
