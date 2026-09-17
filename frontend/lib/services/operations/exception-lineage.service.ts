// lib/services/operations/exception-lineage.service.ts
//
// ONE LINEAGE — the checkpoint, owner, deadline and recovery that the buyer portal,
// the dealer portal and the Ops queue all render.
//
// §8.1 row 10: "buyer portal, dealer portal and Ops queue render the same checkpoint,
// owner, deadline and recovery from ONE lineage."
//
// ── WHY THIS IS A SERVICE AND NOT THREE COMPONENTS ──────────────────────────
//
// Three surfaces rendering the same fact independently is how a buyer and a
// dealership end up believing different things about the same deal. The repository
// already had the proof in miniature: `makeFmt` — the function that turns a pickup
// deadline into words a person reads — existed TWICE, once in
// `app/buyer/pickup/page.tsx:25` and once in `app/dealer/pickups/page.tsx:15`. Two
// implementations of "what time is this happening", one per audience, already
// drifting apart in a codebase where nobody had yet noticed.
//
// So the projection lives here, once, and each portal chooses an AUDIENCE rather
// than a rendering.
//
// ── WHAT DIFFERS BY AUDIENCE IS DISCLOSURE, NOT FACT ────────────────────────
//
// Every audience gets the same `checkpoint`, `owner`, `deadlineAt` and
// `openedAt` — those are the transaction's state and cannot differ without one of
// the three being wrong.
//
// What differs is the RECOVERY TEXT, and only because the three parties do different
// things about it:
//
//   · OPS gets `requiredAction` — the catalogue's instruction to the owner, which
//     names internal systems and is written for someone with admin access.
//   · BUYER gets `buyerVisibleStatus` — the catalogue's buyer copy, which is the
//     same fact in the second person. A `null` there is DELIBERATE (§26 has rows
//     that are infrastructure conditions a buyer is never shown), and a null means
//     the row is not surfaced to the buyer at all rather than surfaced blank.
//   · DEALER gets a deliberately narrow projection — see `DEALER_VISIBLE_CODES`.
//
// ── THE DEALER SURFACE IS AN ALLOWLIST, AND HAS TO BE ───────────────────────
//
// §25.1's identity firewall means a dealership sees the transaction, never the
// buyer. Most §26 exceptions are about the buyer — their payment failed, their
// prequalification expired, their location could not be placed — and showing a
// dealership "the buyer's payment failed" leaks both a fact about a person and a
// reason to price differently.
//
// So the dealer projection is an ALLOWLIST of codes that are genuinely about the
// dealership's own obligation, with dealer-facing copy written here rather than
// reused from the buyer's. A code absent from the list is invisible to dealers —
// fail-closed, so a new §26 row is silent on the dealer surface until someone
// decides it belongs there, rather than leaking by default.

import { prisma } from "@/lib/prisma";
import type { QueueItem, QueueOwnerRole } from "@prisma/client";
import { findException } from "./exception-catalogue";
import { listOpen, OPEN_QUEUE_STATUSES } from "./queue-item.service";

export type LineageAudience = "BUYER" | "DEALER" | "OPS";

export interface ExceptionLineage {
  readonly id: string;
  /** §26's exception — what checkpoint the transaction is held at. */
  readonly checkpoint: string;
  readonly exceptionCode: string;
  /** §26's owner. The same value for every audience: who is acting. */
  readonly owner: QueueOwnerRole;
  /** Rendered for the audience — "You", "The dealership", "AutoLenis Operations". */
  readonly ownerLabel: string;
  /** §26's deadline. ISO, formatted by the caller against the viewer's zone. */
  readonly deadlineAt: string | null;
  readonly overdue: boolean;
  readonly openedAt: string;
  /** §26's "return point in the same transaction". */
  readonly returnPoint: string | null;
  /** The recovery, in the audience's own terms. Never null on a returned row. */
  readonly recovery: string;
  readonly escalated: boolean;
  /**
   * The refs this exception is about. Carried so a surface can route a buyer BACK to the
   * right place: §26's `returnPoint` is prose written for an operator, not a route, and
   * a panel that guessed one sent buyers with no deal to a deal page.
   *
   * Deliberately only the transaction refs — no buyer or dealer identifier, so the shape
   * a dealer-audience caller receives still carries nothing about the buyer (§25.1).
   */
  readonly dealId: string | null;
  readonly vehicleRequestId: string | null;
}

/**
 * How the owner reads to each audience.
 *
 * A buyer seeing "BUYER_OPERATIONS" learns nothing; a buyer seeing "You and
 * AutoLenis" knows whether to wait or to act, which is the only question they have.
 */
const OWNER_LABELS: Record<QueueOwnerRole, Record<LineageAudience, string>> = {
  SYSTEM: { BUYER: "AutoLenis", DEALER: "AutoLenis", OPS: "System" },
  BUYER: { BUYER: "You", DEALER: "The buyer", OPS: "Buyer" },
  OPERATIONS: { BUYER: "AutoLenis", DEALER: "AutoLenis", OPS: "Operations" },
  FINANCE: { BUYER: "AutoLenis", DEALER: "AutoLenis", OPS: "Finance" },
  COMPLIANCE: { BUYER: "AutoLenis", DEALER: "AutoLenis", OPS: "Compliance" },
  BUYER_OPERATIONS: { BUYER: "You and AutoLenis", DEALER: "AutoLenis", OPS: "Buyer / Operations" },
  OPERATIONS_FINANCE: { BUYER: "AutoLenis", DEALER: "AutoLenis", OPS: "Operations / Finance" },
  BUYER_DEALER: { BUYER: "You and the dealership", DEALER: "You and the buyer", OPS: "Buyer / Dealer" },
};

/**
 * The §26 codes a dealership may see on its own transaction, with dealer-facing copy.
 *
 * FAIL-CLOSED BY CONSTRUCTION: a code that is not a key here is not shown to
 * dealers. Adding a §26 row therefore cannot leak to the dealer surface by default —
 * it has to be added here deliberately, which is a reviewable decision rather than an
 * omission nobody sees.
 */
const DEALER_VISIBLE_CODES: Record<string, string> = {
  DEAL_FROZEN_PENDING_RELEASE:
    "This purchase is on hold while AutoLenis agrees a release with you and the buyer. Do not release the vehicle until this is resolved.",
  CONTRACT_FAIL:
    "Contract Shield found issues in the contract you supplied. AutoLenis will send the specific findings — a corrected contract is needed before signing continues.",
  SIGNATURE_NOT_COMPLETED:
    "A signature on this deal is outstanding. Signing cannot complete until every party has signed.",
  RELEASED_BUT_NOT_CONFIRMED:
    "You recorded the vehicle as released, but the buyer has not confirmed possession. AutoLenis is contacting them — the deal does not complete until they confirm.",
  POST_COMPLETION_OBLIGATION_OVERDUE:
    "A post-completion obligation on this deal is overdue. This affects your dealership scorecard.",
  DEALER_REAFFIRMATION_OVERDUE:
    "This deal is waiting on your reaffirmation. The buyer has been told the deal is held.",
};

function toLineage(row: QueueItem, audience: LineageAudience): ExceptionLineage | null {
  const def = findException(row.exceptionCode ?? "");
  // A row whose code is not catalogued has no owner, deadline or copy — §26's whole
  // guarantee. It is not rendered to anyone, and `exception-register-completeness`
  // is what stops such a row existing in the first place.
  if (!def) return null;

  const recovery = recoveryFor(row, def.buyerVisibleStatus, def.requiredAction, audience);
  if (recovery === null) return null;

  const owner = row.ownerRole ?? def.ownerRole;
  return {
    id: row.id,
    checkpoint: def.label,
    exceptionCode: def.code,
    owner,
    ownerLabel: OWNER_LABELS[owner][audience],
    deadlineAt: row.deadlineAt ? row.deadlineAt.toISOString() : null,
    overdue: row.deadlineAt ? row.deadlineAt.getTime() < Date.now() : false,
    openedAt: row.createdAt.toISOString(),
    returnPoint: row.returnPoint ?? null,
    recovery,
    escalated: row.escalatedAt !== null,
    dealId: row.dealId ?? null,
    vehicleRequestId: row.vehicleRequestId ?? null,
  };
}

/** `null` means "this audience does not see this row at all" — not "show it blank". */
function recoveryFor(
  row: QueueItem,
  buyerVisibleStatus: string | null,
  requiredAction: string,
  audience: LineageAudience,
): string | null {
  switch (audience) {
    case "OPS":
      // The occurrence's own detail is appended to the catalogue text by
      // `raiseException`, so `requiredAction` on the ROW is the richer one.
      return row.requiredAction ?? requiredAction;
    case "BUYER":
      // A null buyerVisibleStatus is §26's explicit "the buyer is never shown this".
      return row.buyerVisibleStatus ?? buyerVisibleStatus;
    case "DEALER":
      return DEALER_VISIBLE_CODES[row.exceptionCode ?? ""] ?? null;
  }
}

export interface LineageQuery {
  readonly audience: LineageAudience;
  readonly buyerId?: string;
  readonly dealId?: string;
  readonly vehicleRequestId?: string;
  readonly dealerId?: string;
}

/**
 * The open exceptions one audience may see, as one lineage.
 *
 * Ordered by deadline, soonest first — the same order the Ops queue uses, so a buyer
 * and an operator reading the same transaction see the same thing at the top.
 *
 * READS THROW, deliberately, mirroring `listOpen`'s contract: a surface that renders
 * this must render the failure. An empty list reads as "nothing is wrong", which is
 * the most expensive possible lie to tell a buyer whose deal is stuck.
 */
export async function exceptionLineage(query: LineageQuery): Promise<ExceptionLineage[]> {
  const rows = await listOpen({
    buyerId: query.buyerId,
    dealId: query.dealId,
    vehicleRequestId: query.vehicleRequestId,
    dealerId: query.dealerId,
  });
  return rows
    .map((row) => toLineage(row, query.audience))
    .filter((l): l is ExceptionLineage => l !== null);
}

/**
 * Codes that RECORD a suppression, and therefore must never CAUSE one.
 *
 * ── THE LOOP THIS CLOSES, FOUND BY THE FIRST INDEPENDENT REVIEW ─────────────
 *
 * §26 gives `UPGRADE_PROMPT_DURING_OPEN_EXCEPTION` the owner OPERATIONS and NO DEADLINE,
 * and `POST /api/buyer/plan/upgrade` raises it when a buyer reaches the upgrade action
 * while something else is open. That row is then itself an open exception on the same
 * buyer — so:
 *
 *   1. exception X opens; the buyer tries to upgrade and is refused;
 *   2. the refusal opens Y (`UPGRADE_PROMPT_DURING_OPEN_EXCEPTION`), deadline-less;
 *   3. X is resolved;
 *   4. Y is still open, so the buyer is refused again — permanently, by the record of
 *      having been refused.
 *
 * And the copy they are given is "we will let you know as soon as it clears", about a row
 * that clears only when somebody notices a queue item with no deadline that describes a
 * rule working correctly. A buyer could be locked out of Premium for ever by the fact that
 * they once tried to buy it at a bad moment.
 *
 * The fix is at the cause and is a CLASS, not a special case: a row whose subject is "the
 * suppression fired" is evidence that the rule worked, not evidence that the transaction is
 * stalled. It stays on the Operations queue, where it is what §26 asks for; it simply stops
 * being an input to the predicate that created it.
 */
const SUPPRESSION_EXEMPT_CODES: readonly string[] = ["UPGRADE_PROMPT_DURING_OPEN_EXCEPTION"];

/**
 * Whether this buyer's TRANSACTION is stalled by an open exception right now.
 *
 * §26: "Upgrade prompt fires during an open exception | Operations | Suppress; never
 * upsell a buyer whose deal is stalled." The prompt surfaces need one cheap boolean,
 * not the projection — a count query rather than a fetch-and-map, because this is
 * called on render paths that are not about exceptions at all.
 *
 * COUNTS EVERY OPEN EXCEPTION, including the ones with no buyer-visible status — the rule
 * is about the transaction being stalled, not about whether the buyer can see why, and
 * upselling someone whose deal is blocked by a provider quota they were never shown is the
 * same mistake. The ONE class it excludes is `SUPPRESSION_EXEMPT_CODES` above.
 *
 * THIS IS THE ONE PREDICATE. The buyer dashboard used to decide the same question from
 * `exceptionLineage({ audience: "BUYER" })`, which DROPS every row whose `buyerVisibleStatus`
 * is null — so a buyer held by an ops-only exception saw the upgrade card, clicked it, and
 * met a 409 from this predicate. Two answers to one question, and the one the buyer could
 * see was the wrong one. A surface that renders exceptions uses the lineage; a surface that
 * DECIDES something uses this.
 */
export async function hasOpenException(buyerId: string): Promise<boolean> {
  const count = await prisma.queueItem.count({
    where: {
      buyerId,
      status: { in: [...OPEN_QUEUE_STATUSES] },
      OR: [
        { exceptionCode: null },
        { exceptionCode: { notIn: [...SUPPRESSION_EXEMPT_CODES] } },
      ],
    },
    take: 1,
  });
  return count > 0;
}
