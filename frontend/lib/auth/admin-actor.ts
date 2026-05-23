import 'server-only';
import { getAuthenticatedAdmin } from '@/lib/auth/admin-session';

export interface AdminActor {
  adminId: string;
  adminEmail: string;
}

// Returns the authenticated admin's UUID, or null if no admin session is
// attached to the request. Callers that write to admin_audit_logs MUST treat
// a null result as a signal to skip the audit insert — never fall back to a
// placeholder UUID, because a fraudulently-attributed audit row is worse
// than no audit row at all.
export async function getAdminActorId(): Promise<string | null> {
  const admin = await getAuthenticatedAdmin();
  return admin?.adminId ?? null;
}

// Returns both the id and email of the authenticated admin, or null.
// Use this when writing to admin_audit_logs, which requires admin_email
// as a NOT NULL column.
export async function getAdminActor(): Promise<AdminActor | null> {
  const admin = await getAuthenticatedAdmin();
  if (!admin) return null;
  return { adminId: admin.adminId, adminEmail: admin.email };
}
