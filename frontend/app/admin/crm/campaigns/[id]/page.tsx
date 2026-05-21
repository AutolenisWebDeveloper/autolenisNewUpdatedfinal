import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ChevronLeft, Mail, MessageSquare, Layers } from 'lucide-react';
import { getServiceSupabase } from '@/lib/supabase-service';
import { CampaignService } from '@/lib/services/campaign.service';
import type { CampaignStatus, CampaignType } from '@/lib/types/crm';

export const dynamic = 'force-dynamic';

const STATUS_BADGE: Record<CampaignStatus, string> = {
  draft: 'bg-gray-700/40 text-gray-400',
  scheduled: 'bg-blue-500/15 text-blue-300',
  running: 'bg-yellow-500/15 text-yellow-400',
  paused: 'bg-orange-500/15 text-orange-400',
  completed: 'bg-emerald-500/15 text-emerald-400',
  cancelled: 'bg-red-500/15 text-red-400',
};

const TYPE_ICON: Record<CampaignType, typeof Mail> = {
  email: Mail,
  sms: MessageSquare,
  mixed: Layers,
};

const FUNNEL_ORDER = [
  'pending', 'sent', 'delivered', 'opened', 'clicked',
  'bounced', 'failed', 'unsubscribed', 'suppressed',
];

export default async function CampaignDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = getServiceSupabase();

  const campaign = await CampaignService.getCampaign(supabase, id);
  if (!campaign) notFound();

  const { data: recipientCounts } = await supabase
    .from('campaign_recipients')
    .select('status')
    .eq('campaign_id', id);

  const summary: Record<string, number> = {};
  for (const row of (recipientCounts ?? []) as Array<{ status: string }>) {
    summary[row.status] = (summary[row.status] ?? 0) + 1;
  }

  const TypeIcon = TYPE_ICON[campaign.type];

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <header className="mb-6">
        <Link
          href="/admin/crm/campaigns"
          className="flex items-center gap-1 text-xs text-gray-500 hover:text-white transition-colors mb-3"
        >
          <ChevronLeft className="w-3.5 h-3.5" /> Campaigns
        </Link>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-white">{campaign.name}</h1>
            <div className="flex items-center gap-3 mt-1.5">
              <span className="inline-flex items-center gap-1 text-xs text-gray-500">
                <TypeIcon className="w-3.5 h-3.5" /> {campaign.type}
              </span>
              <span
                className={`inline-flex items-center text-[10px] font-semibold px-2 py-0.5 rounded-full uppercase tracking-wider ${STATUS_BADGE[campaign.status]}`}
              >
                {campaign.status}
              </span>
              {campaign.scheduled_at && (
                <span className="text-[11px] text-gray-500">
                  Scheduled {new Date(campaign.scheduled_at).toLocaleString()}
                </span>
              )}
            </div>
          </div>
        </div>
      </header>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <MetricCard label="Recipients" value={campaign.recipient_count} />
        <MetricCard label="Sent" value={campaign.sent_count} />
        <MetricCard label="Delivered" value={campaign.delivered_count} />
        <MetricCard label="Opened" value={campaign.opened_count} />
        <MetricCard label="Clicked" value={campaign.clicked_count} />
        <MetricCard label="Bounced" value={campaign.bounced_count} tone="warn" />
        <MetricCard label="Unsubscribed" value={campaign.unsubscribed_count} tone="warn" />
        <MetricCard label="Suppressed" value={campaign.suppressed_count} tone="muted" />
      </div>

      <section className="bg-gray-900 border border-gray-800 rounded-xl p-5">
        <div className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-3">
          Recipient breakdown
        </div>
        <div className="space-y-2">
          {FUNNEL_ORDER.map((status) => {
            const count = summary[status] ?? 0;
            if (count === 0) return null;
            const pct = campaign.recipient_count > 0 ? (count / campaign.recipient_count) * 100 : 0;
            return (
              <div key={status}>
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className="text-gray-400 capitalize">{status}</span>
                  <span className="text-gray-300 font-mono">
                    {count.toLocaleString()} ({pct.toFixed(1)}%)
                  </span>
                </div>
                <div className="h-1.5 bg-gray-950 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-blue-500"
                    style={{ width: `${Math.min(pct, 100)}%` }}
                  />
                </div>
              </div>
            );
          })}
          {Object.keys(summary).length === 0 && (
            <div className="text-xs text-gray-600 italic">
              No recipients written yet — campaign hasn{`'`}t started fan-out.
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function MetricCard({
  label,
  value,
  tone = 'default',
}: {
  label: string;
  value: number;
  tone?: 'default' | 'warn' | 'muted';
}) {
  const toneClass =
    tone === 'warn'
      ? 'text-yellow-400'
      : tone === 'muted'
        ? 'text-gray-500'
        : 'text-white';
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
      <div className="text-[10px] uppercase tracking-wider text-gray-600">{label}</div>
      <div className={`text-xl font-bold ${toneClass} mt-0.5 tabular-nums`}>
        {value.toLocaleString()}
      </div>
    </div>
  );
}
