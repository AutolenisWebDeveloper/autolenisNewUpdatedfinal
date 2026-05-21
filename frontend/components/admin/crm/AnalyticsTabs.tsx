'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { cn } from '@/lib/utils';
import type { LucideIcon } from 'lucide-react';

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

  function selectTab(key: AnalyticsTabKey) {
    const params = new URLSearchParams(sp?.toString() ?? '');
    if (key === 'funnel') params.delete('tab');
    else params.set('tab', key);
    const qs = params.toString();
    router.push(qs ? `/admin/crm/analytics?${qs}` : '/admin/crm/analytics');
  }

  return (
    <div className="border-b border-gray-200">
      <nav className="-mb-px flex gap-1 overflow-x-auto">
        {tabs.map((t) => {
          const Icon = t.icon;
          const isActive = t.key === active;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => selectTab(t.key)}
              className={cn(
                'flex items-center gap-2 px-4 py-2.5 text-sm border-b-2 -mb-px whitespace-nowrap transition-colors',
                isActive
                  ? 'border-blue-500 text-gray-900'
                  : 'border-transparent text-gray-500 hover:text-gray-400'
              )}
            >
              <Icon className="w-4 h-4" />
              {t.label}
            </button>
          );
        })}
      </nav>
    </div>
  );
}
