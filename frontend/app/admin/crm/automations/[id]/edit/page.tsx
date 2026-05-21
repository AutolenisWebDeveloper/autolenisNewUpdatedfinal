import { notFound } from 'next/navigation';
import { getServiceSupabase } from '@/lib/supabase-service';
import { WorkflowService } from '@/lib/services/workflow.service';
import { TemplateService } from '@/lib/services/template.service';
import { WorkflowBuilder } from '@/components/admin/crm/WorkflowBuilder';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function EditAutomationPage({ params }: PageProps) {
  const { id } = await params;
  const supabase = getServiceSupabase();

  const [workflow, templates, versions] = await Promise.all([
    WorkflowService.getWorkflow(supabase, id),
    TemplateService.listTemplates(supabase, { status: 'active' }),
    WorkflowService.listVersions(supabase, id),
  ]);

  if (!workflow) notFound();

  return (
    <WorkflowBuilder
      templates={templates.map((t) => ({ id: t.id, name: t.name, subject: t.subject }))}
      initialWorkflow={workflow}
      versions={versions}
    />
  );
}
