import { NextResponse } from 'next/server';
import { getServiceSupabase } from '@/lib/supabase-service';
import { TemplateService } from '@/lib/services/template.service';
import { requirePermissionActor } from '@/lib/auth/permissions';
import type {
  EmailTemplateInput,
  EmailTemplateStatus,
} from '@/lib/types/crm';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const actor = await requirePermissionActor("crm.read");
  if (!actor) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });

  const url = new URL(req.url);
  const status = url.searchParams.get('status') as EmailTemplateStatus | null;
  const category = url.searchParams.get('category');
  const search = url.searchParams.get('search');

  const supabase = getServiceSupabase();
  try {
    const templates = await TemplateService.listTemplates(supabase, {
      status: status ?? undefined,
      category: category ?? undefined,
      search: search ?? undefined,
    });
    return NextResponse.json({ data: templates });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'LIST_FAILED';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  let body: EmailTemplateInput;
  try {
    body = (await req.json()) as EmailTemplateInput;
  } catch {
    return NextResponse.json({ error: 'INVALID_JSON' }, { status: 400 });
  }

  if (!body?.name?.trim() || !body?.subject?.trim() || !body?.html_body?.trim()) {
    return NextResponse.json(
      { error: 'MISSING_REQUIRED_FIELDS' },
      { status: 400 },
    );
  }

  const actor = await requirePermissionActor("crm.manage");
  if (!actor) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  const supabase = getServiceSupabase();

  try {
    const created = await TemplateService.createTemplate(supabase, body, actor);
    return NextResponse.json({ template: created }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'CREATE_FAILED';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
