import Link from 'next/link';
import { Send, Plus, Mail, MessageSquare, Layers } from 'lucide-react';
import { getServiceSupabase } from '@/lib/supabase-service';
import { CampaignService } from '@/lib/services/campaign.service';
import type { Campaign, CampaignStatus, CampaignType } from '@/lib/types/crm';

export const dynamic = 'force-dynamic';

const STATUS_BADGE: Record<CampaignStatus, string> = {
  draft: 'bg-gray-700/40 text-gray-400',
  scheduled: 'bg-blue-500/15 text-blue-300',
  running: 'bg-yellow-500/15 text-yellow-400 animate-pulse',
  paused: 'bg-orange-500/15 text-orange-400',
  completed: 'bg-emerald-500/15 text-emerald-400',
  cancelled: 'bg-red-500/15 text-red-400',
};

const TYPE_ICON: Record<CampaignType, typeof Mail> = {
  email: Mail,
  sms: MessageSquare,
  mixed: Layers,
};

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 0) {
    const min = Math.floor(-diff / 60_000);
    if (min < 60) return `in ${min}m`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `in ${hr}h`;
    return `in ${Math.floor(hr / 24)}d`;
  }
  const min = Math.floor(diff / 60_000);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}

export default async function CampaignsPage() {
  const supabase = getServiceSupabase();
  let campaigns: Campaign[] = [];
  let loadError: string | null = null;
  try {
    campaigns = await CampaignService.listCampaigns(supabase);
  } catch (err) {
    loadError = err instanceof Error ? err.message : 'LOAD_FAILED';
  }

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <header className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            <Send className="w-5 h-5 text-blue-500" />
            Campaigns
          </h1>
          <p className="text-xs text-gray-500 mt-1">
            Email + SMS sends to dynamic audiences. Fan-out runs on Inngest.
          </p>
        </div>
        <Link
          href="/admin/crm/campaigns/new"
          className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium px-3.5 py-2 rounded-lg transition-colors"
        >
          <Plus className="w-4 h-4" /> New Campaign
        </Link>
      </header>

      {loadError ? (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 text-sm text-red-300">
          Failed to load campaigns: {loadError}
        </div>
      ) : campaigns.length === 0 ? (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-12 text-center">
          <Send className="w-12 h-12 text-gray-700 mx-auto mb-3" />
          <p className="text-sm text-gray-400 font-medium">No campaigns yet</p>
          <p className="text-xs text-gray-600 mt-1 max-w-sm mx-auto">
            Campaigns send to a segment using one template (email) or message body (SMS),
            with suppression + DNC + consent gates enforced at fan-out time.
          </p>
          <Link
            href="/admin/crm/campaigns/new"
            className="inline-flex items-center gap-1.5 mt-4 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium px-3.5 py-2 rounded-lg transition-colors"
          >
            <Plus className="w-4 h-4" /> New Campaign
          </Link>
        </div>
      ) : (
        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-800">
                <th className="text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider px-5 py-3">Name</th>
                <th className="text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider px-5 py-3">Type</th>
                <th className="text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider px-5 py-3">Status</th>
                <th className="text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider px-5 py-3">Recipients</th>
                <th className="text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider px-5 py-3">Sent</th>
                <th className="text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider px-5 py-3">Created</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800/50">
              {campaigns.map((c) => {
                const Icon = TYPE_ICON[c.type];
                return (
                  <tr key={c.id} className="hover:bg-gray-800/30 transition-colors">
                    <td className="px-5 py-3">
                      <Link
                        href={`/admin/crm/campaigns/${c.id}`}
                        className="text-sm font-medium text-white hover:text-blue-300 transition-colors"
                      >
                        {c.name}
                      </Link>
                    </td>
                    <td className="px-5 py-3">
                      <span className="inline-flex items-center gap-1 text-[11px] text-gray-400">
                        <Icon className="w-3 h-3" />
                        {c.type}
                      </span>
                    </td>
                    <td className="px-5 py-3">
                      <span className={`inline-flex items-center text-[10px] font-semibold px-2 py-0.5 rounded-full uppercase tracking-wider ${STATUS_BADGE[c.status]}`}>
                        {c.status}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-xs text-gray-300 font-mono">
                      {c.recipient_count.toLocaleString()}
                    </td>
                    <td className="px-5 py-3 text-xs text-gray-300 font-mono">
                      {c.sent_count.toLocaleString()}
                    </td>
                    <td className="px-5 py-3 text-xs text-gray-500">{relativeTime(c.created_at)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
