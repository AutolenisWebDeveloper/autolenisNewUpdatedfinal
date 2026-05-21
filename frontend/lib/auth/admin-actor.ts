import 'server-only';
import { getAuthenticatedAdmin } from '@/lib/auth/admin-session';

// Fallback UUID for admin_audit_log rows when no admin session is attached
// (e.g. internal automation tooling). Keeps the NOT NULL constraint happy
// without conflating with any real admin record.
export const SYSTEM_ADMIN_ID = '00000000-0000-0000-0000-000000000000';

export async function getAdminActorId(): Promise<string> {
  const admin = await getAuthenticatedAdmin();
  return admin?.adminId ?? SYSTEM_ADMIN_ID;
}
