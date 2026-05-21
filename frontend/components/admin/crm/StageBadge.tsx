import type { LifecycleStage } from '@/lib/types/crm';
import { cn } from '@/lib/utils';

const STAGE_STYLES: Record<LifecycleStage, { label: string; classes: string }> = {
  lead:               { label: 'Lead',               classes: 'bg-gray-100 text-gray-600' },
  prequal_started:    { label: 'Prequal Started',    classes: 'bg-yellow-50 text-yellow-700' },
  prequal_completed:  { label: 'Prequal Completed',  classes: 'bg-yellow-100 text-yellow-800' },
  deposit_pending:    { label: 'Deposit Pending',    classes: 'bg-orange-50 text-orange-700' },
  deposit_paid:       { label: 'Deposit Paid',       classes: 'bg-green-50 text-green-700' },
  auction_active:     { label: 'Auction Active',     classes: 'bg-blue-50 text-blue-700' },
  offer_received:     { label: 'Offer Received',     classes: 'bg-purple-50 text-purple-700' },
  purchase_completed: { label: 'Purchased',          classes: 'bg-emerald-50 text-emerald-700' },
  inactive:           { label: 'Inactive',           classes: 'bg-gray-100 text-gray-500' },
};

export function StageBadge({
  stage,
  size = 'md',
}: {
  stage: LifecycleStage;
  size?: 'sm' | 'md';
}) {
  const meta = STAGE_STYLES[stage] ?? STAGE_STYLES.lead;
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full font-semibold whitespace-nowrap',
        size === 'sm' ? 'text-[10px] px-2 py-0.5' : 'text-[11px] px-2.5 py-1',
        meta.classes,
      )}
    >
      {meta.label}
    </span>
  );
}

export const STAGE_OPTIONS: { value: LifecycleStage; label: string }[] = (
  Object.entries(STAGE_STYLES) as [LifecycleStage, { label: string }][]
).map(([value, { label }]) => ({ value, label }));
