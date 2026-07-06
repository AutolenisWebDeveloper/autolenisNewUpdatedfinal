import { NextResponse } from 'next/server';
import { getServiceSupabase } from '@/lib/supabase-service';
import { SuppressionService } from '@/lib/services/suppression.service';
import { inngest } from '@/lib/inngest/client';
import { requirePermissionActor } from '@/lib/auth/permissions';
import { writeCrmAuditLog } from '@/lib/services/admin/crm-audit';
import type { Contact } from '@/lib/types/crm';

export const dynamic = 'force-dynamic';

type BulkSendBody = {
  name?: string;
  type?: 'email' | 'sms';
  contact_ids?: string[];
  template_id?: string;
  subject?: string;
  html_body?: string;
  text_body?: string;
  sms_body?: string;
};

// Fan-out endpoint for ad-hoc bulk sends from the Contacts list. Bypasses the
// campaign/segment path (which requires a segment) and dispatches the same
// inngest events the single-contact send endpoints use — every gate (DNC,
// consent, suppression) is enforced by the workers themselves.
export async function POST(req: Request) {
  const actor = await requirePermissionActor("comms.bulk_send");
  if (!actor) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  let body: BulkSendBody;
  try {
    body = (await req.json()) as BulkSendBody;
  } catch {
    return NextResponse.json({ error: 'INVALID_JSON' }, { status: 400 });
  }

  if (!Array.isArray(body.contact_ids) || body.contact_ids.length === 0) {
    return NextResponse.json({ error: 'CONTACT_IDS_REQUIRED' }, { status: 400 });
  }

  if (body.type !== 'email' && body.type !== 'sms') {
    return NextResponse.json({ error: 'INVALID_TYPE' }, { status: 400 });
  }

  if (body.type === 'email') {
    if (!body.template_id && (!body.subject?.trim() || !body.html_body?.trim())) {
      return NextResponse.json(
        { error: 'TEMPLATE_OR_SUBJECT_AND_BODY_REQUIRED' },
        { status: 400 },
      );
    }
  } else if (!body.sms_body?.trim()) {
    return NextResponse.json({ error: 'SMS_BODY_REQUIRED' }, { status: 400 });
  }

  const supabase = getServiceSupabase();
  const { data: contacts, error } = await supabase
    .from('contacts')
    .select('*')
    .in('id', body.contact_ids)
    .is('deleted_at', null);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const all = (contacts ?? []) as Contact[];
  let queued = 0;
  let skipped_dnc = 0;
  let skipped_no_channel = 0;
  let skipped_consent = 0;
  let skipped_suppressed = 0;

  for (const c of all) {
    if (c.do_not_contact) {
      skipped_dnc++;
      continue;
    }

    if (body.type === 'email') {
      if (!c.email) {
        skipped_no_channel++;
        continue;
      }
      if (await SuppressionService.isEmailSuppressed(supabase, c.email)) {
        skipped_suppressed++;
        continue;
      }
      await inngest.send({
        name: 'autolenis/email.send',
        data: {
          contactId: c.id,
          email: c.email,
          subject: body.subject,
          html: body.html_body,
          text: body.text_body,
          templateId: body.template_id,
          type: 'marketing',
        },
      });
      queued++;
    } else {
      if (!c.phone) {
        skipped_no_channel++;
        continue;
      }
      if (!c.consent_sms) {
        skipped_consent++;
        continue;
      }
      if (await SuppressionService.isSmsSuppressed(supabase, c.phone)) {
        skipped_suppressed++;
        continue;
      }
      await inngest.send({
        name: 'autolenis/sms.send',
        data: {
          contactId: c.id,
          phone: c.phone,
          body: (body.sms_body ?? '').trim(),
        },
      });
      queued++;
    }
  }

  await writeCrmAuditLog(supabase, actor, {
    action: body.type === 'email' ? 'CRM_BULK_EMAIL_SEND' : 'CRM_BULK_SMS_SEND',
    entity_type: 'campaign',
    entity_id: 'ad_hoc',
    metadata: {
      queued,
      skipped_dnc,
      skipped_no_channel,
      skipped_consent,
      skipped_suppressed,
      total: all.length,
      template_id: body.template_id ?? null,
    },
  });

  return NextResponse.json({
    queued,
    skipped_dnc,
    skipped_no_channel,
    skipped_consent,
    skipped_suppressed,
    total: all.length,
  });
}
