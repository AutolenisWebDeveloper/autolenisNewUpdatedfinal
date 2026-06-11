import { getServiceSupabase } from '@/lib/supabase-service';
import { TemplateService } from '@/lib/services/template.service';
import type { EmailTemplate } from '@/lib/types/crm';
import { TemplateListClient } from '@/components/admin/crm/TemplateListClient';

export const dynamic = 'force-dynamic';

export default async function TemplatesPage() {
  const supabase = getServiceSupabase();
  let templates: EmailTemplate[] = [];
  let loadError: string | null = null;
  try {
    templates = await TemplateService.listTemplates(supabase, {});
  } catch (err) {
    loadError = err instanceof Error ? err.message : 'LOAD_FAILED';
  }

  return <TemplateListClient templates={templates} loadError={loadError} />;
}
