import * as React from 'react';
import { cn } from '@/lib/utils';

export interface PageHeaderProps {
  title: string;
  subtitle?: string;
  /** Right-aligned actions slot. */
  actions?: React.ReactNode;
  className?: string;
  'data-testid'?: string;
}

/** Screen header — 22px title, sentence case, optional subtitle + actions. */
export function PageHeader({
  title,
  subtitle,
  actions,
  className,
  'data-testid': testId,
}: PageHeaderProps) {
  return (
    <header
      className={cn(
        'flex flex-col gap-3 md:flex-row md:items-start md:justify-between',
        className,
      )}
      data-testid={testId}
    >
      <div className="min-w-0">
        <h1 className="text-[22px] font-medium leading-7 text-[var(--crm-text-primary)]">
          {title}
        </h1>
        {subtitle && (
          <p className="mt-1 text-[13px] text-[var(--crm-text-secondary)]">{subtitle}</p>
        )}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}
