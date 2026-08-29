import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { prisma } from '@/lib/prisma';
import { ledgerEarnedWhere } from '@/lib/services/affiliate/commission.service';
import type { LifecycleStage } from '@/lib/types/crm';

// ----------------------------------------------------------------------------
// AutoLenis Phase 5 — Analytics aggregation layer.
//
// Each section of the analytics dashboard maps 1:1 to a method on this class.
// Methods are pure aggregations: no side effects, no caching beyond the
// underlying matview. Each one is independently parallelizable from the
// dashboard server component so a slow tab never blocks the rest of the page.
// ----------------------------------------------------------------------------

// ──────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────

export interface FunnelStageRow {
  stage: LifecycleStage;
  label: string;
  count: number;
  pct_of_leads: number;
}

export interface FunnelConversionRow {
  from_stage: LifecycleStage;
  to_stage: LifecycleStage;
  from_count: number;
  to_count: number;
  conversion_pct: number;
}

export interface FunnelMetrics {
  total_leads: number;
  stages: FunnelStageRow[];
  conversions: FunnelConversionRow[];
}

export interface CampaignMetricsRow {
  id: string;
  name: string;
  type: 'email' | 'sms' | 'mixed';
  status: string;
  sent_at: string | null;
  recipient_count: number;
  sent_count: number;
  delivered_count: number;
  opened_count: number;
  clicked_count: number;
  bounced_count: number;
  unsubscribed_count: number;
  open_rate: number;
  click_rate: number;
  bounce_rate: number;
  unsubscribe_rate: number;
  health: 'ok' | 'warning' | 'critical';
}

export interface AutomationMetricsRow {
  id: string;
  name: string;
  status: string;
  enrolled: number;
  active: number;
  completed: number;
  exited: number;
  failed: number;
  completion_rate: number;
  top_failure_node: string | null;
  top_failure_count: number;
}

export interface DealerMetricsRow {
  id: string;
  name: string;
  status: string;
  offers_submitted: number;
  offers_accepted: number;
  win_rate: number;
  avg_response_hours: number | null;
  last_active_at: string | null;
}

export interface AffiliateMetricsRow {
  id: string;
  referral_code: string;
  status: string;
  referrals_sent: number;
  referrals_converted: number;
  conversion_rate: number;
  commission_cents: number;
}

export interface RevenueMetrics {
  deposits_collected_cents: number;
  deposits_count: number;
  purchase_volume_cents: number;
  purchases_count: number;
  refunds_cents: number;
  refunds_count: number;
  net_revenue_cents: number;
}

export interface ReputationMetrics {
  email_total_sent: number;
  email_bounced: number;
  email_complained: number;
  email_unsubscribed: number;
  email_bounce_rate: number;
  email_complaint_rate: number;
  sms_total_sent: number;
  sms_stopped: number;
  sms_optout_rate: number;
  bounce_trend: { day: string; bounce_rate: number }[];
  reputation_status: 'ok' | 'warning' | 'critical';
}

export interface FunnelDayPoint {
  day: string;
  total_contacts: number;
  started_prequal: number;
  deposited: number;
  auction_active: number;
  purchased: number;
}

// ──────────────────────────────────────────────────────────────────────────
// Constants
// ──────────────────────────────────────────────────────────────────────────

const STAGE_ORDER: LifecycleStage[] = [
  'lead',
  'prequal_started',
  'prequal_completed',
  'deposit_pending',
  'deposit_paid',
  'auction_active',
  'offer_received',
  'purchase_completed',
];

const STAGE_LABEL: Record<LifecycleStage, string> = {
  lead: 'Lead',
  prequal_started: 'Prequal Started',
  prequal_completed: 'Prequal Completed',
  deposit_pending: 'Deposit Pending',
  deposit_paid: 'Deposit Paid',
  auction_active: 'Auction Active',
  offer_received: 'Offer Received',
  purchase_completed: 'Purchased',
  inactive: 'Inactive',
};

// Email reputation thresholds — sourced from Resend / SES carrier guidance.
const EMAIL_BOUNCE_WARN = 0.02;     // 2%
const EMAIL_BOUNCE_CRIT = 0.05;     // 5%
const EMAIL_COMPLAINT_WARN = 0.001; // 0.1%

function pct(num: number, denom: number): number {
  if (!denom) return 0;
  return Math.round((num / denom) * 1000) / 10; // one decimal place
}

// ──────────────────────────────────────────────────────────────────────────
// Service
// ──────────────────────────────────────────────────────────────────────────

export class AnalyticsService {
  constructor(private supabase: SupabaseClient) {}

  // ────────────────────────────────────────────────────────────────────────
  // FUNNEL — stage distribution + sequential conversion rates
  // ────────────────────────────────────────────────────────────────────────
  async getFunnel(): Promise<FunnelMetrics> {
    const { data } = await this.supabase
      .from('contacts')
      .select('lifecycle_stage')
      .is('deleted_at', null);

    const counts: Record<LifecycleStage, number> = {
      lead: 0,
      prequal_started: 0,
      prequal_completed: 0,
      deposit_pending: 0,
      deposit_paid: 0,
      auction_active: 0,
      offer_received: 0,
      purchase_completed: 0,
      inactive: 0,
    };
    for (const row of data ?? []) {
      const s = row.lifecycle_stage as LifecycleStage;
      if (s in counts) counts[s] += 1;
    }

    // Forward-inclusive counts: "got to at least this stage". A contact in
    // purchase_completed has by definition passed through every preceding
    // stage, so the funnel needs cumulative-from-bottom math.
    const reachable: Record<LifecycleStage, number> = {
      lead: 0,
      prequal_started: 0,
      prequal_completed: 0,
      deposit_pending: 0,
      deposit_paid: 0,
      auction_active: 0,
      offer_received: 0,
      purchase_completed: 0,
      inactive: 0,
    };
    let running = 0;
    for (let i = STAGE_ORDER.length - 1; i >= 0; i--) {
      const stage = STAGE_ORDER[i];
      running += counts[stage];
      reachable[stage] = running;
    }

    const totalLeads = reachable.lead || 1;
    const stages: FunnelStageRow[] = STAGE_ORDER.map((stage) => ({
      stage,
      label: STAGE_LABEL[stage],
      count: reachable[stage],
      pct_of_leads: pct(reachable[stage], totalLeads),
    }));

    const conversions: FunnelConversionRow[] = [];
    for (let i = 0; i < STAGE_ORDER.length - 1; i++) {
      const from = STAGE_ORDER[i];
      const to = STAGE_ORDER[i + 1];
      conversions.push({
        from_stage: from,
        to_stage: to,
        from_count: reachable[from],
        to_count: reachable[to],
        conversion_pct: pct(reachable[to], reachable[from]),
      });
    }

    return {
      total_leads: counts.lead + reachable.prequal_started, // raw lead inflow
      stages,
      conversions,
    };
  }

  // ────────────────────────────────────────────────────────────────────────
  // FUNNEL TREND — 30-day series from the matview
  // ────────────────────────────────────────────────────────────────────────
  async getFunnelTrend(days = 30): Promise<FunnelDayPoint[]> {
    const cutoff = new Date(Date.now() - days * 86400 * 1000)
      .toISOString()
      .slice(0, 10);
    const { data, error } = await this.supabase
      .from('mv_funnel_metrics')
      .select('day,total_contacts,started_prequal,deposited,auction_active,purchased')
      .gte('day', cutoff)
      .order('day', { ascending: true });

    // Matview may not have been refreshed yet on a fresh install — return
    // empty rather than crashing the dashboard render.
    if (error) return [];

    return (data ?? []).map((r) => ({
      day: String(r.day),
      total_contacts: Number(r.total_contacts ?? 0),
      started_prequal: Number(r.started_prequal ?? 0),
      deposited: Number(r.deposited ?? 0),
      auction_active: Number(r.auction_active ?? 0),
      purchased: Number(r.purchased ?? 0),
    }));
  }

  // ────────────────────────────────────────────────────────────────────────
  // CAMPAIGNS — last 50 with computed rates + health flag
  // ────────────────────────────────────────────────────────────────────────
  async getCampaignMetrics(limit = 50): Promise<CampaignMetricsRow[]> {
    const { data } = await this.supabase
      .from('campaigns')
      .select(
        'id,name,type,status,started_at,recipient_count,sent_count,delivered_count,opened_count,clicked_count,bounced_count,failed_count,unsubscribed_count,suppressed_count'
      )
      .order('created_at', { ascending: false })
      .limit(limit);

    return (data ?? []).map((c) => {
      const sent = Number(c.sent_count ?? 0);
      const delivered = Number(c.delivered_count ?? 0);
      const opened = Number(c.opened_count ?? 0);
      const clicked = Number(c.clicked_count ?? 0);
      const bounced = Number(c.bounced_count ?? 0);
      const unsub = Number(c.unsubscribed_count ?? 0);

      const openRate = pct(opened, delivered);
      const clickRate = pct(clicked, delivered);
      const bounceRate = pct(bounced, sent);
      const unsubRate = pct(unsub, delivered);

      let health: 'ok' | 'warning' | 'critical' = 'ok';
      if (bounceRate >= EMAIL_BOUNCE_CRIT * 100) health = 'critical';
      else if (bounceRate >= EMAIL_BOUNCE_WARN * 100) health = 'warning';

      return {
        id: String(c.id),
        name: String(c.name),
        type: c.type as 'email' | 'sms' | 'mixed',
        status: String(c.status),
        sent_at: c.started_at ? String(c.started_at) : null,
        recipient_count: Number(c.recipient_count ?? 0),
        sent_count: sent,
        delivered_count: delivered,
        opened_count: opened,
        clicked_count: clicked,
        bounced_count: bounced,
        unsubscribed_count: unsub,
        open_rate: openRate,
        click_rate: clickRate,
        bounce_rate: bounceRate,
        unsubscribe_rate: unsubRate,
        health,
      };
    });
  }

  // ────────────────────────────────────────────────────────────────────────
  // AUTOMATIONS — enrolment funnel + most-failed step per workflow
  // ────────────────────────────────────────────────────────────────────────
  async getAutomationMetrics(): Promise<AutomationMetricsRow[]> {
    const [{ data: workflows }, { data: enrollments }, { data: failures }] =
      await Promise.all([
        this.supabase
          .from('workflows')
          .select('id,name,status')
          .neq('status', 'archived')
          .order('created_at', { ascending: false }),
        this.supabase
          .from('workflow_enrollments')
          .select('id,workflow_id,status'),
        this.supabase
          .from('workflow_execution_log')
          .select('enrollment_id,node_id,status')
          .eq('status', 'failed'),
      ]);

    type EnrCounts = {
      enrolled: number;
      active: number;
      completed: number;
      exited: number;
      failed: number;
    };
    const byWorkflow = new Map<string, EnrCounts>();
    // workflow_execution_log carries only enrollment_id; join in memory rather
    // than running a per-enrollment lookup.
    const enrollmentToWorkflow = new Map<string, string>();
    for (const e of enrollments ?? []) {
      const wid = String(e.workflow_id);
      enrollmentToWorkflow.set(String(e.id), wid);
      const c =
        byWorkflow.get(wid) ??
        { enrolled: 0, active: 0, completed: 0, exited: 0, failed: 0 };
      c.enrolled += 1;
      if (e.status === 'active') c.active += 1;
      else if (e.status === 'completed') c.completed += 1;
      else if (e.status === 'exited') c.exited += 1;
      else if (e.status === 'failed') c.failed += 1;
      byWorkflow.set(wid, c);
    }

    // node_id → count, scoped per workflow_id
    const failureByWorkflow = new Map<string, Map<string, number>>();
    for (const f of failures ?? []) {
      const wid = enrollmentToWorkflow.get(String(f.enrollment_id));
      if (!wid) continue;
      const inner = failureByWorkflow.get(wid) ?? new Map<string, number>();
      const node = String(f.node_id);
      inner.set(node, (inner.get(node) ?? 0) + 1);
      failureByWorkflow.set(wid, inner);
    }

    return (workflows ?? []).map((w) => {
      const c =
        byWorkflow.get(String(w.id)) ??
        { enrolled: 0, active: 0, completed: 0, exited: 0, failed: 0 };
      const inner = failureByWorkflow.get(String(w.id));
      let topNode: string | null = null;
      let topCount = 0;
      if (inner) {
        for (const [node, count] of inner) {
          if (count > topCount) {
            topNode = node;
            topCount = count;
          }
        }
      }
      return {
        id: String(w.id),
        name: String(w.name),
        status: String(w.status),
        enrolled: c.enrolled,
        active: c.active,
        completed: c.completed,
        exited: c.exited,
        failed: c.failed,
        completion_rate: pct(c.completed, c.enrolled),
        top_failure_node: topNode,
        top_failure_count: topCount,
      };
    });
  }

  // ────────────────────────────────────────────────────────────────────────
  // DEALERS — offers, win rate, avg response time, recency (via Prisma)
  // ────────────────────────────────────────────────────────────────────────
  async getDealerMetrics(): Promise<DealerMetricsRow[]> {
    const dealers = await prisma.dealer.findMany({
      where: { status: { in: ['ACTIVE', 'PENDING'] } },
      select: {
        id: true,
        dealershipName: true,
        status: true,
        offers: {
          select: {
            id: true,
            status: true,
            createdAt: true,
            submittedAt: true,
            auction: { select: { startedAt: true } },
          },
        },
      },
    });

    return dealers
      .map((d) => {
        const submitted = d.offers.filter((o) => o.status !== 'DRAFT');
        const accepted = submitted.filter((o) => o.status === 'ACCEPTED').length;

        // Avg response time = auction.startedAt → offer.submittedAt, only when
        // both are known. Drops null pairs rather than counting them as zero.
        const responseDeltas: number[] = [];
        let lastActive: Date | null = null;
        for (const o of d.offers) {
          const at = o.submittedAt ?? o.createdAt;
          if (!lastActive || at > lastActive) lastActive = at;
          if (o.submittedAt && o.auction?.startedAt) {
            responseDeltas.push(
              (o.submittedAt.getTime() - o.auction.startedAt.getTime()) / 3600000
            );
          }
        }
        const avgHours =
          responseDeltas.length === 0
            ? null
            : Math.round(
                (responseDeltas.reduce((a, b) => a + b, 0) / responseDeltas.length) *
                  10
              ) / 10;

        return {
          id: d.id,
          name: d.dealershipName,
          status: d.status,
          offers_submitted: submitted.length,
          offers_accepted: accepted,
          win_rate: pct(accepted, submitted.length),
          avg_response_hours: avgHours,
          last_active_at: lastActive?.toISOString() ?? null,
        };
      })
      .sort((a, b) => b.offers_submitted - a.offers_submitted);
  }

  // ────────────────────────────────────────────────────────────────────────
  // AFFILIATES — referrals, conversion, total commission
  // ────────────────────────────────────────────────────────────────────────
  async getAffiliateMetrics(): Promise<AffiliateMetricsRow[]> {
    // D11 — all aggregation happens in the database. The old version loaded
    // every affiliate with their ENTIRE commission history plus the whole
    // affiliate_referrals table into JS and reduced money client-side.
    const [affiliates, commissionSums, referralsSent, referralsConverted] = await Promise.all([
      prisma.affiliate.findMany({
        where: { status: { in: ['ACTIVE', 'PENDING'] } },
        select: { id: true, referralCode: true, status: true },
      }),
      prisma.commission.groupBy({
        by: ['affiliateId', 'status'],
        // Shared ledger rule (M1): live rows + negative REVERSED clawback
        // offsets. PENDING groups are excluded below — not yet earned.
        where: ledgerEarnedWhere(),
        _sum: { amountCents: true },
      }),
      prisma.affiliateReferral.groupBy({ by: ['affiliateId'], _count: { _all: true } }),
      prisma.affiliateReferral.groupBy({
        by: ['affiliateId'],
        where: { firstDealAt: { not: null } },
        _count: { _all: true },
      }),
    ]);

    const earnedByAffiliate = new Map<string, number>();
    for (const g of commissionSums) {
      if (g.status === 'PENDING') continue; // not yet earned
      earnedByAffiliate.set(g.affiliateId, (earnedByAffiliate.get(g.affiliateId) ?? 0) + (g._sum.amountCents ?? 0));
    }
    const sentByAffiliate = new Map(referralsSent.map((g) => [g.affiliateId, g._count._all]));
    const convertedByAffiliate = new Map(referralsConverted.map((g) => [g.affiliateId, g._count._all]));

    return affiliates
      .map((a) => {
        const sent = sentByAffiliate.get(a.id) ?? 0;
        const converted = convertedByAffiliate.get(a.id) ?? 0;
        return {
          id: a.id,
          referral_code: a.referralCode,
          status: a.status,
          referrals_sent: sent,
          referrals_converted: converted,
          conversion_rate: pct(converted, sent),
          commission_cents: earnedByAffiliate.get(a.id) ?? 0,
        };
      })
      .sort((a, b) => b.commission_cents - a.commission_cents);
  }

  // ────────────────────────────────────────────────────────────────────────
  // REVENUE — deposits / purchases / refunds / net
  // ────────────────────────────────────────────────────────────────────────
  async getRevenueMetrics(): Promise<RevenueMetrics> {
    const [depositPaid, depositRefunded, dealFees, dealFeeRefunds] = await Promise.all([
      prisma.deposit.aggregate({
        _sum: { amountCents: true },
        _count: { id: true },
        where: { status: 'PAID' },
      }),
      prisma.deposit.aggregate({
        _sum: { amountCents: true },
        _count: { id: true },
        where: { status: 'REFUNDED' },
      }),
      prisma.deal.aggregate({
        _sum: { feeAmountCents: true },
        _count: { id: true },
        where: { feePaidAt: { not: null } },
      }),
      prisma.deal.aggregate({
        _sum: { feeRefundedAmountCents: true },
        _count: { id: true },
        where: { feeRefundedAt: { not: null } },
      }),
    ]);

    const depositsCollected = depositPaid._sum.amountCents ?? 0;
    const depositsCount = depositPaid._count.id ?? 0;
    const refundsDeposits = depositRefunded._sum.amountCents ?? 0;
    const refundsDepositsCount = depositRefunded._count.id ?? 0;
    const feesCollected = dealFees._sum.feeAmountCents ?? 0;
    const purchasesCount = dealFees._count.id ?? 0;
    const feeRefunds = dealFeeRefunds._sum.feeRefundedAmountCents ?? 0;
    const feeRefundsCount = dealFeeRefunds._count.id ?? 0;

    return {
      deposits_collected_cents: depositsCollected,
      deposits_count: depositsCount,
      purchase_volume_cents: feesCollected,
      purchases_count: purchasesCount,
      refunds_cents: refundsDeposits + feeRefunds,
      refunds_count: refundsDepositsCount + feeRefundsCount,
      net_revenue_cents:
        depositsCollected + feesCollected - refundsDeposits - feeRefunds,
    };
  }

  // ────────────────────────────────────────────────────────────────────────
  // REPUTATION — bounce/complaint/unsubscribe rates with health flag
  // ────────────────────────────────────────────────────────────────────────
  async getReputationMetrics(): Promise<ReputationMetrics> {
    const [
      { data: campaignTotals },
      bouncedRes,
      complainedRes,
      unsubRes,
      stoppedRes,
      smsSentRes,
      { data: bounceTrendRaw },
    ] = await Promise.all([
      this.supabase
        .from('campaigns')
        .select('type,sent_count,bounced_count,unsubscribed_count'),
      this.supabase
        .from('email_suppression')
        .select('id', { count: 'exact', head: true })
        .eq('reason', 'bounced'),
      this.supabase
        .from('email_suppression')
        .select('id', { count: 'exact', head: true })
        .eq('reason', 'complained'),
      this.supabase
        .from('email_suppression')
        .select('id', { count: 'exact', head: true })
        .eq('reason', 'unsubscribed'),
      this.supabase
        .from('sms_suppression')
        .select('id', { count: 'exact', head: true })
        .eq('reason', 'stop'),
      this.supabase
        .from('contact_timeline_events')
        .select('id', { count: 'exact', head: true })
        .eq('event_type', 'sms_sent'),
      this.supabase
        .from('contact_timeline_events')
        .select('event_type,created_at')
        .in('event_type', ['email_sent', 'email_bounced'])
        .gte(
          'created_at',
          new Date(Date.now() - 30 * 86400 * 1000).toISOString()
        ),
    ]);

    let emailSent = 0;
    let emailBouncedFromCampaigns = 0;
    let emailUnsubFromCampaigns = 0;
    for (const c of campaignTotals ?? []) {
      if (c.type === 'email' || c.type === 'mixed') {
        emailSent += Number(c.sent_count ?? 0);
        emailBouncedFromCampaigns += Number(c.bounced_count ?? 0);
        emailUnsubFromCampaigns += Number(c.unsubscribed_count ?? 0);
      }
    }

    const emailBounced = Math.max(
      bouncedRes.count ?? 0,
      emailBouncedFromCampaigns
    );
    const emailComplained = complainedRes.count ?? 0;
    const emailUnsub = Math.max(unsubRes.count ?? 0, emailUnsubFromCampaigns);
    const smsSent = smsSentRes.count ?? 0;
    const smsStopped = stoppedRes.count ?? 0;

    const bounceRate = pct(emailBounced, emailSent);
    const complaintRate = pct(emailComplained, emailSent);

    // Bucket the timeline events by day to draw a sparkline.
    const bucketed = new Map<string, { sent: number; bounced: number }>();
    for (const ev of bounceTrendRaw ?? []) {
      const day = String(ev.created_at).slice(0, 10);
      const b = bucketed.get(day) ?? { sent: 0, bounced: 0 };
      if (ev.event_type === 'email_sent') b.sent += 1;
      else if (ev.event_type === 'email_bounced') b.bounced += 1;
      bucketed.set(day, b);
    }
    const bounceTrend = Array.from(bucketed.entries())
      .map(([day, b]) => ({ day, bounce_rate: pct(b.bounced, b.sent) }))
      .sort((a, b) => a.day.localeCompare(b.day));

    let reputationStatus: 'ok' | 'warning' | 'critical' = 'ok';
    if (
      bounceRate >= EMAIL_BOUNCE_CRIT * 100 ||
      complaintRate >= EMAIL_COMPLAINT_WARN * 100 * 3
    ) {
      reputationStatus = 'critical';
    } else if (
      bounceRate >= EMAIL_BOUNCE_WARN * 100 ||
      complaintRate >= EMAIL_COMPLAINT_WARN * 100
    ) {
      reputationStatus = 'warning';
    }

    return {
      email_total_sent: emailSent,
      email_bounced: emailBounced,
      email_complained: emailComplained,
      email_unsubscribed: emailUnsub,
      email_bounce_rate: bounceRate,
      email_complaint_rate: complaintRate,
      sms_total_sent: smsSent,
      sms_stopped: smsStopped,
      sms_optout_rate: pct(smsStopped, smsSent),
      bounce_trend: bounceTrend,
      reputation_status: reputationStatus,
    };
  }
}
