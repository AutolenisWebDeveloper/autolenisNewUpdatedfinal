import { getServiceSupabase } from '@/lib/supabase-service';
import { TemplateService } from '@/lib/services/template.service';
import { WorkflowBuilder } from '@/components/admin/crm/WorkflowBuilder';

export const dynamic = 'force-dynamic';

export default async function NewAutomationPage() {
  const supabase = getServiceSupabase();
  const templates = await TemplateService.listTemplates(supabase, { status: 'active' });

  return (
    <WorkflowBuilder
      templates={templates.map((t) => ({ id: t.id, name: t.name, subject: t.subject }))}
      initialWorkflow={null}
    />
  );
}
