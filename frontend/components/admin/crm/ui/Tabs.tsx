'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

export interface TabItem {
  id: string;
  label: string;
  /** Optional trailing count / badge. */
  count?: number;
  /** Reserved for compliance tabs — renders the active indicator in trust #643293. */
  trust?: boolean;
}

export interface TabsProps {
  tabs: TabItem[];
  value: string;
  onValueChange: (id: string) => void;
  className?: string;
  'data-testid'?: string;
}

/** Flat underline tabs (keyboard-navigable). */
export function Tabs({ tabs, value, onValueChange, className, 'data-testid': testId }: TabsProps) {
  return (
    <div
      role="tablist"
      aria-orientation="horizontal"
      className={cn(
        'flex items-center gap-1 border-b border-[var(--crm-border)] crm-hairline',
        className,
      )}
      data-testid={testId}
    >
      {tabs.map((tab) => {
        const active = tab.id === value;
        const accent = tab.trust ? 'var(--crm-trust)' : 'var(--crm-primary)';
        return (
          <button
            key={tab.id}
            role="tab"
            type="button"
            aria-selected={active}
            data-testid={testId ? `${testId}-tab-${tab.id}` : undefined}
            onClick={() => onValueChange(tab.id)}
            className={cn(
              'relative -mb-px flex items-center gap-1.5 px-3 py-2 text-[13px] font-medium transition-colors outline-none',
              'focus-visible:ring-2 focus-visible:ring-[var(--crm-ring)] focus-visible:ring-offset-0 rounded-t-[var(--crm-radius-sm)]',
              active
                ? 'text-[var(--crm-text-primary)]'
                : 'text-[var(--crm-text-tertiary)] hover:text-[var(--crm-text-secondary)]',
            )}
          >
            <span>{tab.label}</span>
            {typeof tab.count === 'number' && (
              <span className="rounded-[var(--crm-radius-sm)] bg-[var(--crm-bg-tertiary)] px-1.5 text-[11px] text-[var(--crm-text-secondary)]">
                {tab.count}
              </span>
            )}
            {active && (
              <span
                aria-hidden
                className="absolute inset-x-0 -bottom-px h-0.5 rounded-full"
                style={{ backgroundColor: accent }}
              />
            )}
          </button>
        );
      })}
    </div>
  );
}
