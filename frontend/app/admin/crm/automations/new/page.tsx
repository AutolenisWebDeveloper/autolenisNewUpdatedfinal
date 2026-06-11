import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

// The in-app Workflow builder is retired (Make.com owns automation). Any deep
// link into the builder bounces to the Make scenarios monitor.
export default function NewAutomationPage() {
  redirect('/admin/crm/scenarios');
}
