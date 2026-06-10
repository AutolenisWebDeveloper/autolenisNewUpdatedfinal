import * as React from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description?: string;
  /** Action slot (e.g. a button). */
  action?: React.ReactNode;
  /** Variant tweaks tone — `error` and `blocked` recolor the icon. */
  variant?: 'default' | 'error' | 'blocked';
  className?: string;
  'data-testid'?: string;
}

const ICON_TONE: Record<NonNullable<EmptyStateProps['variant']>, string> = {
  default: 'text-[var(--crm-text-tertiary)]',
  error: 'text-[var(--crm-danger)]',
  blocked: 'text-[var(--crm-trust)]',
};

/** Centered empty / error / blocked state for tables, panels, lists. */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  variant = 'default',
  className,
  'data-testid': testId,
}: EmptyStateProps) {
  return (
    <div
      className={cn('flex flex-col items-center justify-center px-6 py-12 text-center', className)}
      data-testid={testId}
    >
      {Icon && <Icon className={cn('mb-3 h-8 w-8', ICON_TONE[variant])} strokeWidth={1.5} />}
      <p className="text-[13px] font-medium text-[var(--crm-text-primary)]">{title}</p>
      {description && (
        <p className="mt-1 max-w-sm text-[12px] text-[var(--crm-text-tertiary)]">{description}</p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
