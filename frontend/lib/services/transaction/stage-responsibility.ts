// lib/services/transaction/stage-responsibility.ts
//
// §30's "Who is responsible for what", as a registry.
//
// §11.5 ruling 11: "**§30** responsibility lands in Phase 2 (the `owner_role`
// registry) and then in each stage's own phase." This is that registry. Phase 2
// seeds stages 1–3 with their duty text verbatim from §30; later phases fill in
// their own rows, and `control/W30-*` tracks each.
//
// WHY IT EXISTS. Two things in the plan depend on a single answer to "whose move is
// it?": §26 requires every exception to name an owner, and the buyer surfaces have
// to tell a buyer what they are waiting for without each screen inventing its own
// wording. Both were being answered ad hoc. `raiseException` reads the catalogue's
// owner, and the catalogue's owners agree with this table by construction — the
// test below checks that, rather than trusting two hand-maintained lists to match.
//
// THE FOUR COLUMNS ARE §30's, VERBATIM. Buyer, Dealership, AutoLenis staff, System.
// A dash in the table is `null` here, not an empty string: "the dealership has no
// duty at Stage 3" is a fact worth stating, and an empty string reads as an
// oversight.
//
// Run: pnpm test:operations

import type { QueueOwnerRole } from "@prisma/client";

/** A §30 row. `stages` is a range because §30 groups some stages together. */
export interface StageResponsibility {
  /** The stage numbers this row covers, as §30 groups them. */
  readonly stages: readonly number[];
  /** §30's row label. */
  readonly label: string;
  /** §30's four columns, verbatim. `null` is §30's dash — no duty at this stage. */
  readonly buyer: string | null;
  readonly dealership: string | null;
  readonly staff: string | null;
  readonly system: string | null;
  /**
   * Who owns the CHECKPOINT while the transaction sits at this stage — the value
   * written to `queue_items.owner_role` for an exception raised here.
   */
  readonly ownerRole: QueueOwnerRole;
  /** The phase that seeds this row's behaviour. Phase 2 seeds 1–3. */
  readonly seededInPhase: number;
}

const ROWS: readonly StageResponsibility[] = [
  {
    stages: [1, 2],
    label: "Account, onboarding",
    buyer: "Register, verify, provide address",
    dealership: null,
    staff: "Correct geocoding failures",
    system: "Verify, geocode, dedupe",
    // Both duties sit here: the buyer supplies the address, staff correct a
    // geocode that will not resolve. §26's "Onboarding location unusable" names
    // exactly that pair.
    ownerRole: "BUYER_OPERATIONS",
    seededInPhase: 2,
  },
  {
    stages: [3],
    label: "Prequalification",
    buyer: "Apply, consent",
    dealership: null,
    staff: "Manual and OFAC review, adverse action",
    system: "Pull, screen, decide, notify",
    ownerRole: "COMPLIANCE",
    seededInPhase: 2,
  },
  {
    stages: [4],
    label: "Vehicle, co-buyer, trade",
    buyer: "Define, elect",
    dealership: null,
    staff: null,
    system: "Validate criteria, revalidate inventory",
    ownerRole: "BUYER",
    seededInPhase: 4,
  },
  {
    stages: [5],
    label: "Payment",
    buyer: "Pay the $99 Standard plan, or add Premium",
    dealership: null,
    staff: "Reconciliation exceptions",
    system: "Charge once, unlock, open the upgrade window",
    ownerRole: "BUYER",
    seededInPhase: 3,
  },
  {
    stages: [6],
    label: "Sourcing",
    buyer: "Authorize radius if asked",
    dealership: null,
    staff: "Approve limited auctions, manual sourcing",
    system: "Search bands, validate, enrich",
    ownerRole: "OPERATIONS",
    seededInPhase: 5,
  },
  {
    stages: [7],
    label: "Auction",
    buyer: "Wait",
    dealership: "Receive invitation",
    staff: "Replace bounced contacts",
    system: "Launch, invite, remind, close",
    ownerRole: "OPERATIONS",
    seededInPhase: 5,
  },
  {
    stages: [8],
    label: "Offers",
    buyer: null,
    dealership: "Submit and revise offers",
    staff: "Review flagged offers",
    system: "Validate, rank, seal",
    ownerRole: "OPERATIONS",
    seededInPhase: 6,
  },
  {
    stages: [9],
    label: "Selection",
    buyer: "Select one offer, accept or decline Premium",
    dealership: null,
    staff: "Assign the concierge on upgrade",
    system: "Serialize single winner, create Deal, show the invitation once",
    ownerRole: "BUYER",
    seededInPhase: 6,
  },
  {
    stages: [10],
    label: "Reaffirmation",
    buyer: "Acknowledge condition",
    dealership: "Reaffirm, hold, disclose",
    staff: "Chase timeouts, verify outside winners",
    system: "Release identity, track hold",
    ownerRole: "OPERATIONS",
    seededInPhase: 7,
  },
  {
    stages: [11],
    label: "Recap",
    buyer: "Confirm numbers",
    dealership: "Confirm numbers",
    staff: "Resolve disputes",
    system: "Version and audit the recap",
    ownerRole: "OPERATIONS",
    seededInPhase: 7,
  },
  {
    stages: [12],
    label: "Financing terms",
    buyer: "Pursue financing",
    dealership: "Arrange if dealer path",
    staff: "Verify and record",
    system: "Track status and expiry",
    ownerRole: "OPERATIONS_FINANCE",
    seededInPhase: 7,
  },
  {
    stages: [13],
    label: "Contract",
    buyer: "Sign",
    dealership: "Prepare, upload, execute",
    staff: "Review holds, escalate overdue",
    system: "Shield, bind, sign, store",
    ownerRole: "OPERATIONS",
    seededInPhase: 8,
  },
  {
    stages: [14],
    label: "Funding",
    buyer: null,
    dealership: "Confirm funding, collect down payment",
    staff: "Record completion and clearance",
    system: "Block release until cleared",
    ownerRole: "FINANCE",
    seededInPhase: 8,
  },
  {
    stages: [15],
    label: "Insurance",
    buyer: "Provide proof",
    dealership: null,
    staff: "Verify",
    system: "Track status and expiry",
    ownerRole: "BUYER",
    seededInPhase: 8,
  },
  {
    stages: [16, 17],
    label: "Readiness, scheduling",
    buyer: "Propose time",
    dealership: "Confirm or counter, prepare vehicle",
    staff: "Schedule after two counters",
    system: "Evaluate checklist, issue token",
    ownerRole: "BUYER_DEALER",
    seededInPhase: 9,
  },
  {
    stages: [18],
    label: "Handover",
    buyer: "Inspect, present ID, pay dealer, surrender trade",
    dealership: "Verify, release, receive trade",
    staff: "Resolve blocks",
    system: "Validate token once",
    ownerRole: "OPERATIONS",
    seededInPhase: 9,
  },
  {
    stages: [19, 20],
    label: "Possession, completion",
    buyer: "Confirm possession",
    dealership: "Record release",
    staff: "Resolve discrepancies",
    system: "Commit completion atomically",
    ownerRole: "OPERATIONS",
    seededInPhase: 9,
  },
  {
    stages: [21],
    label: "Post-completion",
    buyer: "Report issues",
    dealership: "Deliver title, pay off trade, honor due-bill",
    staff: "Escalate overdue",
    system: "Track and notify",
    ownerRole: "OPERATIONS",
    seededInPhase: 9,
  },
];

/** §30's table, in document order. */
export const STAGE_RESPONSIBILITY: readonly StageResponsibility[] = ROWS;

const BY_STAGE = new Map<number, StageResponsibility>();
for (const row of ROWS) {
  for (const stage of row.stages) {
    if (BY_STAGE.has(stage)) throw new Error(`stage-responsibility: stage ${stage} is claimed twice`);
    BY_STAGE.set(stage, row);
  }
}

/** The responsibility row for a stage, or `undefined` for a stage outside 1–21. */
export function responsibilityForStage(stage: number): StageResponsibility | undefined {
  return BY_STAGE.get(stage);
}

/** Who owns the checkpoint at this stage — the `owner_role` for an exception raised here. */
export function ownerRoleForStage(stage: number): QueueOwnerRole | undefined {
  return BY_STAGE.get(stage)?.ownerRole;
}

/**
 * What the buyer is told they must do at this stage, or `null` where §30 gives the
 * buyer no duty. Buyer surfaces read this rather than each inventing its own copy.
 */
export function buyerDutyForStage(stage: number): string | null | undefined {
  const row = BY_STAGE.get(stage);
  return row ? row.buyer : undefined;
}
