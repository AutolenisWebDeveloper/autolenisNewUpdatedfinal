// lib/services/analytics/content-attribution-analytics.service.ts
// Phase C-Attribution — content conversion reporting data layer.
//
// READ-ONLY (aside from a best-effort reconcile pass). Reports content-engine
// leads and conversions broken out by cluster, city, metro, and state — the two
// added national dimensions (metro, state) sit alongside the original cluster
// and city reporting. Degrades to a safe empty state on any error so the
// dashboard always renders, even on an empty database.

import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { reconcileContentConversions } from "@/lib/analytics/content-attribution.server";

function pct(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return Math.round((numerator / denominator) * 1000) / 10; // one decimal place
}

export interface AttributionDimensionRow {
  key: string;
  leads: number;
  conversions: number;
  conversionRate: number; // % of leads that converted
  valueCents: number; // sum of converted deposit value
}

export interface AttributionTrendPoint {
  date: string; // YYYY-MM-DD
  leads: number;
  conversions: number;
}

export interface ContentAttributionReport {
  totals: {
    leads: number;
    conversions: number;
    conversionRate: number;
    valueCents: number;
  };
  byCluster: AttributionDimensionRow[];
  byMetro: AttributionDimensionRow[];
  byState: AttributionDimensionRow[];
  byCity: AttributionDimensionRow[]; // key = "City, ST"
  topArticles: AttributionDimensionRow[]; // key = article slug
  dailyTrend: AttributionTrendPoint[]; // last 30 days
  generatedAt: string;
}

const EMPTY_REPORT: ContentAttributionReport = {
  totals: { leads: 0, conversions: 0, conversionRate: 0, valueCents: 0 },
  byCluster: [],
  byMetro: [],
  byState: [],
  byCity: [],
  topArticles: [],
  dailyTrend: [],
  generatedAt: new Date(0).toISOString(),
};

const TREND_DAYS = 30;

interface Row {
  cluster: string;
  city: string;
  state: string;
  metro: string | null;
  articleSlug: string;
  converted: boolean;
  conversionValueCents: number | null;
  createdAt: Date;
  convertedAt: Date | null;
}

/** Last `TREND_DAYS` days of leads (by createdAt) and conversions (by convertedAt). */
function buildTrend(rows: Row[]): AttributionTrendPoint[] {
  const map = new Map<string, { leads: number; conversions: number }>();
  for (let i = TREND_DAYS - 1; i >= 0; i--) {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - i);
    map.set(d.toISOString().slice(0, 10), { leads: 0, conversions: 0 });
  }
  for (const r of rows) {
    const leadKey = r.createdAt.toISOString().slice(0, 10);
    const leadBucket = map.get(leadKey);
    if (leadBucket) leadBucket.leads += 1;
    if (r.converted && r.convertedAt) {
      const convKey = r.convertedAt.toISOString().slice(0, 10);
      const convBucket = map.get(convKey);
      if (convBucket) convBucket.conversions += 1;
    }
  }
  return [...map.entries()].map(([date, v]) => ({ date, ...v }));
}

function aggregate(rows: Row[], keyFn: (r: Row) => string | null): AttributionDimensionRow[] {
  const map = new Map<string, { leads: number; conversions: number; valueCents: number }>();
  for (const r of rows) {
    const key = keyFn(r);
    if (!key) continue;
    const cur = map.get(key) ?? { leads: 0, conversions: 0, valueCents: 0 };
    cur.leads += 1;
    if (r.converted) {
      cur.conversions += 1;
      cur.valueCents += r.conversionValueCents ?? 0;
    }
    map.set(key, cur);
  }
  return [...map.entries()]
    .map(([key, v]) => ({
      key,
      leads: v.leads,
      conversions: v.conversions,
      conversionRate: pct(v.conversions, v.leads),
      valueCents: v.valueCents,
    }))
    .sort((a, b) => b.leads - a.leads || b.conversions - a.conversions);
}

export async function getContentAttributionReport(): Promise<ContentAttributionReport> {
  try {
    // Bring conversion outcomes up to date before reading (best-effort).
    await reconcileContentConversions();

    const rows: Row[] = await prisma.contentAttribution.findMany({
      select: {
        cluster: true,
        city: true,
        state: true,
        metro: true,
        articleSlug: true,
        converted: true,
        conversionValueCents: true,
        createdAt: true,
        convertedAt: true,
      },
    });

    const leads = rows.length;
    const conversions = rows.filter((r) => r.converted).length;
    const valueCents = rows.reduce(
      (sum, r) => sum + (r.converted ? r.conversionValueCents ?? 0 : 0),
      0,
    );

    return {
      totals: { leads, conversions, conversionRate: pct(conversions, leads), valueCents },
      byCluster: aggregate(rows, (r) => r.cluster || null),
      byMetro: aggregate(rows, (r) => r.metro || null),
      byState: aggregate(rows, (r) => r.state || null),
      byCity: aggregate(rows, (r) => (r.city ? `${r.city}, ${r.state}` : null)),
      topArticles: aggregate(rows, (r) => r.articleSlug || null).slice(0, 25),
      dailyTrend: buildTrend(rows),
      generatedAt: new Date().toISOString(),
    };
  } catch (err) {
    logger.error("[content-attribution] getContentAttributionReport failed", err);
    return { ...EMPTY_REPORT, generatedAt: new Date().toISOString() };
  }
}
