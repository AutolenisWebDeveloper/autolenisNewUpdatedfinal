import { NextResponse } from 'next/server';
import { getServiceSupabase } from '@/lib/supabase-service';
import { getAdminActor } from '@/lib/auth/admin-actor';
import { TemplateService } from '@/lib/services/template.service';
import { CampaignService } from '@/lib/services/campaign.service';
import { enforceSmsOptOut, scrubProhibitedClaims } from '@/lib/ai/crm-copilot';

export const dynamic = 'force-dynamic';

type ApproveRequest =
  | { kind: 'email_template'; name?: string; subject?: string; body?: string }
  | { kind: 'sms_campaign'; name?: string; body?: string };

// POST /api/admin/crm/copilot/approve
// The ONLY way a copilot draft becomes a stored record. Saves an approved draft
// into the templates/campaigns tables with DRAFT status, reusing the existing
// services (which audit-log the write). Still nothing is sent or activated.
export async function POST(req: Request) {
  const actor = await getAdminActor();
  if (!actor) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });

  let body: ApproveRequest;
  try {
    body = (await req.json()) as ApproveRequest;
  } catch {
    return NextResponse.json({ error: 'INVALID_JSON' }, { status: 400 });
  }

  const supabase = getServiceSupabase();

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
      return NextResponse.json({ kind: 'sms_campaign', campaign }, { status: 201 });
    }

    return NextResponse.json({ error: 'INVALID_KIND' }, { status: 400 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'APPROVE_FAILED';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
