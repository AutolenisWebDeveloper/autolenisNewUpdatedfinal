import * as React from 'react';
import { ArrowDownRight, ArrowUpRight, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Skeleton } from './Skeleton';

export interface KpiDelta {
  value: string;
  /** up = good (success), down = bad (danger), flat = neutral. */
  direction: 'up' | 'down' | 'flat';
}

export interface KpiCardProps {
  label: string;
  value: React.ReactNode;
  delta?: KpiDelta;
  sublabel?: string;
  icon?: LucideIcon;
  /** Use the trust (#643293) accent — compliance KPIs only. */
  trust?: boolean;
  loading?: boolean;
  /** Optional click target (whole card). */
  onClick?: () => void;
  href?: string;
  className?: string;
  'data-testid'?: string;
}

const DELTA_TONE = {
  up: 'text-[var(--crm-success)]',
  down: 'text-[var(--crm-danger)]',
  flat: 'text-[var(--crm-text-tertiary)]',
} as const;

/**
 * Flat metric tile — label, value, optional delta + sublabel. No shadow.
 *
 * INTERACTIVE ONLY WHEN ASKED. `onClick` and `href` had been declared in the
 * props for as long as this component existed and were never destructured or
 * rendered, so a tile passed one was silently inert — it could advertise "Tap to
 * review" and do nothing, for mouse and keyboard alike, with no type error to
 * say so. An E2E run looking for the button found a div.
 *
 * With a handler or an href it renders a real <button> or <a>: keyboard
 * reachable, with the kit's focus ring. Without one it renders exactly the div
 * it always did, so every existing tile is untouched.
 */
export function KpiCard({
  label,
  value,
  delta,
  sublabel,
  icon: Icon,
  trust = false,
  loading = false,
  onClick,
  href,
  className,
  'data-testid': testId,
}: KpiCardProps) {
  const accent = trust ? 'var(--crm-trust)' : 'var(--crm-primary)';
  const interactive = !!onClick || !!href;

  const shell = cn(
    'rounded-[var(--crm-radius-md)] border border-[var(--crm-border)] crm-hairline bg-[var(--crm-bg-primary)] p-4',
    interactive &&
      'w-full text-left transition-colors hover:bg-[var(--crm-bg-secondary)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--crm-ring)] cursor-pointer',
    className,
  );

  const body = (
    <>
      <div className="flex items-center justify-between">
        <span className="text-[12px] text-[var(--crm-text-tertiary)]">{label}</span>
        {Icon && <Icon className="h-4 w-4" style={{ color: accent }} strokeWidth={1.75} />}
      </div>
      {loading ? (
        <Skeleton className="mt-3 h-7 w-16" />
      ) : (
        <div className="mt-2 text-[22px] font-medium leading-7 tabular-nums text-[var(--crm-text-primary)]">
          {value}
        </div>
      )}
      <div className="mt-1 flex items-center gap-2">
        {delta && (
          <span className={cn('flex items-center gap-0.5 text-[12px] font-medium', DELTA_TONE[delta.direction])}>
            {delta.direction === 'up' && <ArrowUpRight className="h-3 w-3" />}
            {delta.direction === 'down' && <ArrowDownRight className="h-3 w-3" />}
            {delta.value}
          </span>
        )}
        {sublabel && <span className="text-[12px] text-[var(--crm-text-tertiary)]">{sublabel}</span>}
      </div>
    </>
  );

  if (href) {
    return (
      <a href={href} className={shell} data-testid={testId}>
        {body}
      </a>
    );
  }
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={shell} data-testid={testId}>
        {body}
      </button>
    );
  }
  return (
    <div className={shell} data-testid={testId}>
      {body}
    </div>
  );
}
