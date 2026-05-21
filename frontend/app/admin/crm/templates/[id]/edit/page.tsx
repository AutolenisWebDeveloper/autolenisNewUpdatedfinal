import { notFound } from 'next/navigation';
import { getServiceSupabase } from '@/lib/supabase-service';
import { TemplateService } from '@/lib/services/template.service';
import { TemplateEditor } from '@/components/admin/crm/TemplateEditor';

export const dynamic = 'force-dynamic';

export default async function EditTemplatePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = getServiceSupabase();

  const template = await TemplateService.getTemplate(supabase, id);
  if (!template) notFound();
  const versions = await TemplateService.listVersions(supabase, id);

  return <TemplateEditor mode="edit" template={template} versions={versions} />;
}
