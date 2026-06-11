// WO-13 — Content capability mapping onto existing AdminRoles.
//
// This does NOT introduce a new RBAC system. It is a thin mapping from content
// capabilities to the existing AdminRole set, wrapping getAdminWithRole. Every
// content API calls requireContentCapability(); the admin UI uses
// hasContentCapability() to gate controls. Dangerous actions (publish, delete,
// override) require elevated roles; override additionally requires a reason
// persisted by the caller to ContentWorkflowEvent + the audit log.

import type { NextRequest } from "next/server";
import type { AdminRole } from "@prisma/client";
import type { AdminJwtPayload } from "@/lib/admin-auth";
import { getAdminWithRole } from "@/lib/auth/admin-api";

export type ContentCapability =
  | "content.view"
  | "content.create"
  | "content.generate"
  | "content.edit"
  | "content.approve"
  | "content.publish"
  | "content.schedule"
  | "content.archive"
  | "content.delete"
  | "content.override_validation"
  | "content.manage_media"
  | "content.manage_jobs";

// Every operational role can view; editors create/generate/edit/schedule/manage;
// publishers approve/publish/archive; compliance (+super) can override a failed
// validation gate; only super can hard-delete.
const ALL_OPERATIONAL: AdminRole[] = [
  "SUPER_ADMIN",
  "OPERATIONS_ADMIN",
  "COMPLIANCE_ADMIN",
  "FINANCE_ADMIN",
  "SUPPORT_ADMIN",
];
const EDITORS: AdminRole[] = ["SUPER_ADMIN", "OPERATIONS_ADMIN"];
const PUBLISHERS: AdminRole[] = ["SUPER_ADMIN", "OPERATIONS_ADMIN"];

export const CONTENT_CAPABILITY_ROLES: Record<ContentCapability, AdminRole[]> = {
  "content.view": ALL_OPERATIONAL,
  "content.create": EDITORS,
  "content.generate": EDITORS,
  "content.edit": EDITORS,
  "content.schedule": EDITORS,
  "content.manage_media": EDITORS,
  "content.manage_jobs": EDITORS,
  "content.approve": PUBLISHERS,
  "content.publish": PUBLISHERS,
  "content.archive": PUBLISHERS,
  "content.override_validation": ["SUPER_ADMIN", "COMPLIANCE_ADMIN"],
  "content.delete": ["SUPER_ADMIN"],
};

export function hasContentCapability(role: AdminRole, cap: ContentCapability): boolean {
  return CONTENT_CAPABILITY_ROLES[cap].includes(role);
}

// Returns the admin payload if their role grants `cap`, else null (the caller
// should respond 401/403).
export async function requireContentCapability(
  request: NextRequest,
  cap: ContentCapability,
): Promise<AdminJwtPayload | null> {
  return getAdminWithRole(request, CONTENT_CAPABILITY_ROLES[cap]);
}
