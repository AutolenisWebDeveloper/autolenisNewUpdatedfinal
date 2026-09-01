import { NextResponse } from 'next/server';
import { getServiceSupabase } from '@/lib/supabase-service';
import { requirePermissionActorStrict } from '@/lib/auth/permissions';
import { writeCrmAuditLog } from '@/lib/services/admin/crm-audit';
import { TemplateService } from '@/lib/services/template.service';
import { CampaignService } from '@/lib/services/campaign.service';
import {
  enforceSmsOptOut,
  scrubProhibitedClaims,
  type ClaimFlag,
} from '@/lib/ai/crm-copilot';

export const dynamic = 'force-dynamic';

// The approving client echoes the draft's `flags` (the detector output) and
// whether the reviewer acknowledged them. Both are optional for backward
// compatibility; a draft with no flags simply carries an empty/absent array.
type ApproveCommon = { flags?: ClaimFlag[]; flagsAcknowledged?: boolean };
type ApproveRequest =
  | ({ kind: 'email_template'; name?: string; subject?: string; body?: string } & ApproveCommon)
  | ({ kind: 'sms_campaign'; name?: string; body?: string } & ApproveCommon);

// POST /api/admin/crm/copilot/approve
// The ONLY way a copilot draft becomes a stored record. Saves an approved draft
// into the templates/campaigns tables with DRAFT status, reusing the existing
// services (which audit-log the write). Still nothing is sent or activated.
export async function POST(req: Request) {
  const auth = await requirePermissionActorStrict("comms.bulk_send");
  if (!auth.ok) {
    return NextResponse.json(
      { error: auth.status === 403 ? 'FORBIDDEN' : 'UNAUTHORIZED' },
      { status: auth.status },
    );
  }
  const actor = auth.actor;

  let body: ApproveRequest;
  try {
    body = (await req.json()) as ApproveRequest;
  } catch {
    return NextResponse.json({ error: 'INVALID_JSON' }, { status: 400 });
  }

  const supabase = getServiceSupabase();

  // FTC paper trail: if the draft carried unsubstantiated-claim flags, the
  // reviewer MUST acknowledge having verified them before we persist anything.
  const flags = Array.isArray(body.flags) ? body.flags : [];
  const flagCount = flags.length;
  const flagsAcknowledged = body.flagsAcknowledged === true;
  if (flagCount > 0 && !flagsAcknowledged) {
    return NextResponse.json({ error: 'FLAGS_NOT_ACKNOWLEDGED' }, { status: 422 });
  }

  try {
    if (body.kind === 'email_template') {
      const subject = body.subject?.trim();
      const draftBody = body.body?.trim();
      if (!subject || !draftBody) {
        return NextResponse.json({ error: 'SUBJECT_AND_BODY_REQUIRED' }, { status: 400 });
      }
      // Re-apply the deterministic claim scrub at the persistence boundary so an
      // edited/tampered draft can't smuggle a prohibited claim into the table.
      const template = await TemplateService.createTemplate(
        supabase,
        {
          name: body.name?.trim() || `Copilot draft — ${subject}`.slice(0, 120),
          subject: scrubProhibitedClaims(subject),
          html_body: scrubProhibitedClaims(draftBody),
          category: 'marketing',
          status: 'draft', // explicit: never active on save
        },
        actor,
      );
      await writeCrmAuditLog(supabase, actor, {
        action: 'CRM_COPILOT_APPROVE',
        entity_type: 'crm_copilot',
        entity_id: template?.id ?? '',
        metadata: { kind: body.kind, flagCount, flagsAcknowledged },
      });
      return NextResponse.json({ kind: 'email_template', template }, { status: 201 });
    }

    if (body.kind === 'sms_campaign') {
      const smsBody = body.body?.trim();
      if (!smsBody) {
        return NextResponse.json({ error: 'BODY_REQUIRED' }, { status: 400 });
      }
      const campaign = await CampaignService.createCopilotDraft(
        supabase,
        {
          name: body.name?.trim() || 'Copilot SMS draft',
          type: 'sms',
          sms_body: enforceSmsOptOut(scrubProhibitedClaims(smsBody)),
        },
        actor,
      );
      await writeCrmAuditLog(supabase, actor, {
        action: 'CRM_COPILOT_APPROVE',
        entity_type: 'crm_copilot',
        entity_id: campaign?.id ?? '',
        metadata: { kind: body.kind, flagCount, flagsAcknowledged },
      });
      return NextResponse.json({ kind: 'sms_campaign', campaign }, { status: 201 });
    }

    return NextResponse.json({ error: 'INVALID_KIND' }, { status: 400 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'APPROVE_FAILED';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
