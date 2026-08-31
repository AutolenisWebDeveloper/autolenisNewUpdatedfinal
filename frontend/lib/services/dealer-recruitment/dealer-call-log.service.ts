// Phase 3 / Task 8b — manual call logging. The SHIPPING deliverable of Phase 3.
//
// Phone coverage across dealer_prospects is 1,527/1,532 (99.7%); email coverage
// is 167 (10.9%). The phone numbers are the addressable audience, and a human
// picking up the phone needs no consent basis: TCPA governs automated messaging
// and dialling, not an operator recording that a call took place. So this ships
// ENABLED while sendDealerSms ships off.
//
// TWO GATES ARE DELIBERATELY NOT APPLIED, and the distinction is the design:
//
//   the send flag  gates DISPATCH. Nothing here is dispatched — a human already
//                  made the call, and this records that fact.
//   dnc_status     gates DIALLING. Refusing to RECORD a call that already
//                  happened would delete the evidence rather than prevent the
//                  act. A call that should not have been made is exactly the one
//                  that must be on the record.
//
// What IS validated is the data: an unrecognised disposition or an impossible
// duration is refused, because a log nobody can trust is worse than no log.

import { logger } from "@/lib/logger";
import type { PrismaClient } from "@prisma/client";
import { prisma as defaultPrisma } from "@/lib/prisma";

export const CALL_DISPOSITIONS = [
  "CONNECTED",
  "VOICEMAIL",
  "NO_ANSWER",
  "BUSY",
  "WRONG_NUMBER",
  "GATEKEEPER",
  "NOT_INTERESTED",
  "CALLBACK_REQUESTED",
] as const;

export type CallDisposition = (typeof CALL_DISPOSITIONS)[number];

/**
 * Dispositions that mean a human actually spoke to someone at the dealership.
 * Only these advance the prospect — a voicemail is an attempt, not a contact,
 * and treating it as one would inflate the funnel with unanswered calls.
 */
export const CONNECTED_DISPOSITIONS: readonly CallDisposition[] = [
  "CONNECTED",
  "GATEKEEPER",
  "NOT_INTERESTED",
  "CALLBACK_REQUESTED",
];

/** Statuses a connecting call may advance FROM. Never moves a prospect back. */
const ADVANCEABLE_FROM = ["DISCOVERED", "SCRIPTED", "DRAFTED"];

/**
 * The consent basis recorded on a manual call row.
 *
 * Not null: null on a phone-channel row is indistinguishable from "nobody
 * considered consent". This says explicitly that the basis was an operator's own
 * action, which is what an audit needs to see.
 */
export const MANUAL_CALL_CONSENT_BASIS = "MANUAL_CALL";

export type CallLogError = "NOT_FOUND" | "INVALID_DISPOSITION" | "INVALID_DURATION";

export interface LogDealerCallInput {
  prospectId: string;
  disposition: CallDisposition;
  durationSeconds: number;
  notes?: string;
  actorId: string;
}

export interface LogDealerCallResult {
  ok: boolean;
  logId?: string;
  error?: CallLogError;
}

export interface DealerCallLogDeps {
  prisma: PrismaClient;
  now: Date;
  /** Present so the absence of a dispatch gate is explicit rather than implied. */
  sendEnabled: () => boolean;
  loadProspect: (id: string) => Promise<{ id: string; status: string; phone: string | null } | null>;
  createLog: (data: Record<string, unknown>) => Promise<{ id: string }>;
  advanceStatus: (prospectId: string, to: string, from: string) => Promise<boolean>;
}

/**
 * Record one completed call against a prospect.
 *
 * Never throws for an expected condition; returns a structured reason so a route
 * can map it to a status code without string-matching.
 */
export async function logDealerCall(
  input: LogDealerCallInput,
  deps?: Partial<DealerCallLogDeps>,
): Promise<LogDealerCallResult> {
  const prisma = deps?.prisma ?? defaultPrisma;
  const now = deps?.now ?? new Date();
  const createLog =
    deps?.createLog ??
    (async (data: Record<string, unknown>) =>
      prisma.dealerOutreachLog.create({
        data: data as never,
        select: { id: true },
      }));
  const loadProspect =
    deps?.loadProspect ??
    (async (id: string) =>
      prisma.dealerProspect.findUnique({
        where: { id },
        select: { id: true, status: true, phone: true },
      }));
  const advanceStatus = deps?.advanceStatus;

  if (!(CALL_DISPOSITIONS as readonly string[]).includes(input.disposition)) {
    return { ok: false, error: "INVALID_DISPOSITION" };
  }
  if (!Number.isFinite(input.durationSeconds) || input.durationSeconds < 0) {
    return { ok: false, error: "INVALID_DURATION" };
  }

  const prospect = await loadProspect(input.prospectId);
  if (!prospect) return { ok: false, error: "NOT_FOUND" };

  const notes = input.notes?.trim() || null;

  const row = await createLog({
    dealerProspectId: prospect.id,
    outreachType: "call",
    channel: "CALL",
    status: "sent", // the call happened; there is no pending state for it
    toPhone: prospect.phone,
    body: notes,
    callDisposition: input.disposition,
    callDurationSeconds: Math.floor(input.durationSeconds),
    consentBasis: MANUAL_CALL_CONSENT_BASIS,
    sentAt: now,
    metadata: { actorId: input.actorId },
  });

  // A connecting call advances the prospect, but only forward. The advance is
  // best-effort: the call HAPPENED, and a bookkeeping failure downstream must
  // never erase the record of it.
  if (
    advanceStatus &&
    CONNECTED_DISPOSITIONS.includes(input.disposition) &&
    ADVANCEABLE_FROM.includes(prospect.status)
  ) {
    try {
      await advanceStatus(prospect.id, "CONTACTED", prospect.status);
    } catch (err) {
      logger.warn(
        `[dealer-call] logged call ${row.id} but status advance failed for ${prospect.id}:`,
        err,
      );
    }
  }

  logger.info(
    `[dealer-call] ${input.disposition} logged for prospect ${prospect.id} (${Math.floor(input.durationSeconds)}s)`,
  );
  return { ok: true, logId: row.id };
}
