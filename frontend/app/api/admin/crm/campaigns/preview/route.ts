import { NextResponse } from 'next/server';
import { getServiceSupabase } from '@/lib/supabase-service';
import { CampaignService } from '@/lib/services/campaign.service';
import type { CampaignType } from '@/lib/types/crm';

export const dynamic = 'force-dynamic';

// Recipient preview for the campaign builder. Mirrors what the fan-out
// worker will compute — segment size, suppression count, will-receive.
export async function POST(req: Request) {
  let body: { type: CampaignType; segment_id: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'INVALID_JSON' }, { status: 400 });
  }

  if (!body.type || !body.segment_id) {
    return NextResponse.json({ error: 'MISSING_REQUIRED_FIELDS' }, { status: 400 });
  }

  const supabase = getServiceSupabase();
  try {
    const preview = await CampaignService.previewCampaign(supabase, body);
    return NextResponse.json({ preview });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'PREVIEW_FAILED';
    const status = message === 'SEGMENT_NOT_FOUND' ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
