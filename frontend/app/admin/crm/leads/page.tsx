import { ContactList } from '@/components/admin/crm/ContactList';

export const dynamic = 'force-dynamic';

export default function LeadsPage() {
  return (
    <ContactList
      pageTitle="Leads"
      pageDescription="Contacts in the early stages of the funnel — not yet committed to a purchase."
      lockedStages={['lead', 'prequal_started', 'prequal_completed', 'deposit_pending']}
    />
  );
}
