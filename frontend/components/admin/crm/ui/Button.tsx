import * as React from 'react';
import { cn } from '@/lib/utils';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'trust';
type Size = 'sm' | 'md';

const VARIANT: Record<Variant, string> = {
  primary:
    'bg-[var(--crm-primary)] text-[var(--crm-on-primary)] hover:bg-[var(--crm-primary-hover)] active:bg-[var(--crm-primary-active)]',
  secondary:
    'border border-[var(--crm-border-strong)] crm-hairline bg-[var(--crm-bg-primary)] text-[var(--crm-text-secondary)] hover:bg-[var(--crm-bg-secondary)] hover:text-[var(--crm-text-primary)]',
  ghost:
    'text-[var(--crm-text-secondary)] hover:bg-[var(--crm-bg-tertiary)] hover:text-[var(--crm-text-primary)]',
  danger:
    'bg-[var(--crm-danger)] text-white hover:opacity-90',
  // trust = #643293 — compliance actions only
  trust:
    'bg-[var(--crm-trust)] text-white hover:opacity-90',
};

const SIZE: Record<Size, string> = {
  sm: 'h-7 px-2 text-[12px] gap-1',
  md: 'h-8 px-3 text-[13px] gap-1.5',
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

/**
 * The button's visual recipe, exported so a LINK that should look like a button
 * consumes the same one. A `tel:` action must be an anchor — right-click, long
 * press and open-in-app all depend on it — and re-typing these classes at the
 * call site is how the kit's tone scale quietly forks.
 */
export function buttonClasses(opts?: { variant?: Variant; size?: Size; className?: string }): string {
  return cn(
    'inline-flex items-center justify-center rounded-[var(--crm-radius-sm)] font-medium transition-colors outline-none',
    'focus-visible:ring-2 focus-visible:ring-[var(--crm-ring)] disabled:opacity-50 disabled:pointer-events-none',
    VARIANT[opts?.variant ?? 'secondary'],
    SIZE[opts?.size ?? 'md'],
    opts?.className,
  );
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', className, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={buttonClasses({ variant, size, className })}
      {...rest}
    />
  );
});
