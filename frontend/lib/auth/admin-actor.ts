import 'server-only';
import { getAuthenticatedAdmin } from '@/lib/auth/admin-session';

// Returns the authenticated admin's UUID, or null if no admin session is
// attached to the request. Callers that write to admin_audit_log MUST treat
// a null result as a signal to skip the audit insert — never fall back to a
// placeholder UUID, because a fraudulently-attributed audit row is worse
// than no audit row at all.
export async function getAdminActorId(): Promise<string | null> {
  const admin = await getAuthenticatedAdmin();
  return admin?.adminId ?? null;
}
