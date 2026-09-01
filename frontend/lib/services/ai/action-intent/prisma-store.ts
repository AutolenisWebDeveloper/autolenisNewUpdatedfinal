// lib/services/ai/action-intent/prisma-store.ts
//
// Durable, cross-request/cross-process persistence for the ActionIntent
// lifecycle, backed by the `ai_action_intents` table. This is what makes the
// proposal → approval → execution boundary survive real requests, retries, and
// process restarts.
//
// The exactly-once guarantee is a SERVER-AUTHORITATIVE atomic claim: every
// lifecycle transition is a single conditional `updateMany(where id AND
// status=from → status=to)`; Postgres row locking makes exactly one concurrent
// writer see `count === 1` and every loser see `count === 0`. The canonical
// command therefore cannot be invoked twice for one intent even under
// concurrent approvals, HTTP/queue replay, or a restart between approval and
// execution. This mirrors the repo's webhook idempotency claim
// (`updateMany(processed:false→true)` count-0 = duplicate).
//
// The store depends only on a minimal delegate interface so it is unit-testable
// with a fake that models conditional-update semantics; the real `prisma`
// client is injected by `createDurableEngineDeps`.

import type { ActionIntentStore } from "./store";
import type { ActionIntentRecord, ActionIntentStatus } from "./types";
import { ActionIntentRejected } from "./types";
import type { EngineDeps } from "./engine";
import { defaultPolicyDeps } from "./policy";
import { COMMANDS } from "./commands";
import { auditLogRecorder } from "./store";
import { featureFlagActivationResolver, isActionIntentSurfaceEnabled } from "./activation";

/**
 * Raised when the durable ActionIntent store is asked to touch ai_action_intents
 * while the surface is dormant — i.e. while migration 20261016 must be assumed
 * unapplied. Fail-closed and explicit, never a silent success.
 */
export class ActionIntentStoreUnavailableError extends Error {
  code = "ACTION_INTENT_STORE_UNAVAILABLE";
  constructor() {
    super(
      "The durable ActionIntent store is unavailable: ACTION_INTENT_EXECUTION_ENABLED is off, " +
        "so migration 20261016 (ai_action_intents) must be assumed unapplied.",
    );
    this.name = "ActionIntentStoreUnavailableError";
  }
}

// ─── Minimal delegate the store needs (structurally satisfied by prisma.aiActionIntent) ─
export interface AiActionIntentRow {
  id: string;
  intentType: string;
  status: string;
  actorType: string;
  actorId: string;
  authenticatedRole: string;
  subjectId: string | null;
  parameters: unknown;
  consequence: string;
  requiresHumanApproval: boolean;
  idempotencyKey: string | null;
  rationale: string | null;
  policyResult: unknown;
  approverId: string | null;
  approverRole: string | null;
  approvedAt: Date | null;
  rejectedAt: Date | null;
  rejectionCode: string | null;
  executionClaimedAt: Date | null;
  executionAttempts: number;
  result: unknown;
  failureReason: string | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface AiActionIntentDelegate {
  create(args: { data: Record<string, unknown> }): Promise<AiActionIntentRow>;
  findUnique(args: { where: Record<string, unknown> }): Promise<AiActionIntentRow | null>;
  findFirst(args: { where: Record<string, unknown> }): Promise<AiActionIntentRow | null>;
  updateMany(args: { where: Record<string, unknown>; data: Record<string, unknown> }): Promise<{ count: number }>;
  findMany(args: { where: Record<string, unknown>; orderBy?: unknown; take?: number }): Promise<AiActionIntentRow[]>;
}

function rowToRecord(row: AiActionIntentRow): ActionIntentRecord {
  return {
    id: row.id,
    intentType: row.intentType,
    status: row.status as ActionIntentStatus,
    actorType: row.actorType as ActionIntentRecord["actorType"],
    actorId: row.actorId,
    authenticatedRole: row.authenticatedRole as ActionIntentRecord["authenticatedRole"],
    subjectId: row.subjectId ?? undefined,
    parameters: (row.parameters ?? {}) as Record<string, unknown>,
    consequence: row.consequence as ActionIntentRecord["consequence"],
    requiresHumanApproval: row.requiresHumanApproval,
    idempotencyKey: row.idempotencyKey ?? undefined,
    rationale: row.rationale ?? undefined,
    policyResult: (row.policyResult ?? undefined) as Record<string, unknown> | undefined,
    approverId: row.approverId ?? undefined,
    approverRole: row.approverRole ?? undefined,
    rejectionCode: (row.rejectionCode ?? undefined) as ActionIntentRecord["rejectionCode"],
    failureReason: row.failureReason ?? undefined,
    result: (row.result ?? undefined) as Record<string, unknown> | undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "P2002";
}

// Extra durable columns set as a side effect of entering a status. These are
// authoritative timestamps/claims, not model-provided.
function statusStamps(to: ActionIntentStatus): Record<string, unknown> {
  switch (to) {
    case "APPROVED":
      return { approvedAt: new Date() };
    case "REJECTED":
      return { rejectedAt: new Date() };
    case "EXECUTING":
      // The execution CLAIM: stamp the claim time and increment the attempt
      // counter atomically as part of the same conditional update.
      return { executionClaimedAt: new Date(), executionAttempts: { increment: 1 } };
    case "COMPLETED":
      return { completedAt: new Date() };
    default:
      return {};
  }
}

function patchToData(patch: Partial<ActionIntentRecord>): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  if (patch.approverId !== undefined) data.approverId = patch.approverId;
  if (patch.approverRole !== undefined) data.approverRole = patch.approverRole;
  if (patch.rejectionCode !== undefined) data.rejectionCode = patch.rejectionCode;
  if (patch.failureReason !== undefined) data.failureReason = patch.failureReason;
  if (patch.result !== undefined) data.result = patch.result;
  if (patch.policyResult !== undefined) data.policyResult = patch.policyResult;
  return data;
}

export class PrismaActionIntentStore implements ActionIntentStore {
  constructor(private readonly delegate: AiActionIntentDelegate) {}

  async create(
    input: Omit<ActionIntentRecord, "createdAt" | "updatedAt"> & { createdAt?: Date; updatedAt?: Date },
  ): Promise<ActionIntentRecord> {
    try {
      const row = await this.delegate.create({
        data: {
          id: input.id,
          intentType: input.intentType,
          status: input.status,
          actorType: input.actorType,
          actorId: input.actorId,
          authenticatedRole: input.authenticatedRole,
          subjectId: input.subjectId ?? null,
          parameters: input.parameters,
          consequence: input.consequence,
          requiresHumanApproval: input.requiresHumanApproval,
          idempotencyKey: input.idempotencyKey ?? null,
          rationale: input.rationale ?? null,
          policyResult: input.policyResult ?? undefined,
        },
      });
      return rowToRecord(row);
    } catch (err) {
      // Concurrent duplicate proposal (same idempotency key): the DB unique
      // index rejected the second insert — return the existing record.
      if (isUniqueViolation(err) && input.idempotencyKey) {
        const existing = await this.findByIdempotencyKey(input.idempotencyKey);
        if (existing) return existing;
      }
      throw err;
    }
  }

  async get(id: string): Promise<ActionIntentRecord | null> {
    const row = await this.delegate.findUnique({ where: { id } });
    return row ? rowToRecord(row) : null;
  }

  async findByIdempotencyKey(key: string): Promise<ActionIntentRecord | null> {
    const row = await this.delegate.findUnique({ where: { idempotencyKey: key } });
    return row ? rowToRecord(row) : null;
  }

  async transition(
    id: string,
    from: ActionIntentStatus,
    to: ActionIntentStatus,
    patch: Partial<ActionIntentRecord> = {},
  ): Promise<ActionIntentRecord> {
    // Atomic conditional claim: exactly one concurrent writer wins.
    const res = await this.delegate.updateMany({
      where: { id, status: from },
      data: { status: to, ...patchToData(patch), ...statusStamps(to) },
    });
    if (res.count !== 1) {
      throw new ActionIntentRejected(
        "INVALID_STATE",
        `Cannot transition ${id} from ${from} to ${to}: record was not in ${from} (concurrent writer or wrong state).`,
      );
    }
    const row = await this.delegate.findUnique({ where: { id } });
    if (!row) throw new ActionIntentRejected("INVALID_STATE", `Record ${id} vanished after transition.`);
    return rowToRecord(row);
  }

  async listByStatus(status: ActionIntentStatus): Promise<ActionIntentRecord[]> {
    const rows = await this.delegate.findMany({ where: { status }, orderBy: { createdAt: "asc" }, take: 200 });
    return rows.map(rowToRecord);
  }
}

// A delegate that lazily resolves the real prisma singleton on each call, so
// importing this module never pulls prisma at load time (keeps the core + its
// unit tests hermetic). The engine tests inject a fake delegate instead.
function prismaDelegate(): AiActionIntentDelegate {
  const load = async () => {
    // Deploy-ahead-of-migration guard. Migration 20261016 (ai_action_intents +
    // the AiActionIntentStatus enum) is authored but NOT applied to production,
    // so every query here would fail with 42P01 (undefined_table). The surface is
    // already dormant behind ACTION_INTENT_EXECUTION_ENABLED and no production
    // caller reaches this today, but proposeIntent consults the store for an
    // idempotency key BEFORE authorization runs its activation check — so the
    // gate is repeated here, at the last point before the query is issued. A
    // named error is raised rather than an opaque Postgres error, and it can only
    // be hit by wiring up a caller while the surface is off.
    if (!isActionIntentSurfaceEnabled()) {
      throw new ActionIntentStoreUnavailableError();
    }
    return (await import("@/lib/prisma")).prisma.aiActionIntent as unknown as AiActionIntentDelegate;
  };
  return {
    create: async (a) => (await load()).create(a),
    findUnique: async (a) => (await load()).findUnique(a),
    findFirst: async (a) => (await load()).findFirst(a),
    updateMany: async (a) => (await load()).updateMany(a),
    findMany: async (a) => (await load()).findMany(a),
  };
}

function durableId(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  return c?.randomUUID ? c.randomUUID() : `ai-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
}

/**
 * Production-capable engine wiring: durable Prisma store + real audit trail +
 * fail-closed env activation + real policy reads + canonical commands. Ships
 * DORMANT — activation gates every execution, so no rows are written until an
 * actor+intent is owner-activated. Routes use this.
 */
export function createDurableEngineDeps(overrides: Partial<EngineDeps> = {}): EngineDeps {
  return {
    store: overrides.store ?? new PrismaActionIntentStore(prismaDelegate()),
    audit: overrides.audit ?? auditLogRecorder,
    // PRODUCTION ACTIVATION resolves through the FeatureFlag substrate, so an
    // owner can enable — or KILL — one capability at a time without a redeploy.
    //
    // It must be the same authority everywhere the durable engine is used.
    // Proposal ran through the flag while approval revalidated through the env
    // resolver, which meant flipping a capability off at runtime did not stop an
    // intent that had already been proposed from executing once approved.
    // `featureFlagActivationResolver` fails closed exactly as the env resolver
    // does: an absent flag row is `false`, and the master flag must also be on.
    activation: overrides.activation ?? featureFlagActivationResolver(),
    policyDeps: overrides.policyDeps ?? defaultPolicyDeps(),
    commands: overrides.commands ?? COMMANDS,
    genId: overrides.genId ?? durableId,
  };
}
