import { NextResponse } from 'next/server';
import { getServiceSupabase } from '@/lib/supabase-service';
import { ContactService } from '@/lib/services/contact.service';
import { SuppressionService } from '@/lib/services/suppression.service';
import { inngest } from '@/lib/inngest/client';
import { requirePermissionActor } from '@/lib/auth/permissions';
import { writeCrmAuditLog } from '@/lib/services/admin/crm-audit';

export const dynamic = 'force-dynamic';

type SendSmsBody = {
  body?: string;
};

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const actor = await requirePermissionActor("comms.bulk_send");
  if (!actor) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });

  let payload: SendSmsBody;
  try {
    payload = (await req.json()) as SendSmsBody;
  } catch {
    return NextResponse.json({ error: 'INVALID_JSON' }, { status: 400 });
  }

  if (!payload.body?.trim()) {
    return NextResponse.json({ error: 'BODY_REQUIRED' }, { status: 400 });
  }

  const supabase = getServiceSupabase();
  const contact = await ContactService.getContactById(supabase, id);
  if (!contact) {
    return NextResponse.json({ error: 'CONTACT_NOT_FOUND' }, { status: 404 });
  }

  if (!contact.phone) {
    return NextResponse.json({ error: 'CONTACT_HAS_NO_PHONE' }, { status: 400 });
  }

  if (!contact.consent_sms) {
    return NextResponse.json({ error: 'NO_SMS_CONSENT' }, { status: 403 });
  }

  if (contact.do_not_contact) {
    return NextResponse.json({ error: 'CONTACT_DNC' }, { status: 403 });
  }

  const suppressed = await SuppressionService.isSmsSuppressed(supabase, contact.phone);
  if (suppressed) {
    return NextResponse.json({ error: 'SMS_SUPPRESSED' }, { status: 403 });
  }

  await inngest.send({
    name: 'autolenis/sms.send',
    data: {
      contactId: contact.id,
      phone: contact.phone,
      body: payload.body.trim(),
    },
  });

  await writeCrmAuditLog(supabase, actor, {
    action: 'CRM_INDIVIDUAL_SMS_SEND',
    entity_type: 'contact',
    entity_id: contact.id,
    metadata: { to_phone: contact.phone },
  });

  return NextResponse.json({ queued: true });
}
