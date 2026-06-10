import * as React from 'react';
import { cn } from '@/lib/utils';
import type { Tone, Temperature } from './tokens';
import { temperatureTone } from './tokens';

const TONE_CLASS: Record<Tone, string> = {
  neutral:
    'bg-[var(--crm-bg-tertiary)] text-[var(--crm-text-secondary)] border-[var(--crm-border)]',
  primary:
    'bg-[var(--crm-primary-subtle)] text-[var(--crm-primary)] border-[var(--crm-primary-subtle)]',
  success:
    'bg-[var(--crm-success-subtle)] text-[var(--crm-success)] border-[var(--crm-success-subtle)]',
  warning:
    'bg-[var(--crm-warning-subtle)] text-[var(--crm-warning)] border-[var(--crm-warning-subtle)]',
  danger:
    'bg-[var(--crm-danger-subtle)] text-[var(--crm-danger)] border-[var(--crm-danger-subtle)]',
  info:
    'bg-[var(--crm-info-subtle)] text-[var(--crm-info)] border-[var(--crm-info-subtle)]',
  // trust = #643293 — compliance surfaces only
  trust:
    'bg-[var(--crm-trust-subtle)] text-[var(--crm-trust)] border-[var(--crm-trust-subtle)]',
};

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: Tone;
  size?: 'sm' | 'md';
  dot?: boolean;
  'data-testid'?: string;
}

/** Flat semantic pill. `trust` tone reserved for compliance surfaces. */
export function Badge({
  tone = 'neutral',
  size = 'md',
  dot = false,
  className,
  children,
  ...rest
}: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-[var(--crm-radius-sm)] border font-medium whitespace-nowrap',
        size === 'sm' ? 'text-[11px] px-1.5 py-0.5' : 'text-[12px] px-2 py-0.5',
        TONE_CLASS[tone],
        className,
      )}
      {...rest}
    >
      {dot && (
        <span
          aria-hidden
          className="h-1.5 w-1.5 rounded-full bg-current opacity-80"
        />
      )}
      {children}
    </span>
  );
}

export interface StatusPillProps extends Omit<BadgeProps, 'tone'> {
  /** Provide a semantic tone OR a lead temperature. */
  tone?: Tone;
  temperature?: Temperature;
}

/**
 * StatusPill — Badge with a dot, plus a `temperature` shortcut
 * (hot→danger, warm→warning, cold→neutral).
 */
export function StatusPill({ tone, temperature, ...rest }: StatusPillProps) {
  const resolved: Tone = temperature ? temperatureTone[temperature] : tone ?? 'neutral';
  return <Badge tone={resolved} dot {...rest} />;
}
