import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ContactService } from '@/lib/services/contact.service';
import type { Contact } from '@/lib/types/crm';

// Resolve a CRM contact for a dispatch call by id, then email, then phone.
// Returns null when nothing matches — dispatch handlers translate that into a
// 404-style { status: 'contact_not_found' } rather than acting blindly.
export async function resolveDispatchContact(
  supabase: SupabaseClient,
  ref: { contactId?: string; email?: string; phone?: string },
): Promise<Contact | null> {
  if (ref.contactId) {
    const byId = await ContactService.getContactById(supabase, ref.contactId);
    if (byId) return byId;
  }
  if (ref.email) {
    const { data } = await ContactService.findContactByEmail(supabase, ref.email);
    if (data) return data as Contact;
  }
  if (ref.phone) {
    const { data } = await ContactService.findContactByPhone(supabase, ref.phone);
    if (data) return data as Contact;
  }
  return null;
}
