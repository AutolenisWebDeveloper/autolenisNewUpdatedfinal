// lib/services/ai/action-intent/api-shape.ts
//
// Server-side response shaping for the ActionIntent admin API. Only the fields
// an admin needs to review/approve are returned. The catalog's parameter
// schemas never carry SSN/card/credit data (those live in dedicated encrypted
// stores), so validated `parameters` are safe to show an authorized admin; this
// helper still whitelists explicitly rather than spreading the raw record, so a
// future column addition can never leak by default. Privacy is enforced here
// (server-side), not in the client.

import type { ActionIntentRecord } from "./types";

export interface AdminIntentView {
  id: string;
  intentType: string;
  status: string;
  consequence: string;
  requiresHumanApproval: boolean;
  actorType: string;
  actorId: string;
  subjectId?: string;
  parameters: Record<string, unknown>;
  rationale?: string;
  approverId?: string;
  approverRole?: string;
  rejectionCode?: string;
  failureReason?: string;
  result?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export function shapeIntentForAdmin(record: ActionIntentRecord): AdminIntentView {
  return {
    id: record.id,
    intentType: record.intentType,
    status: record.status,
    consequence: record.consequence,
    requiresHumanApproval: record.requiresHumanApproval,
    actorType: record.actorType,
    actorId: record.actorId,
    subjectId: record.subjectId,
    parameters: record.parameters,
    rationale: record.rationale,
    approverId: record.approverId,
    approverRole: record.approverRole,
    rejectionCode: record.rejectionCode,
    failureReason: record.failureReason,
    result: record.result,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}
