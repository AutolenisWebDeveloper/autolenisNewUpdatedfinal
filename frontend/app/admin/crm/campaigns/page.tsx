import { getServiceSupabase } from '@/lib/supabase-service';
import { CampaignService } from '@/lib/services/campaign.service';
import type { Campaign } from '@/lib/types/crm';
import { CampaignListClient } from '@/components/admin/crm/CampaignListClient';

export const dynamic = 'force-dynamic';

export default async function CampaignsPage() {
  const supabase = getServiceSupabase();
  let campaigns: Campaign[] = [];
  let loadError: string | null = null;
  try {
    campaigns = await CampaignService.listCampaigns(supabase);
  } catch (err) {
    loadError = err instanceof Error ? err.message : 'LOAD_FAILED';
  }

  return <CampaignListClient campaigns={campaigns} loadError={loadError} />;
}
