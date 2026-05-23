import { NextResponse } from 'next/server';
import { getServiceSupabase } from '@/lib/supabase-service';
import { CampaignService, type CampaignInput } from '@/lib/services/campaign.service';
import { getAdminActor } from '@/lib/auth/admin-actor';
import { inngest } from '@/lib/inngest/client';
import type { CampaignStatus } from '@/lib/types/crm';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const status = url.searchParams.get('status') as CampaignStatus | null;

  const supabase = getServiceSupabase();
  try {
    const campaigns = await CampaignService.listCampaigns(supabase, status ?? undefined);
    return NextResponse.json({ data: campaigns });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'LIST_FAILED';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  let body: CampaignInput & { send_immediately?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'INVALID_JSON' }, { status: 400 });
  }

  const actor = await getAdminActor();
  if (!actor) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  const supabase = getServiceSupabase();

  try {
    const campaign = await CampaignService.createCampaign(supabase, body, actor);

    // Send-immediately path enqueues the fan-out worker. Scheduled campaigns
    // are picked up by the scheduledCampaignCronFn at run-time.
    if (body.send_immediately && !body.scheduled_at) {
      await inngest.send({
        name: 'autolenis/campaign.execute',
        data: { campaign_id: campaign.id },
      });
    }

    return NextResponse.json({ campaign }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'CREATE_FAILED';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
