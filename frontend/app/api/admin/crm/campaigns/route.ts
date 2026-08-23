import { NextResponse } from 'next/server';
import { getServiceSupabase } from '@/lib/supabase-service';
import { CampaignService, type CampaignInput } from '@/lib/services/campaign.service';
import { requirePermissionActor } from '@/lib/auth/permissions';
import type { CampaignStatus } from '@/lib/types/crm';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const actor = await requirePermissionActor("crm.read");
  if (!actor) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });

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

  const actor = await requirePermissionActor("crm.manage");
  if (!actor) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  const supabase = getServiceSupabase();

  try {
    const campaign = await CampaignService.createCampaign(supabase, body, actor);

    // Send-immediately path: mark the campaign scheduled-now so the internal
    // campaign-dispatch cron picks it up on its next tick (unified with scheduled
    // campaigns — no Inngest event). createCampaign leaves an immediate campaign in
    // 'draft'; this flips it to a due 'scheduled' row.
    if (body.send_immediately && !body.scheduled_at) {
      await supabase
        .from('campaigns')
        .update({ status: 'scheduled', scheduled_at: new Date().toISOString() })
        .eq('id', campaign.id);
    }

    return NextResponse.json({ campaign }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'CREATE_FAILED';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
