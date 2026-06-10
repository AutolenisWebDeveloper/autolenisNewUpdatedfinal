import * as React from 'react';
import { cn } from '@/lib/utils';

export interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {
  'data-testid'?: string;
}

/** Flat shimmer placeholder (no shadow). */
export function Skeleton({ className, ...rest }: SkeletonProps) {
  return (
    <div
      aria-hidden
      className={cn(
        'animate-pulse rounded-[var(--crm-radius-sm)] bg-[var(--crm-bg-tertiary)]',
        className,
      )}
      {...rest}
    />
  );
}

/** A multi-row skeleton sized to mimic table rows. */
export function SkeletonRows({
  rows = 6,
  className,
  'data-testid': testId,
}: {
  rows?: number;
  className?: string;
  'data-testid'?: string;
}) {
  return (
    <div className={cn('space-y-2', className)} data-testid={testId}>
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-9 w-full" />
      ))}
    </div>
  );
}
