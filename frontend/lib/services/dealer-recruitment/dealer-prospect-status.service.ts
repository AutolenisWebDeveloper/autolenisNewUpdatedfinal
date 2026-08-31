// Phase 2 — the dealer prospect status machine.
//
// Follows the shape already established by lib/services/deal/deal.service.ts:
// a TRANSITIONS table, a TERMINAL list, a pure canTransition(), and a guarded
// write. Same conventions, so a reader who knows one knows the other.
//
// DealerProspectStatus already carries every value used here, so nothing in this
// module requires a migration. DRAFTED is retained for forward compatibility and
// is deliberately not on the happy path — it has no writer today, and inventing
// transitions for a state nothing produces would be speculative.
//
// The write is an updateMany guarded on the CURRENT status. Two admins clicking
// at once (or a click racing an automated advance from the send path) then match
// zero rows on the loser, which surfaces as CONCURRENT_TRANSITION rather than
// silently applying twice. This is the same conditional-update pattern the
// Apollo credit ledger uses to make its cap safe under concurrency.

import { logger } from "@/lib/logger";
import { DealerProspectStatus, type PrismaClient } from "@prisma/client";
import { prisma as defaultPrisma } from "@/lib/prisma";

/**
 * Legal forward transitions. DEAD is handled in canTransition() rather than
 * listed here, because it is reachable from every non-terminal state and
 * repeating it in each row invites one row to drift.
 */
export const TRANSITIONS: Record<DealerProspectStatus, DealerProspectStatus[]> = {
  DISCOVERED: ["SCRIPTED"],
  SCRIPTED: ["CONTACTED"],
  // Kept for forward compatibility with an email-drafting phase. Nothing writes
  // it today; it can advance the same way SCRIPTED does.
  DRAFTED: ["CONTACTED"],
  CONTACTED: ["REPLIED"],
  REPLIED: ["ONBOARDED"],
  ONBOARDED: [],
  DEAD: [],
};

/** Nothing leaves these. A prospect that onboarded or died is finished. */
export const TERMINAL: DealerProspectStatus[] = [
  DealerProspectStatus.ONBOARDED,
  DealerProspectStatus.DEAD,
];

/** The timestamp column each status stamps on arrival. */
const ARRIVAL_TIMESTAMP: Partial<Record<DealerProspectStatus, string>> = {
  SCRIPTED: "scriptedAt",
  CONTACTED: "contactedAt",
  REPLIED: "repliedAt",
  ONBOARDED: "onboardedAt",
  DEAD: "deadAt",
};

export type TransitionError =
  | "NOT_FOUND"
  | "ILLEGAL_TRANSITION"
  | "DEAD_REASON_REQUIRED"
  | "CONCURRENT_TRANSITION";

export interface TransitionResult {
  ok: boolean;
  from?: DealerProspectStatus;
  to?: DealerProspectStatus;
  error?: TransitionError;
}

export interface TransitionInput {
  prospectId: string;
  to: DealerProspectStatus;
  /** Mandatory when `to` is DEAD. Trimmed; whitespace-only is not a reason. */
  deadReason?: string;
  actorId: string;
}

export interface StatusTransitionDeps {
  prisma: PrismaClient;
  now: Date;
  loadStatus: (prospectId: string) => Promise<DealerProspectStatus | null>;
  /** Guarded update. MUST return the number of rows matched. */
  applyTransition: (
    prospectId: string,
    from: DealerProspectStatus,
    to: DealerProspectStatus,
    data: Record<string, unknown>,
  ) => Promise<number>;
  writeAudit: (entry: {
    prospectId: string;
    actorId: string;
    from: DealerProspectStatus;
    to: DealerProspectStatus;
    deadReason: string | null;
    at: Date;
  }) => Promise<void>;
}

/** Pure. True when `from -> to` is a legal move. */
export function canTransition(from: DealerProspectStatus, to: DealerProspectStatus): boolean {
  if (from === to) return false;
  if (TERMINAL.includes(from)) return false;
  // A prospect can be marked dead from any live state.
  if (to === DealerProspectStatus.DEAD) return true;
  return TRANSITIONS[from]?.includes(to) ?? false;
}

async function defaultLoadStatus(
  prospectId: string,
  prisma: PrismaClient,
): Promise<DealerProspectStatus | null> {
  const row = await prisma.dealerProspect.findUnique({
    where: { id: prospectId },
    select: { status: true },
  });
  return row?.status ?? null;
}

async function defaultApplyTransition(
  prospectId: string,
  from: DealerProspectStatus,
  to: DealerProspectStatus,
  data: Record<string, unknown>,
  prisma: PrismaClient,
): Promise<number> {
  // Guarded on `status: from` — a concurrent transition matches zero rows.
  const res = await prisma.dealerProspect.updateMany({
    where: { id: prospectId, status: from },
    data: { status: to, ...data },
  });
  return res.count;
}

/**
 * Move a prospect to a new status.
 *
 * Returns a structured result rather than throwing, so a route can map the
 * reason onto a response code without string-matching an error message.
 */
export async function transitionProspect(
  input: TransitionInput,
  deps?: Partial<StatusTransitionDeps>,
): Promise<TransitionResult> {
  const prisma = deps?.prisma ?? defaultPrisma;
  const now = deps?.now ?? new Date();
  const loadStatus = deps?.loadStatus ?? ((id: string) => defaultLoadStatus(id, prisma));
  const applyTransition =
    deps?.applyTransition ??
    ((id: string, from: DealerProspectStatus, to: DealerProspectStatus, data: Record<string, unknown>) =>
      defaultApplyTransition(id, from, to, data, prisma));
  const writeAudit = deps?.writeAudit ?? (async () => {});

  const from = await loadStatus(input.prospectId);
  if (!from) return { ok: false, error: "NOT_FOUND" };

  // DEAD without a reason is refused BEFORE the legality check, so the operator
  // is told the actionable thing: supply a reason. A prospect marked dead with
  // no reason is a dead end nobody can audit or reverse.
  const deadReason = input.deadReason?.trim() || null;
  if (input.to === DealerProspectStatus.DEAD && !deadReason) {
    return { ok: false, from, error: "DEAD_REASON_REQUIRED" };
  }

  if (!canTransition(from, input.to)) {
    return { ok: false, from, to: input.to, error: "ILLEGAL_TRANSITION" };
  }

  const data: Record<string, unknown> = {};
  const stamp = ARRIVAL_TIMESTAMP[input.to];
  if (stamp) data[stamp] = now;
  if (input.to === DealerProspectStatus.DEAD) data.deadReason = deadReason;

  const matched = await applyTransition(input.prospectId, from, input.to, data);
  if (matched === 0) {
    logger.info(
      `[prospect-status] concurrent transition on ${input.prospectId}: ` +
        `expected ${from}, another writer moved it first`,
    );
    return { ok: false, from, to: input.to, error: "CONCURRENT_TRANSITION" };
  }

  await writeAudit({
    prospectId: input.prospectId,
    actorId: input.actorId,
    from,
    to: input.to,
    deadReason,
    at: now,
  });

  return { ok: true, from, to: input.to };
}
