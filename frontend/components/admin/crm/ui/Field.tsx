'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

// Form primitives the kit was missing.
//
// PROMOTED, NOT INVENTED. Toolbar.tsx already carries SelectField and
// SearchField; a panel form additionally needs a number box and a notes box,
// and hand-rolling those in a page component is how a second visual language
// starts. These match SelectField's contract exactly — same radius, border,
// type scale and focus ring tokens — so a form built from all four looks like
// one thing.

const CONTROL = cn(
  'w-full rounded-[var(--crm-radius-sm)] border border-[var(--crm-border)] crm-hairline',
  'bg-[var(--crm-bg-primary)] px-2 text-[13px] text-[var(--crm-text-primary)]',
  'placeholder:text-[var(--crm-text-tertiary)]',
  'outline-none focus-visible:ring-2 focus-visible:ring-[var(--crm-ring)] disabled:opacity-50',
);

export interface FieldLabelProps {
  htmlFor: string;
  children: React.ReactNode;
  /** Rendered next to the label, e.g. "optional". Never a placeholder — a
   *  placeholder disappears the moment someone types. */
  hint?: string;
}

export function FieldLabel({ htmlFor, children, hint }: FieldLabelProps) {
  return (
    <label
      htmlFor={htmlFor}
      className="mb-1 flex items-baseline gap-2 text-xs font-medium text-[var(--crm-text-secondary)]"
    >
      <span>{children}</span>
      {hint ? <span className="font-normal text-[var(--crm-text-tertiary)]">{hint}</span> : null}
    </label>
  );
}

export type NumberFieldProps = React.InputHTMLAttributes<HTMLInputElement>;

/** Numeric input. inputMode is set so a phone keyboard opens on the digits. */
export const NumberField = React.forwardRef<HTMLInputElement, NumberFieldProps>(
  function NumberField({ className, ...rest }, ref) {
    return (
      <input
        ref={ref}
        type="number"
        inputMode="numeric"
        className={cn(CONTROL, 'h-8', className)}
        {...rest}
      />
    );
  },
);

export type TextAreaFieldProps = React.TextareaHTMLAttributes<HTMLTextAreaElement>;

export const TextAreaField = React.forwardRef<HTMLTextAreaElement, TextAreaFieldProps>(
  function TextAreaField({ className, rows = 3, ...rest }, ref) {
    return <textarea ref={ref} rows={rows} className={cn(CONTROL, 'py-1.5', className)} {...rest} />;
  },
);

/**
 * An inline form error.
 *
 * role="alert" so a screen reader announces it when it appears, and the text
 * says what is wrong — colour alone is not a message.
 */
export function FieldError({ id, children }: { id?: string; children: React.ReactNode }) {
  if (!children) return null;
  return (
    <p id={id} role="alert" className="mt-1 text-xs text-al-danger">
      {children}
    </p>
  );
}
