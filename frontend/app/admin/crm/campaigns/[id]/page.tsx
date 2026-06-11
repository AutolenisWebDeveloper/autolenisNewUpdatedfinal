import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ChevronLeft, Mail, MessageSquare, Layers } from 'lucide-react';
import { getServiceSupabase } from '@/lib/supabase-service';
import { CampaignService } from '@/lib/services/campaign.service';
import type { CampaignStatus, CampaignType } from '@/lib/types/crm';
import { KpiCard, PageHeader, StatusPill, type Tone } from '@/components/admin/crm/ui';

export const dynamic = 'force-dynamic';

const STATUS_TONE: Record<CampaignStatus, Tone> = {
  draft: 'neutral',
  scheduled: 'info',
  running: 'primary',
  paused: 'warning',
  completed: 'success',
  cancelled: 'danger',
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
    <div className="mx-auto max-w-5xl space-y-6 p-6" data-testid="crm-campaign-detail">
      <div>
        <Link
          href="/admin/crm/campaigns"
          data-testid="crm-campaign-detail-back"
          className="mb-3 inline-flex items-center gap-1 text-[12px] text-[var(--crm-text-tertiary)] transition-colors hover:text-[var(--crm-text-primary)]"
        >
          <ChevronLeft className="h-3.5 w-3.5" /> Campaigns
        </Link>
        <PageHeader
          title={campaign.name}
          data-testid="crm-campaign-detail-header"
          actions={
            <div className="flex items-center gap-3">
              <span className="inline-flex items-center gap-1 text-[12px] capitalize text-[var(--crm-text-tertiary)]">
                <TypeIcon className="h-3.5 w-3.5" /> {campaign.type}
              </span>
              <StatusPill tone={STATUS_TONE[campaign.status]} size="sm" className="capitalize" data-testid="crm-campaign-detail-status">
                {campaign.status}
              </StatusPill>
              {campaign.scheduled_at && (
                <span className="text-[12px] text-[var(--crm-text-tertiary)]">
                  Scheduled {new Date(campaign.scheduled_at).toLocaleString()}
                </span>
              )}
            </div>
          }
        />
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4" data-testid="crm-campaign-detail-metrics">
        <KpiCard label="Recipients" value={campaign.recipient_count.toLocaleString()} />
        <KpiCard label="Sent" value={campaign.sent_count.toLocaleString()} />
        <KpiCard label="Delivered" value={campaign.delivered_count.toLocaleString()} />
        <KpiCard label="Opened" value={campaign.opened_count.toLocaleString()} />
        <KpiCard label="Clicked" value={campaign.clicked_count.toLocaleString()} />
        <KpiCard label="Bounced" value={campaign.bounced_count.toLocaleString()} />
        <KpiCard label="Unsubscribed" value={campaign.unsubscribed_count.toLocaleString()} />
        <KpiCard label="Suppressed" value={campaign.suppressed_count.toLocaleString()} />
      </div>

      <section
        className="rounded-[var(--crm-radius-md)] border border-[var(--crm-border)] crm-hairline bg-[var(--crm-bg-primary)] p-5"
        data-testid="crm-campaign-detail-breakdown"
      >
        <div className="mb-3 text-[11px] font-medium uppercase tracking-wide text-[var(--crm-text-tertiary)]">
          Recipient breakdown
        </div>
        <div className="space-y-2">
          {FUNNEL_ORDER.map((status) => {
            const count = summary[status] ?? 0;
            if (count === 0) return null;
            const pct = campaign.recipient_count > 0 ? (count / campaign.recipient_count) * 100 : 0;
            return (
              <div key={status}>
                <div className="mb-1 flex items-center justify-between text-[12px]">
                  <span className="capitalize text-[var(--crm-text-secondary)]">{status}</span>
                  <span className="tabular-nums text-[var(--crm-text-tertiary)]">
                    {count.toLocaleString()} ({pct.toFixed(1)}%)
                  </span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-[var(--crm-bg-tertiary)]">
                  <div
                    className="h-full rounded-full bg-[var(--crm-primary)]"
                    style={{ width: `${Math.min(pct, 100)}%` }}
                  />
                </div>
              </div>
            );
          })}
          {Object.keys(summary).length === 0 && (
            <div className="text-[12px] italic text-[var(--crm-text-tertiary)]">
              No recipients written yet — campaign hasn{`'`}t started fan-out.
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
