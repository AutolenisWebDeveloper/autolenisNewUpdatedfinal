// §Stage 21 — post-completion dealership obligations.
//
//   "Tracked as child records of the completed Deal, WITHOUT REOPENING OR ALTERING IT."
//
// That clause is the design. §Stage 20 makes COMPLETED terminal and corrections append-only, so
// an obligation may never move the Deal's status, clear `completed_at`, or write to the Deal at
// all. Everything here writes `post_completion_obligations` and nothing else — which is also why
// an overdue obligation raises a §26 exception rather than "reopening" the deal: the queue is
// where a human picks it up, and the Deal stays completed while they do.
//
// FIVE TYPES, VERBATIM FROM THE DOCUMENT'S LIST, and one of them is not what it looks like.
// "Dealership correction of transaction documents" is a DEALERSHIP obligation to fix its own
// paperwork; it is not a correction to the AutoLenis record, which is `DealCorrection` and
// append-only. Two different things, and conflating them would let an obligation edit history.
//
// THE MODEL ALREADY EXISTED AND HAD NEVER HAD A WRITER. `PostCompletionObligation` arrived with
// the Phase 1 transaction spine — `type`, `status`, `owner_role`, `due_at`, `expected_date`,
// `temp_tag_expires_at`, `evidence`, `resolved_at`, `notes` — and nothing in the application
// read or wrote it. This service is its first writer, so every field below is chosen against the
// document's sentence rather than against an existing usage.
//
// "PENDING, OVERDUE, or RESOLVED" IS A DERIVED TRANSITION, NOT A FOURTH STATE. Nothing writes
// OVERDUE at creation time; the sweep moves PENDING → OVERDUE when `due_at` passes, and that
// transition is what fires the notifications, the escalation and the scorecard entry. An
// obligation resolved before its due date never becomes OVERDUE at all.

import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { logger } from "@/lib/logger";
import { raiseException } from "@/lib/services/operations/queue-item.service";
import { enqueueTransactional } from "@/lib/services/comms/transactional-dispatcher.service";
import { POST_COMPLETION_TEMPLATES } from "@/lib/services/comms/state-recheck-registry";

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL ?? "https://autolenis.com").trim();

/**
 * §Stage 21's five obligations, in the document's order.
 *
 * `defaultDueDays` is the platform's chase window, not a contractual term — the dealership's
 * own commitment governs, and `dueAt` is passed explicitly when one is known. Title and
 * registration lead because a temporary tag expires: a buyer driving on an expired tag is the
 * concrete harm this whole stage exists to prevent.
 */
export const OBLIGATION_TYPES = {
  TITLE_AND_REGISTRATION: {
    key: "TITLE_AND_REGISTRATION",
    label: "Title and registration delivery",
    defaultDueDays: 30,
  },
  TRADE_PAYOFF: {
    key: "TRADE_PAYOFF",
    label: "Trade payoff completion",
    defaultDueDays: 10,
  },
  DUE_BILL_REPAIRS: {
    key: "DUE_BILL_REPAIRS",
    label: "Due-bill repairs and promised equipment",
    defaultDueDays: 30,
  },
  MISSING_ACCESSORIES: {
    key: "MISSING_ACCESSORIES",
    label: "Missing accessories or second keys",
    defaultDueDays: 14,
  },
  DOCUMENT_CORRECTION: {
    key: "DOCUMENT_CORRECTION",
    label: "Dealership correction of transaction documents",
    defaultDueDays: 7,
  },
} as const;

export type ObligationTypeKey = keyof typeof OBLIGATION_TYPES;

/** §Stage 21's count, asserted rather than trusted — the same reason as Stage 16's and 20's. */
export const STAGE_21_OBLIGATION_TYPE_COUNT = 5;

export interface OpenObligationInput {
  dealId: string;
  type: ObligationTypeKey;
  /** The dealership's own commitment, when there is one. Falls back to the chase window. */
  dueAt?: Date | null;
  /** §Stage 21: "with the expected date". What the dealership said, as distinct from the chase. */
  expectedDate?: Date | null;
  /** §Stage 21: "and the buyer's temporary tag expiry". Title and registration only. */
  tempTagExpiresAt?: Date | null;
  notes?: string | null;
  evidence?: Prisma.InputJsonValue | null;
  now?: Date;
}

/**
 * Open one obligation against a COMPLETED deal.
 *
 * IDEMPOTENT PER (deal, type). Two calls for the same obligation on the same deal return the
 * existing row rather than a second one — a buyer who reports a missing second key twice has one
 * obligation, not two, and a duplicate would double-count on the dealership's scorecard.
 *
 * REFUSES A DEAL THAT IS NOT COMPLETE, and that is not pedantry. An obligation opened before
 * completion would be indistinguishable from one of §Stage 20's fourteen preconditions, and the
 * two have opposite meanings: a precondition BLOCKS completion, an obligation exists only
 * because completion already happened.
 */
export async function openObligation(
  input: OpenObligationInput,
  db: typeof prisma | Prisma.TransactionClient = prisma,
): Promise<{ ok: true; id: string; created: boolean } | { ok: false; reason: "deal_missing" | "not_completed" }> {
  const now = input.now ?? new Date();
  const spec = OBLIGATION_TYPES[input.type];

  const deal = await db.deal.findUnique({
    where: { id: input.dealId },
    select: { id: true, status: true },
  });
  if (!deal) return { ok: false, reason: "deal_missing" };
  if (deal.status !== "COMPLETED") return { ok: false, reason: "not_completed" };

  const existing = await db.postCompletionObligation.findFirst({
    where: { dealId: input.dealId, type: spec.key, status: { not: "RESOLVED" } },
    select: { id: true },
  });
  if (existing) return { ok: true, id: existing.id, created: false };

  const row = await db.postCompletionObligation.create({
    data: {
      id: randomUUID(),
      dealId: input.dealId,
      type: spec.key,
      status: "PENDING",
      // §Stage 21: "with an owner and a due date". The owner is always the dealership —
      // "The dealership remains responsible for performance. AutoLenis tracks status and
      // communication." Recording AutoLenis as the owner would make the tracker claim the work.
      ownerRole: "DEALERSHIP",
      dueAt: input.dueAt ?? new Date(now.getTime() + spec.defaultDueDays * 24 * 60 * 60 * 1000),
      expectedDate: input.expectedDate ?? null,
      tempTagExpiresAt: input.tempTagExpiresAt ?? null,
      notes: input.notes ?? null,
      ...(input.evidence !== undefined && input.evidence !== null ? { evidence: input.evidence } : {}),
    },
    select: { id: true },
  });
  return { ok: true, id: row.id, created: true };
}

/**
 * Resolve an obligation. RESOLVED is terminal; an already-resolved one is not re-resolved.
 *
 * NO ROUTE AND NO CALLER YET, AND THAT IS STATED RATHER THAN LEFT TO BE DISCOVERED. §Stage 21
 * tracks obligations and chases them; the control that marks one resolved is an authenticated
 * write against a COMPLETED transaction, which needs its authorization scoped deliberately —
 * who may resolve, on whose behalf, and with what evidence. Until that batch exists, Operations
 * resolves from the overdue queue item and this function is the seam they will call.
 *
 * The overdue email says exactly that, rather than linking a dealership to a control that is
 * not there.
 */
export async function resolveObligation(
  obligationId: string,
  params: { notes?: string | null; evidence?: Prisma.InputJsonValue | null; now?: Date } = {},
): Promise<boolean> {
  const now = params.now ?? new Date();
  const res = await prisma.postCompletionObligation.updateMany({
    where: { id: obligationId, status: { not: "RESOLVED" } },
    data: {
      status: "RESOLVED",
      resolvedAt: now,
      ...(params.notes !== undefined && params.notes !== null ? { notes: params.notes } : {}),
      ...(params.evidence !== undefined && params.evidence !== null ? { evidence: params.evidence } : {}),
    },
  });
  return res.count === 1;
}

export interface OverdueSweepResult {
  scanned: number;
  markedOverdue: number;
  notified: number;
  escalated: number;
  failed: number;
}

const SWEEP_BATCH_LIMIT = 200;

/**
 * §Stage 21: "Overdue obligations notify the buyer and the dealership, escalate to Operations,
 * and register on the dealership scorecard."
 *
 * FOUR CONSEQUENCES, ONE TRANSITION. The PENDING → OVERDUE compare-and-swap is what makes them
 * fire exactly once: a second sweep an hour later matches zero rows and sends nothing. Without
 * the swap an overdue obligation would notify both parties on every run until somebody resolved
 * it, which is how a chase becomes a reason to mute the sender.
 *
 * THE SCORECARD IS NOT WRITTEN HERE, AND THAT IS DELIBERATE. `computeDealerScorecard` derives
 * every one of its metrics from the underlying rows at read time; a counter incremented here
 * would be a second copy of a fact the obligation rows already carry, and the two would disagree
 * the first time an obligation was resolved late or reopened. The scorecard counts OVERDUE rows,
 * so the swap below IS the scorecard entry.
 *
 * ORDER MATTERS. The swap commits BEFORE the notifications: a crash after the swap costs one
 * chase message, while a crash after notifying but before swapping re-sends it on every run
 * forever. Losing a message is recoverable; a notification loop is what gets a sender blocked.
 */
export async function sweepOverdueObligations(
  now: Date = new Date(),
): Promise<OverdueSweepResult> {
  const due = await prisma.postCompletionObligation.findMany({
    where: { status: "PENDING", dueAt: { not: null, lt: now } },
    take: SWEEP_BATCH_LIMIT,
    select: {
      id: true,
      type: true,
      dueAt: true,
      dealId: true,
      deal: {
        select: {
          id: true,
          buyerId: true,
          dealerId: true,
          buyer: { select: { firstName: true, user: { select: { email: true } } } },
          offer: { select: { dealerId: true, dealer: { select: { dealershipName: true, user: { select: { email: true } } } } } },
        },
      },
    },
  });

  const result: OverdueSweepResult = {
    scanned: due.length,
    markedOverdue: 0,
    notified: 0,
    escalated: 0,
    failed: 0,
  };

  for (const ob of due) {
    try {
      const swap = await prisma.postCompletionObligation.updateMany({
        where: { id: ob.id, status: "PENDING" },
        data: { status: "OVERDUE" },
      });
      // Another sweep won the row. Its own iteration sends the notifications.
      if (swap.count === 0) continue;
      result.markedOverdue += 1;

      const label = OBLIGATION_TYPES[ob.type as ObligationTypeKey]?.label ?? ob.type;
      const dealerId = ob.deal?.dealerId ?? ob.deal?.offer?.dealerId ?? null;
      const buyerEmail = ob.deal?.buyer?.user?.email ?? null;
      const dealerEmail = ob.deal?.offer?.dealer?.user?.email ?? null;
      const dealershipName = ob.deal?.offer?.dealer?.dealershipName ?? "the dealership";

      if (buyerEmail && ob.deal) {
        await enqueueTransactional({
          triggerEvent: "post_completion_obligation_overdue",
          templateKey: POST_COMPLETION_TEMPLATES.OBLIGATION_OVERDUE_BUYER,
          channel: "email",
          recipientKind: "buyer",
          recipientId: ob.deal.buyerId,
          to: buyerEmail,
          dealId: ob.dealId,
          idempotencyKey: `${POST_COMPLETION_TEMPLATES.OBLIGATION_OVERDUE_BUYER}:${ob.id}`,
          payload: {
            // Read by `skipIfObligationResolved`; inert to the mail rail. See its comment.
            obligationId: ob.id,
            email: buyerEmail,
            type: "transactional",
            subject: `We're chasing ${dealershipName} on your ${label.toLowerCase()}`,
            html:
              `<p>Hi ${ob.deal.buyer?.firstName ?? "there"},</p>` +
              `<p><strong>${label}</strong> from your purchase is now overdue. The dealership is ` +
              `responsible for it; we have escalated internally and are chasing them.</p>` +
              `<p>You do not need to do anything — we will update you.</p>` +
              `<p><a href="${APP_URL}/buyer/deals/${ob.dealId}">See the details</a></p>`,
          },
        });
        result.notified += 1;
      }

      if (dealerEmail && dealerId) {
        await enqueueTransactional({
          triggerEvent: "post_completion_obligation_overdue",
          templateKey: POST_COMPLETION_TEMPLATES.OBLIGATION_OVERDUE_DEALER,
          channel: "email",
          recipientKind: "dealer",
          recipientId: dealerId,
          to: dealerEmail,
          dealId: ob.dealId,
          idempotencyKey: `${POST_COMPLETION_TEMPLATES.OBLIGATION_OVERDUE_DEALER}:${ob.id}`,
          payload: {
            obligationId: ob.id,
            email: dealerEmail,
            type: "transactional",
            subject: `Overdue: ${label}`,
            // NO "UPDATE THE STATUS" LINK, BECAUSE THERE IS NOTHING BEHIND IT. Found by the
            // Phase 9 adversarial review: `resolveObligation` has no route, no authorization and
            // no caller, so the first draft of this email sent a dealership to a page with no
            // control on it. A message that promises an action the product cannot perform is
            // worse than one that asks for a reply — it spends the recipient's trust to save the
            // sender a sentence.
            //
            // The dealer-facing resolution control is REPORTED as the next step for this stage,
            // not built here: it is an authenticated write surface on a completed transaction and
            // belongs in a batch that can scope its authorization properly.
            html:
              `<p><strong>${label}</strong> on a completed AutoLenis transaction is past its due ` +
              `date${ob.dueAt ? ` of ${ob.dueAt.toISOString().slice(0, 10)}` : ""}.</p>` +
              `<p>Overdue obligations register on your dealership scorecard. Resolving this one ` +
              `clears the entry.</p>` +
              `<p>Reply to this email with the current status and our Operations team will update ` +
              `the record.</p>`,
          },
        });
        result.notified += 1;
      }

      await raiseException({
        code: "POST_COMPLETION_OBLIGATION_OVERDUE",
        dealId: ob.dealId,
        buyerId: ob.deal?.buyerId ?? null,
        dealerId,
        // One exception per OBLIGATION, not per deal. A deal with an overdue title and an
        // overdue payoff is two problems for two different people to chase.
        idempotencyKey: `POST_COMPLETION_OBLIGATION_OVERDUE:${ob.id}`,
        detail: `${label} is overdue${ob.dueAt ? ` (due ${ob.dueAt.toISOString().slice(0, 10)})` : ""}.`,
      });
      result.escalated += 1;
    } catch (e) {
      result.failed += 1;
      logger.error(`[post-completion-obligations] sweep failed obligation=${ob.id}:`, e);
    }
  }

  return result;
}

/**
 * How many obligations a dealership currently has overdue, and how many it has had.
 *
 * READ AT READ TIME, from the rows themselves — see the note on the sweep. `resolvedLate` counts
 * obligations that reached OVERDUE and were then resolved: a dealership that fixes everything
 * eventually still kept buyers waiting, and a scorecard that forgot that would reward the
 * pattern §Stage 21 exists to surface.
 */
export async function dealerObligationRecord(
  dealerId: string,
  since?: Date,
): Promise<{ openOverdue: number; resolvedLate: number; totalOpened: number }> {
  const dealFilter = {
    OR: [{ dealerId }, { offer: { dealerId } }],
    ...(since ? { completedAt: { gte: since } } : {}),
  };

  const [openOverdue, totalOpened, lateRows] = await Promise.all([
    prisma.postCompletionObligation.count({ where: { status: "OVERDUE", deal: dealFilter } }),
    prisma.postCompletionObligation.count({ where: { deal: dealFilter } }),
    // RESOLVED AFTER ITS DUE DATE — and that is a comparison BETWEEN TWO COLUMNS, which Prisma's
    // `where` cannot express. Counting resolved rows that merely HAVE both dates would count
    // every obligation the dealership handled on time as a late one, which is the opposite of
    // what the scorecard is for. Raw SQL, with the dealer id parameterised.
    prisma.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
      SELECT count(*)::bigint AS count
        FROM post_completion_obligations o
        JOIN deals d ON d.id = o.deal_id
        LEFT JOIN offers f ON f.id = d.offer_id
       WHERE o.status = 'RESOLVED'
         AND o.due_at IS NOT NULL
         AND o.resolved_at IS NOT NULL
         AND o.resolved_at > o.due_at
         AND (d.dealer_id = ${dealerId} OR f.dealer_id = ${dealerId})
         ${since ? Prisma.sql`AND d.completed_at >= ${since}` : Prisma.empty}
    `),
  ]);

  return { openOverdue, resolvedLate: Number(lateRows[0]?.count ?? 0), totalOpened };
}
