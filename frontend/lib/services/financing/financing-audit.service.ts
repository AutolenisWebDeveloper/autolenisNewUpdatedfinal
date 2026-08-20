// lib/services/financing/financing-audit.service.ts
//
// Phase 5 Block 1 — tamper-evident, hash-chained financing audit trail.
// Every decision, notice, human override, and rule applied is appended as a row
// whose hash chains to the previous row (prevHash → hash). The hash signs the FULL
// content — including who (actorType/actorId), whose (creditApplicationId/dealId/
// buyerId), when (createdAt), which rule (ruleId), and the payload — so mutating
// any of those breaks the chain. verifyFinancingAuditChain additionally enforces
// genesis (row 1, prevHash=null), strict contiguity, and (optionally) an external
// tip anchor, so prefix/suffix truncation and forged appends are also detectable.
// Appends are serialized (Serializable txn + unique(sequence), with bounded retry)
// so the chain never forks. The table is append-only at the DB level (block
// UPDATE/DELETE/TRUNCATE trigger) — this module is the ONLY sanctioned write path.

import { prisma } from "@/lib/prisma";
import { createHash } from "node:crypto";
import type { FinancingAuditActorType, FinancingAuditEventType, FinancingAuditEvent } from "@prisma/client";

// Deterministic, key-sorted serialization so the hash is independent of JS key
// insertion order and handles nested objects, arrays, null, and unicode.
function stableStringify(value: unknown): string {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
}

function toIso(v: Date | string): string {
  return typeof v === "string" ? v : v.toISOString();
}

export interface HashInput {
  prevHash: string | null;
  sequence: number;
  eventType: string;
  actorType: string;
  actorId: string | null;
  creditApplicationId: string | null;
  dealId: string | null;
  buyerId: string | null;
  ruleId: string | null;
  createdAt: string; // ISO-8601
  payload: unknown;
}

export function computeEventHash(input: HashInput): string {
  const canonical = [
    input.prevHash ?? "",
    String(input.sequence),
    input.eventType,
    input.actorType,
    input.actorId ?? "",
    input.creditApplicationId ?? "",
    input.dealId ?? "",
    input.buyerId ?? "",
    input.ruleId ?? "",
    input.createdAt,
    stableStringify(input.payload),
  ].join("|");
  return createHash("sha256").update(canonical).digest("hex");
}

export interface AppendAuditInput {
  eventType: FinancingAuditEventType;
  actorType: FinancingAuditActorType;
  actorId?: string | null;
  creditApplicationId?: string | null;
  dealId?: string | null;
  buyerId?: string | null;
  ruleId?: string | null;
  payload: Record<string, unknown>;
}

const APPEND_MAX_RETRIES = 5;

/**
 * Append one event to the tamper-evident chain. Serialized so concurrent appends
 * cannot fork the chain: the tail is read and the new row chained + inserted inside
 * a Serializable transaction, and unique(sequence) makes a racing second append
 * collide. Because Prisma does NOT auto-retry, we retry a bounded number of times
 * on a write-conflict (P2034) or unique-collision (P2002) so a concurrent append
 * still lands (never a silent audit gap). Never UPDATE/DELETE an audit row — correct
 * a mistake by appending a corrective event.
 */
export async function appendFinancingAuditEvent(input: AppendAuditInput): Promise<FinancingAuditEvent> {
  let event: FinancingAuditEvent | null = null;
  for (let attempt = 0; ; attempt++) {
    try {
      event = await prisma.$transaction(
        async (tx) => {
          const tail = await tx.financingAuditEvent.findFirst({ orderBy: { sequence: "desc" } });
          const sequence = (tail?.sequence ?? 0) + 1;
          const prevHash = tail?.hash ?? null;
          const createdAt = new Date();
          const hash = computeEventHash({
            prevHash,
            sequence,
            eventType: input.eventType,
            actorType: input.actorType,
            actorId: input.actorId ?? null,
            creditApplicationId: input.creditApplicationId ?? null,
            dealId: input.dealId ?? null,
            buyerId: input.buyerId ?? null,
            ruleId: input.ruleId ?? null,
            createdAt: createdAt.toISOString(),
            payload: input.payload,
          });
          return tx.financingAuditEvent.create({
            data: {
              sequence,
              eventType: input.eventType,
              actorType: input.actorType,
              actorId: input.actorId ?? null,
              creditApplicationId: input.creditApplicationId ?? null,
              dealId: input.dealId ?? null,
              buyerId: input.buyerId ?? null,
              ruleId: input.ruleId ?? null,
              payload: input.payload as object,
              prevHash,
              hash,
              createdAt,
            },
          });
        },
        { isolationLevel: "Serializable" },
      );
      break;
    } catch (e) {
      const code = (e as { code?: string } | null)?.code;
      if ((code === "P2034" || code === "P2002") && attempt < APPEND_MAX_RETRIES) continue;
      throw e;
    }
  }
  // De-dup with the platform compliance timeline: when the event concerns a buyer,
  // mirror a lightweight breadcrumb into the existing ComplianceEvent surface so
  // financing decisions/notices show up alongside prequal in the per-buyer
  // compliance history (admin already reads that timeline) rather than in a second,
  // parallel audit view. This is best-effort and lives OUTSIDE the hash-chain
  // transaction: the FinancingAuditEvent row is the tamper-evident source of truth;
  // a mirror failure must never fail (or roll back) the audit append. The mirror
  // carries only structural identifiers + the chain anchor (sequence/hash) — never
  // the raw payload — so no financing PII crosses into the compliance table.
  if (event.buyerId) {
    try {
      await prisma.complianceEvent.create({
        data: {
          eventType: `FINANCING_${input.eventType}`,
          buyerId: event.buyerId,
          metadata: {
            source: "financing-audit",
            financingAuditSequence: event.sequence,
            financingAuditHash: event.hash,
            financingEventType: input.eventType,
            actorType: input.actorType,
            ...(event.creditApplicationId ? { creditApplicationId: event.creditApplicationId } : {}),
            ...(event.dealId ? { dealId: event.dealId } : {}),
            ...(event.ruleId ? { ruleId: event.ruleId } : {}),
          },
        },
      });
    } catch {
      // Non-fatal: the tamper-evident chain already recorded the event.
    }
  }
  return event;
}

export interface ChainRow {
  sequence: number;
  eventType: string;
  actorType: string;
  actorId: string | null;
  creditApplicationId: string | null;
  dealId: string | null;
  buyerId: string | null;
  ruleId: string | null;
  createdAt: Date | string;
  payload: unknown;
  prevHash: string | null;
  hash: string;
}

/**
 * Verify the WHOLE financing audit chain (a subset will fail genesis/contiguity —
 * that is intentional; this is a full-chain integrity check). Detects:
 *  - content tampering (recomputed hash ≠ stored hash, over ALL signed columns)
 *  - a removed/reordered middle row (prevHash link break)
 *  - prefix truncation (row 1 must be genesis: prevHash=null, sequence=1)
 *  - a sequence gap (each row must be prev.sequence + 1)
 *  - suffix truncation / forged append, when `expectedTip` (a trusted head
 *    sequence+hash, e.g. a signed checkpoint) is supplied.
 */
export function verifyFinancingAuditChain(
  events: ChainRow[],
  expectedTip?: { sequence: number; hash: string },
): { ok: true } | { ok: false; brokenAtSequence: number } {
  const sorted = [...events].sort((a, b) => a.sequence - b.sequence);
  let prev: ChainRow | null = null;
  for (const e of sorted) {
    if (!prev) {
      if (e.prevHash !== null || e.sequence !== 1) return { ok: false, brokenAtSequence: e.sequence };
    } else {
      if (e.sequence !== prev.sequence + 1) return { ok: false, brokenAtSequence: e.sequence };
      if (e.prevHash !== prev.hash) return { ok: false, brokenAtSequence: e.sequence };
    }
    const expected = computeEventHash({
      prevHash: e.prevHash,
      sequence: e.sequence,
      eventType: e.eventType,
      actorType: e.actorType,
      actorId: e.actorId,
      creditApplicationId: e.creditApplicationId,
      dealId: e.dealId,
      buyerId: e.buyerId,
      ruleId: e.ruleId,
      createdAt: toIso(e.createdAt),
      payload: e.payload,
    });
    if (expected !== e.hash) return { ok: false, brokenAtSequence: e.sequence };
    prev = e;
  }
  if (expectedTip) {
    if (!prev || prev.sequence !== expectedTip.sequence || prev.hash !== expectedTip.hash) {
      return { ok: false, brokenAtSequence: prev?.sequence ?? 0 };
    }
  }
  return { ok: true };
}
