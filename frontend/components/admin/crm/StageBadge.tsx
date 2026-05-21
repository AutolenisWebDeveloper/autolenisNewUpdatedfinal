import type { LifecycleStage } from '@/lib/types/crm';
import { cn } from '@/lib/utils';

const STAGE_STYLES: Record<LifecycleStage, { label: string; classes: string }> = {
  lead:               { label: 'Lead',               classes: 'bg-gray-700 text-gray-300' },
  prequal_started:    { label: 'Prequal Started',    classes: 'bg-yellow-500/15 text-yellow-400' },
  prequal_completed:  { label: 'Prequal Completed',  classes: 'bg-yellow-500/20 text-yellow-300' },
  deposit_pending:    { label: 'Deposit Pending',    classes: 'bg-orange-500/15 text-orange-400' },
  deposit_paid:       { label: 'Deposit Paid',       classes: 'bg-green-500/15 text-green-400' },
  auction_active:     { label: 'Auction Active',     classes: 'bg-blue-500/15 text-blue-400' },
  offer_received:     { label: 'Offer Received',     classes: 'bg-purple-500/15 text-purple-400' },
  purchase_completed: { label: 'Purchased',          classes: 'bg-emerald-500/15 text-emerald-400' },
  inactive:           { label: 'Inactive',           classes: 'bg-gray-700/50 text-gray-500' },
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
