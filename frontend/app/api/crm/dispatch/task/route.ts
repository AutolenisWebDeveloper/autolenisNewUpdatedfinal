import { NextResponse, type NextRequest } from 'next/server';
import { authorizeDispatch, finalizeDispatch } from '@/lib/crm/dispatch-auth';
import { resolveDispatchContact } from '@/lib/crm/resolve-contact';
import { writeCrmAuditLog } from '@/lib/services/admin/crm-audit';

export const dynamic = 'force-dynamic';

const VALID_PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const;
const VALID_SCOPES = ['contact', 'system', 'admin'] as const;

// POST /api/crm/dispatch/task — Make.com calls this to create an admin CRM task.
// Reuses the same `crm_tasks` model the admin Tasks UI reads from.
//
// body: { title, description?, priority?, scope?, contactId?|email?, dueAt?,
//         assignedTo?, idempotencyKey, scenarioId? }
export async function POST(request: NextRequest) {
  const auth = await authorizeDispatch(request, 'dispatch/task');
  if (!auth.ok) return auth.response;
  if (auth.duplicate) return NextResponse.json(auth.priorResult);

  const { body, supabase, keyHash } = auth;

  const finalize = async (result: Record<string, unknown>, http = 200) => {
    await finalizeDispatch(supabase, keyHash, result, result.status === 'error' ? 'failed' : 'completed');
    return NextResponse.json(result, { status: http });
  };

  const title = (body.title as string | undefined)?.trim();
  if (!title) return finalize({ status: 'error', error: 'title_required' }, 400);

  const priority = (VALID_PRIORITIES as readonly string[]).includes(body.priority as string)
    ? (body.priority as string)
    : 'medium';
  let scope = (VALID_SCOPES as readonly string[]).includes(body.scope as string)
    ? (body.scope as string)
    : 'contact';

  // Resolve an optional contact so a contact-scoped task is attached.
  const contact = await resolveDispatchContact(supabase, {
    contactId: body.contactId as string | undefined,
    email: body.email as string | undefined,
  });
  if (scope === 'contact' && !contact) {
    // No resolvable contact — degrade to a system task rather than rejecting,
    // so a Make scenario's follow-up task is never silently lost.
    scope = 'system';
  }

  const { data, error } = await supabase
    .from('crm_tasks')
    .insert({
      title,
      description: (body.description as string | undefined) ?? null,
      priority,
      scope,
      contact_id: contact?.id ?? null,
      due_at: (body.dueAt as string | undefined) ?? null,
      assigned_to: (body.assignedTo as string | undefined) ?? null,
      source: 'make_dispatch',
      status: 'open',
    })
    .select()
    .single();

  if (error) return finalize({ status: 'error', error: error.message }, 500);

  if (data.contact_id) {
    await supabase.from('contact_timeline_events').insert({
      contact_id: data.contact_id,
      event_type: 'task_created',
      event_data: { task_id: data.id, title: data.title, source: 'make_dispatch' },
    });
  }

  await writeCrmAuditLog(
    supabase,
    { adminId: 'make_dispatch', adminEmail: 'make@autolenis.com' },
    {
      action: 'CRM_DISPATCH_TASK',
      entity_type: 'crm_task',
      entity_id: data.id,
      new_state: data,
    },
  );

  return finalize({ status: 'created', id: data.id });
}
