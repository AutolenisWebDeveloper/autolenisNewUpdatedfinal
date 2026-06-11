'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import type { LucideIcon } from 'lucide-react';
import { Tabs, type TabItem } from './ui';

export type AnalyticsTabKey =
  | 'funnel'
  | 'campaigns'
  | 'automations'
  | 'dealers'
  | 'affiliates'
  | 'revenue'
  | 'reputation';

export function AnalyticsTabs({
  tabs,
  active,
}: {
  tabs: { key: AnalyticsTabKey; label: string; icon: LucideIcon }[];
  active: AnalyticsTabKey;
}) {
  const router = useRouter();
  const sp = useSearchParams();

  function selectTab(key: string) {
    const params = new URLSearchParams(sp?.toString() ?? '');
    if (key === 'funnel') params.delete('tab');
    else params.set('tab', key);
    const qs = params.toString();
    router.push(qs ? `/admin/crm/analytics?${qs}` : '/admin/crm/analytics');
  }

  const items: TabItem[] = tabs.map((t) => ({ id: t.key, label: t.label }));

  return (
    <Tabs
      tabs={items}
      value={active}
      onValueChange={selectTab}
      data-testid="crm-analytics-tabs"
    />
  );
}
