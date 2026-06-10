import { NextResponse, type NextRequest } from 'next/server';
import { authorizeDispatch, finalizeDispatch } from '@/lib/crm/dispatch-auth';
import { resolveDispatchContact } from '@/lib/crm/resolve-contact';
import { SuppressionService } from '@/lib/services/suppression.service';
import { TemplateService } from '@/lib/services/template.service';
import { sendCrmDispatchEmail } from '@/lib/services/email/resend.service';
import { writeCrmAuditLog } from '@/lib/services/admin/crm-audit';
import { computeEffectiveEmailType } from '@/lib/crm/email-dispatch-policy';

export const dynamic = 'force-dynamic';

// POST /api/crm/dispatch/email — Make.com calls this to ACT (send an email).
// AutoLenis owns consent, suppression, idempotency, the verified send outcome,
// and the audit trail. Make never sends email itself.
//
// body: { contactId | email, subject?, html? | templateKey?+vars?,
//         type:'transactional'|'marketing', idempotencyKey, scenarioId? }
export async function POST(request: NextRequest) {
  const auth = await authorizeDispatch(request, 'dispatch/email');
  if (!auth.ok) return auth.response;
  if (auth.duplicate) return NextResponse.json(auth.priorResult);

  const { body, supabase, keyHash, idempotencyKey } = auth;

  const contactId = body.contactId as string | undefined;
  const email = body.email as string | undefined;
  const declaredType = (body.type as 'transactional' | 'marketing') ?? 'transactional';
  const scenarioId = (body.scenarioId as string | undefined) ?? null;
  const templateKey = body.templateKey as string | undefined;
  const vars = (body.vars as Record<string, string | number | null> | undefined) ?? {};

  // EFFECTIVE type (Fix C): transactional only if the caller said so AND the
  // template_key is on the allowlist. Marketing, raw html, or an unlisted key →
  // marketing → consent required. The label alone can't bypass consent.
  const effectiveType = computeEffectiveEmailType(declaredType, templateKey);

  const finalize = async (result: Record<string, unknown>, http = 200) => {
    await finalizeDispatch(supabase, keyHash, result);
    return NextResponse.json(result, { status: http });
  };

  const contact = await resolveDispatchContact(supabase, { contactId, email });
  const toEmail = contact?.email ?? email ?? null;
  if (!toEmail) {
    return finalize({ status: 'contact_not_found', error: 'no_email_resolved' }, 404);
  }

  // Consent gate keyed on the EFFECTIVE type. Marketing requires explicit email
  // consent; only allowlisted transactional templates are exempt.
  if (effectiveType === 'marketing' && contact && !contact.consent_email) {
    return finalize({
      status: 'no_consent',
      reason: 'consent_email_required',
      declaredType,
      effectiveType,
    });
  }
  if (contact?.do_not_contact) {
    return finalize({ status: 'no_consent', reason: 'do_not_contact', declaredType, effectiveType });
  }

  // Suppression gate.
  if (await SuppressionService.isEmailSuppressed(supabase, toEmail)) {
    if (contact) {
      await supabase.from('contact_timeline_events').insert({
        contact_id: contact.id,
        event_type: 'email_bounced',
        event_data: { dispatch: 'suppressed', scenario_id: scenarioId },
      });
    }
    return finalize({ status: 'suppressed' });
  }

  // Resolve subject/html — either a direct payload or a keyed template.
  let subject = body.subject as string | undefined;
  let html = body.html as string | undefined;
  if (templateKey) {
    const template = await TemplateService.getTemplateByKey(supabase, templateKey);
    if (!template) return finalize({ status: 'error', error: 'template_not_found' }, 400);
    if (template.status !== 'active') {
      return finalize({ status: 'error', error: 'template_not_active' }, 400);
    }
    const rendered = TemplateService.renderInline(template, {
      firstName: contact?.first_name ?? '',
      lastName: contact?.last_name ?? '',
      ...vars,
    });
    subject = rendered.subject;
    html = rendered.html;
  }
  if (!subject || !html) {
    return finalize({ status: 'error', error: 'missing_subject_or_html' }, 400);
  }

  // Send via the outcome-verified rail. EmailSendLog is written inside the
  // idempotent send core — a swallowed/silent success surfaces as FAILED here.
  const outcome = await sendCrmDispatchEmail({
    to: toEmail,
    subject,
    html,
    idempotencyKey,
    templateKey: templateKey ?? 'crm-dispatch',
  });

  const status =
    outcome.outcome === 'SENT'
      ? 'sent'
      : outcome.outcome === 'DUPLICATE'
        ? 'duplicate'
        : outcome.outcome === 'DEV_SKIPPED'
          ? 'dev_skipped'
          : 'failed';
  const providerId = 'resendId' in outcome ? outcome.resendId ?? null : null;

  if (contact) {
    await supabase.from('contact_timeline_events').insert({
      contact_id: contact.id,
      event_type: status === 'sent' || status === 'duplicate' ? 'email_sent' : 'email_bounced',
      event_data: {
        dispatch: status,
        provider_id: providerId,
        subject,
        declared_type: declaredType,
        effective_type: effectiveType,
        scenario_id: scenarioId,
        template_key: templateKey ?? null,
      },
    });
  }

  await writeCrmAuditLog(
    supabase,
    { adminId: 'make_dispatch', adminEmail: 'make@autolenis.com' },
    {
      action: 'CRM_DISPATCH_EMAIL',
      entity_type: 'contact',
      entity_id: contact?.id ?? toEmail,
      new_state: {
        status,
        provider_id: providerId,
        declared_type: declaredType,
        effective_type: effectiveType,
        scenario_id: scenarioId,
      },
    },
  );

  const result = { status, providerId, channel: 'email' as const };
  await finalizeDispatch(supabase, keyHash, result, status === 'failed' ? 'failed' : 'completed');
  return NextResponse.json(result, { status: status === 'failed' ? 502 : 200 });
}
