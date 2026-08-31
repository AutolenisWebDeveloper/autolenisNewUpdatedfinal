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

/**
 * Right-side detail panel. Closes on overlay click + Escape.
 *
 * FOCUS IS MANAGED, because aria-modal="true" is a promise.
 * Until an E2E run caught it, this component declared itself a modal dialog and
 * then did none of what that means: focus stayed on the page behind it, Tab
 * walked out of the panel into content a screen reader had been told was
 * inert, and closing dropped focus on <body> — which strands a keyboard user at
 * the top of the document with no idea where they came from.
 *
 * On open: remember the trigger, move focus into the panel.
 * While open: Tab and Shift+Tab cycle within it.
 * On close: put focus back on the trigger.
 */
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
  const panelRef = React.useRef<HTMLElement | null>(null);
  const returnFocusRef = React.useRef<HTMLElement | null>(null);
  const titleId = React.useId();

  React.useEffect(() => {
    if (!open) return;

    returnFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    // The panel itself, not its first control: the overlay is a full-screen
    // button and landing on it would read as "Close panel" before the content.
    panelRef.current?.focus();

    function focusable(): HTMLElement[] {
      const root = panelRef.current;
      if (!root) return [];
      return Array.from(
        root.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((el) => el.offsetParent !== null || el === document.activeElement);
    }

    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;

      const items = focusable();
      if (items.length === 0) {
        // Nothing to move to — keep focus on the panel rather than letting it
        // escape to the page the dialog claims to have made inert.
        e.preventDefault();
        panelRef.current?.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;

      if (e.shiftKey && (active === first || active === panelRef.current)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      } else if (active instanceof Node && !panelRef.current?.contains(active)) {
        e.preventDefault();
        first.focus();
      }
    }

    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      // Restore on unmount as well as on close: a panel removed by a route
      // change must not leave focus nowhere either.
      returnFocusRef.current?.focus();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50" data-testid={testId}>
      <button
        aria-label="Close panel"
        className="absolute inset-0 bg-black/30"
        onClick={onClose}
        data-testid={testId ? `${testId}-overlay` : undefined}
      />
      <aside
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        // The dialog carries its own name. Without this it is announced as
        // "dialog" and nothing else.
        aria-labelledby={title ? titleId : undefined}
        aria-label={title ? undefined : 'Detail panel'}
        tabIndex={-1}
        className={cn(
          'absolute right-0 top-0 flex h-full flex-col border-l border-[var(--crm-border)] crm-hairline bg-[var(--crm-bg-primary)] animate-fadein outline-none',
          width === 'lg' ? 'w-full max-w-2xl' : 'w-full max-w-md',
          className,
        )}
      >
        <header className="flex items-start gap-3 border-b border-[var(--crm-border)] crm-hairline px-5 py-4">
          <div className="min-w-0 flex-1">
            {title && (
              <div id={titleId} className="truncate text-[16px] font-medium text-[var(--crm-text-primary)]">
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
