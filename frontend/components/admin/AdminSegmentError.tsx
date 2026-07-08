"use client";

import { logger } from "@/lib/logger";
import { useEffect } from "react";
import { AlertCircle, ArrowLeft, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

// Shared segment-level error boundary body for admin sub-routes.
// Thin per-segment error.tsx files delegate here with a contextual label so a
// failure in one domain (e.g. Payments) offers recovery without losing the
// admin shell. The root app/admin/error.tsx remains the catch-all.
export default function AdminSegmentError({
  segment,
  error,
  reset,
}: {
  segment: string;
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    logger.error(`[admin/${segment}] unhandled page error:`, error);
  }, [segment, error]);

  return (
    <div
      data-testid={`admin-${segment}-error-boundary`}
      className="flex min-h-[50vh] flex-col items-center justify-center p-8 text-center"
    >
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-100">
        <AlertCircle className="text-red-500" size={24} aria-hidden />
      </div>
      <h2 className="mb-2 text-xl font-semibold text-slate-900">
        {segment} failed to load
      </h2>
      <p className="mb-1 max-w-sm text-sm leading-relaxed text-slate-500">
        The rest of the admin console is unaffected. The error has been logged —
        try again, or head back to the dashboard.
      </p>
      {error.digest ? (
        <p className="mb-6 text-xs text-slate-400">Error reference: {error.digest}</p>
      ) : (
        <div className="mb-6" />
      )}
      <div className="flex items-center gap-2">
        <Button data-testid="admin-segment-error-retry" onClick={reset} className="gap-2">
          <RefreshCw size={15} aria-hidden />
          Try again
        </Button>
        <Button href="/admin/dashboard" variant="outline" className="gap-2">
          <ArrowLeft size={15} aria-hidden />
          Dashboard
        </Button>
      </div>
    </div>
  );
}
