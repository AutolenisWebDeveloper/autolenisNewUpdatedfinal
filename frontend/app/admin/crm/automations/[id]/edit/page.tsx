import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ id: string }>;
}

// The in-app Workflow builder is retired (Make.com owns automation). Any deep
// link into the builder bounces to the Make scenarios monitor.
export default async function EditAutomationPage({ params }: PageProps) {
  await params;
  redirect('/admin/crm/scenarios');
}
