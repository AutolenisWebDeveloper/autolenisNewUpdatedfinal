// lib/services/ai/action-intent/store.ts
//
// Persistence boundary for ActionIntent records + the audit trail.
//
// Two concerns, deliberately separated:
//   1. ActionIntentStore — the MUTABLE lifecycle record (PROPOSED → … →
//      COMPLETED). Because the layer ships DORMANT (no production execution),
//      the default active store is in-memory. A durable Prisma-backed store
//      requires a new table and is therefore the single OWNER-GATED item
//      needed before production activation (see the port contract below).
//   2. ActionIntentAuditRecorder — the IMMUTABLE decision-boundary trail. This
//      reuses the EXISTING append-only `AuditLog` table via the same proven
//      convention as `writeDealerAudit` (action=STATUS_CHANGE, real detail in
//      metadata). No schema change, tamper-evident (DB append-only trigger).

import type {
  ActionIntentRecord,
  ActionIntentStatus,
  ActorContext,
  RejectionCode,
} from "./types";
import { ActionIntentRejected } from "./types";

// ─── Store port ──────────────────────────────────────────────────────────────
export interface ActionIntentStore {
  create(
    record: Omit<ActionIntentRecord, "createdAt" | "updatedAt"> & { createdAt?: Date; updatedAt?: Date },
  ): Promise<ActionIntentRecord>;
  get(id: string): Promise<ActionIntentRecord | null>;
  findByIdempotencyKey(key: string): Promise<ActionIntentRecord | null>;
  /**
   * Compare-and-swap transition. Advances the record from `from` to `to` ONLY
   * if it is currently in `from`; otherwise throws INVALID_STATE. This is the
   * single-execution guarantee: two concurrent executes of the same record
   * cannot both win.
   */
  transition(
    id: string,
    from: ActionIntentStatus,
    to: ActionIntentStatus,
    patch?: Partial<ActionIntentRecord>,
  ): Promise<ActionIntentRecord>;
  listByStatus(status: ActionIntentStatus): Promise<ActionIntentRecord[]>;
}

// ─── In-memory store (default; used in tests and while dormant) ──────────────
export class InMemoryActionIntentStore implements ActionIntentStore {
  private readonly byId = new Map<string, ActionIntentRecord>();
  private readonly byIdemKey = new Map<string, string>();

  async create(
    input: Omit<ActionIntentRecord, "createdAt" | "updatedAt"> & { createdAt?: Date; updatedAt?: Date },
  ): Promise<ActionIntentRecord> {
    if (input.idempotencyKey) {
      const existingId = this.byIdemKey.get(input.idempotencyKey);
      if (existingId) {
        const existing = this.byId.get(existingId);
        if (existing) return existing; // collapse duplicate proposal
      }
    }
    const now = new Date(0); // deterministic; callers stamp real time if needed
    const record: ActionIntentRecord = {
      ...input,
      createdAt: input.createdAt ?? now,
      updatedAt: input.updatedAt ?? now,
    };
    this.byId.set(record.id, record);
    if (record.idempotencyKey) this.byIdemKey.set(record.idempotencyKey, record.id);
    return record;
  }

  async get(id: string): Promise<ActionIntentRecord | null> {
    return this.byId.get(id) ?? null;
  }

  async findByIdempotencyKey(key: string): Promise<ActionIntentRecord | null> {
    const id = this.byIdemKey.get(key);
    return id ? (this.byId.get(id) ?? null) : null;
  }

  async transition(
    id: string,
    from: ActionIntentStatus,
    to: ActionIntentStatus,
    patch: Partial<ActionIntentRecord> = {},
  ): Promise<ActionIntentRecord> {
    const record = this.byId.get(id);
    if (!record) throw new ActionIntentRejected("INVALID_STATE", `Record ${id} not found.`);
    if (record.status !== from) {
      throw new ActionIntentRejected(
        "INVALID_STATE",
        `Cannot transition ${id} from ${from}: current status is ${record.status}.`,
      );
    }
    const updated: ActionIntentRecord = { ...record, ...patch, status: to, updatedAt: new Date(0) };
    this.byId.set(id, updated);
    return updated;
  }

  async listByStatus(status: ActionIntentStatus): Promise<ActionIntentRecord[]> {
    return [...this.byId.values()].filter((r) => r.status === status);
  }
}

// ─── Audit recorder ──────────────────────────────────────────────────────────
export interface ActionIntentAuditEvent {
  intentId: string;
  intentType: string;
  status: ActionIntentStatus;
  actor: ActorContext;
  code?: RejectionCode;
  reason?: string;
  approverId?: string;
  /** Safe representation of the authoritative result — never raw secrets/PII. */
  resultSummary?: Record<string, unknown>;
}

export interface ActionIntentAuditRecorder {
  record(event: ActionIntentAuditEvent): Promise<void>;
}

/** No-op recorder for unit tests. */
export const noopAuditRecorder: ActionIntentAuditRecorder = {
  async record() {
    /* intentionally empty */
  },
};

/**
 * Default recorder — reuses the existing append-only `AuditLog` table exactly
 * as `writeDealerAudit` does: the Postgres enum column `action` is set to the
 * general member STATUS_CHANGE and the real action + safe metadata is stored in
 * `metadata`. Best-effort: auditing never blocks or fails the decision path.
 */
export const auditLogRecorder: ActionIntentAuditRecorder = {
  async record(event: ActionIntentAuditEvent): Promise<void> {
    try {
      const { prisma } = await import("@/lib/prisma");
      const { AdminActionType } = await import("@prisma/client");
      const isAdmin = event.actor.actorType === "ADMIN";
      await prisma.auditLog.create({
        data: {
          adminId: isAdmin ? event.actor.actorId : null,
          userId: isAdmin ? null : event.actor.actorId,
          action: AdminActionType.STATUS_CHANGE,
          entityType: "AiActionIntent",
          entityId: event.intentId,
          reason: event.reason ?? null,
          metadata: {
            actorType: event.actor.actorType,
            actorId: event.actor.actorId,
            authenticatedRole: event.actor.authenticatedRole,
            actorAction: "AI_ACTION_INTENT",
            intentType: event.intentType,
            lifecycleStatus: event.status,
            ...(event.code ? { rejectionCode: event.code } : {}),
            ...(event.approverId ? { approverId: event.approverId } : {}),
            ...(event.resultSummary ? { result: event.resultSummary } : {}),
          } as unknown as import("@prisma/client").Prisma.InputJsonValue,
        },
      });
    } catch (err) {
      const { logger } = await import("@/lib/logger");
      logger.error("[action-intent-audit] write failed:", err);
    }
  },
};
