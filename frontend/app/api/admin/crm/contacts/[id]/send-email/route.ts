import { NextResponse } from 'next/server';
import { getServiceSupabase } from '@/lib/supabase-service';
import { ContactService } from '@/lib/services/contact.service';
import { SuppressionService } from '@/lib/services/suppression.service';
import { enqueueEmail } from '@/lib/services/comms/comms-outbox.service';
import { requirePermissionActor } from '@/lib/auth/permissions';
import { writeCrmAuditLog } from '@/lib/services/admin/crm-audit';

export const dynamic = 'force-dynamic';

type SendEmailBody = {
  subject?: string;
  template_id?: string;
  html_body?: string;
  text_body?: string;
};

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const actor = await requirePermissionActor("comms.bulk_send");
  if (!actor) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });

  let body: SendEmailBody;
  try {
    body = (await req.json()) as SendEmailBody;
  } catch {
    return NextResponse.json({ error: 'INVALID_JSON' }, { status: 400 });
  }

  const supabase = getServiceSupabase();
  const contact = await ContactService.getContactById(supabase, id);
  if (!contact) {
    return NextResponse.json({ error: 'CONTACT_NOT_FOUND' }, { status: 404 });
  }

  if (!contact.email) {
    return NextResponse.json({ error: 'CONTACT_HAS_NO_EMAIL' }, { status: 400 });
  }

  if (contact.do_not_contact) {
    return NextResponse.json({ error: 'CONTACT_DNC' }, { status: 403 });
  }

  const suppressed = await SuppressionService.isEmailSuppressed(supabase, contact.email);
  if (suppressed) {
    return NextResponse.json({ error: 'EMAIL_SUPPRESSED' }, { status: 403 });
  }

  if (!body.template_id) {
    if (!body.subject?.trim() || !body.html_body?.trim()) {
      return NextResponse.json(
        { error: 'SUBJECT_AND_BODY_REQUIRED' },
        { status: 400 },
      );
    }
  }

  await enqueueEmail({
    contactId: contact.id,
    email: contact.email,
    subject: body.subject,
    html: body.html_body,
    text: body.text_body,
    templateId: body.template_id,
    type: 'transactional',
  });

  await writeCrmAuditLog(supabase, actor, {
    action: 'CRM_INDIVIDUAL_EMAIL_SEND',
    entity_type: 'contact',
    entity_id: contact.id,
    metadata: {
      template_id: body.template_id ?? null,
      to_email: contact.email,
    },
  });

  return NextResponse.json({ queued: true });
}
