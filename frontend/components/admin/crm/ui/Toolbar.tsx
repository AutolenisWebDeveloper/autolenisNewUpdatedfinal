'use client';

import * as React from 'react';
import { Search } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface ToolbarProps extends React.HTMLAttributes<HTMLDivElement> {
  'data-testid'?: string;
}

/** Inline filter toolbar — flat row that hosts search + filters + actions. */
export function Toolbar({ className, children, ...rest }: ToolbarProps) {
  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-2 rounded-[var(--crm-radius-md)] border border-[var(--crm-border)] crm-hairline bg-[var(--crm-bg-primary)] px-2 py-1.5',
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}

export interface SearchFieldProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size'> {
  'data-testid'?: string;
}

/** Flat search input used inside a Toolbar. */
export const SearchField = React.forwardRef<HTMLInputElement, SearchFieldProps>(
  function SearchField({ className, ...rest }, ref) {
    return (
      <div className="relative flex-1 min-w-[180px]">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--crm-text-tertiary)]" />
        <input
          ref={ref}
          className={cn(
            'h-8 w-full rounded-[var(--crm-radius-sm)] bg-transparent pl-8 pr-3 text-[13px] text-[var(--crm-text-primary)] placeholder:text-[var(--crm-text-tertiary)]',
            'outline-none focus-visible:ring-2 focus-visible:ring-[var(--crm-ring)]',
            className,
          )}
          {...rest}
        />
      </div>
    );
  },
);

export interface SelectFieldProps
  extends React.SelectHTMLAttributes<HTMLSelectElement> {
  'data-testid'?: string;
}

/** Flat select used inside a Toolbar. */
export const SelectField = React.forwardRef<HTMLSelectElement, SelectFieldProps>(
  function SelectField({ className, children, ...rest }, ref) {
    return (
      <select
        ref={ref}
        className={cn(
          'h-8 rounded-[var(--crm-radius-sm)] border border-[var(--crm-border)] crm-hairline bg-[var(--crm-bg-primary)] px-2 text-[13px] text-[var(--crm-text-primary)]',
          'outline-none focus-visible:ring-2 focus-visible:ring-[var(--crm-ring)] disabled:opacity-50',
          className,
        )}
        {...rest}
      >
        {children}
      </select>
    );
  },
);
