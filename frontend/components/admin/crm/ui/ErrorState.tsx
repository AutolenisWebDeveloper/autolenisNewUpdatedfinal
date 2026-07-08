'use client';

import * as React from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';
import { EmptyState } from './EmptyState';
import { Button } from './Button';

export interface ErrorStateProps {
  title?: string;
  /** Human-readable failure description. Never render a raw error dump here. */
  description?: string;
  /** Correlation / digest id shown for support triage. */
  correlationId?: string;
  onRetry?: () => void;
  retryLabel?: string;
  className?: string;
  'data-testid'?: string;
}

/**
 * Kit error surface for failed data loads — replaces silent-empty and raw
 * error dumps. Pairs with EmptyState: empty means "no data", ErrorState means
 * "we could not load the data", and the two must never be conflated.
 */
export function ErrorState({
  title = 'Failed to load',
  description = 'Something went wrong loading this data. Try again, or reload the console.',
  correlationId,
  onRetry,
  retryLabel = 'Try again',
  className,
  'data-testid': testId = 'error-state',
}: ErrorStateProps) {
  return (
    <div role="alert" data-testid={testId} className={className}>
      <EmptyState
        icon={AlertCircle}
        variant="error"
        title={title}
        description={correlationId ? `${description} (ref: ${correlationId})` : description}
        action={
          onRetry ? (
            <Button
              variant="secondary"
              onClick={onRetry}
              data-testid={`${testId}-retry`}
            >
              <RefreshCw className="h-3.5 w-3.5" aria-hidden />
              {retryLabel}
            </Button>
          ) : undefined
        }
      />
    </div>
  );
}
