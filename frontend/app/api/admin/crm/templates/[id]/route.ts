import { NextResponse } from 'next/server';
import { getServiceSupabase } from '@/lib/supabase-service';
import { TemplateService } from '@/lib/services/template.service';
import { getAdminActorId } from '@/lib/auth/admin-actor';
import type { EmailTemplateUpdate } from '@/lib/types/crm';

export const dynamic = 'force-dynamic';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = getServiceSupabase();

  const template = await TemplateService.getTemplate(supabase, id);
  if (!template) {
    return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  }
  const versions = await TemplateService.listVersions(supabase, id);

  return NextResponse.json({ template, versions });
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  let body: EmailTemplateUpdate;
  try {
    body = (await req.json()) as EmailTemplateUpdate;
  } catch {
    return NextResponse.json({ error: 'INVALID_JSON' }, { status: 400 });
  }

  const supabase = getServiceSupabase();
  const adminId = await getAdminActorId();

  try {
    const updated = await TemplateService.updateTemplate(supabase, id, body, adminId);
    return NextResponse.json({ template: updated });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'UPDATE_FAILED';
    const status = message === 'TEMPLATE_NOT_FOUND' ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
