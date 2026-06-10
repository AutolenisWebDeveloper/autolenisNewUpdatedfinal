'use client';

import * as React from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface SlideOverProps {
  open: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  /** Header actions slot (left of the close button). */
  actions?: React.ReactNode;
  /** Sticky footer slot. */
  footer?: React.ReactNode;
  width?: 'md' | 'lg';
  children: React.ReactNode;
  className?: string;
  'data-testid'?: string;
}

/** Right-side detail panel. Closes on overlay click + Escape. */
export function SlideOver({
  open,
  onClose,
  title,
  subtitle,
  actions,
  footer,
  width = 'md',
  children,
  className,
  'data-testid': testId,
}: SlideOverProps) {
  React.useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" data-testid={testId}>
      <button
        aria-label="Close panel"
        className="absolute inset-0 bg-black/30"
        onClick={onClose}
        data-testid={testId ? `${testId}-overlay` : undefined}
      />
      <aside
        className={cn(
          'absolute right-0 top-0 flex h-full flex-col border-l border-[var(--crm-border)] crm-hairline bg-[var(--crm-bg-primary)] animate-fadein',
          width === 'lg' ? 'w-full max-w-2xl' : 'w-full max-w-md',
          className,
        )}
      >
        <header className="flex items-start gap-3 border-b border-[var(--crm-border)] crm-hairline px-5 py-4">
          <div className="min-w-0 flex-1">
            {title && (
              <div className="truncate text-[16px] font-medium text-[var(--crm-text-primary)]">
                {title}
              </div>
            )}
            {subtitle && (
              <div className="mt-0.5 truncate text-[12px] text-[var(--crm-text-tertiary)]">
                {subtitle}
              </div>
            )}
          </div>
          {actions}
          <button
            onClick={onClose}
            aria-label="Close"
            data-testid={testId ? `${testId}-close` : undefined}
            className="rounded-[var(--crm-radius-sm)] p-1 text-[var(--crm-text-tertiary)] outline-none hover:bg-[var(--crm-bg-tertiary)] hover:text-[var(--crm-text-primary)] focus-visible:ring-2 focus-visible:ring-[var(--crm-ring)]"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto">{children}</div>

        {footer && (
          <footer className="border-t border-[var(--crm-border)] crm-hairline px-5 py-3">
            {footer}
          </footer>
        )}
      </aside>
    </div>
  );
}
