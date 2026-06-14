import { NextResponse } from 'next/server';
import { getAdminActor } from '@/lib/auth/admin-actor';
import { getServiceSupabase } from '@/lib/supabase-service';
import { CampaignService } from '@/lib/services/campaign.service';

export const dynamic = 'force-dynamic';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const actor = await getAdminActor();
  if (!actor) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });

  const { id } = await params;
  const supabase = getServiceSupabase();

  const campaign = await CampaignService.getCampaign(supabase, id);
  if (!campaign) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });

  // Recipient summary — counts by status. Useful for the campaign detail
  // view that shows progress through the funnel.
  const { data: recipientCounts } = await supabase
    .from('campaign_recipients')
    .select('status', { count: 'exact', head: false })
    .eq('campaign_id', id);

  const summary: Record<string, number> = {};
  for (const row of (recipientCounts ?? []) as Array<{ status: string }>) {
    summary[row.status] = (summary[row.status] ?? 0) + 1;
  }

  return NextResponse.json({ campaign, recipient_summary: summary });
}
