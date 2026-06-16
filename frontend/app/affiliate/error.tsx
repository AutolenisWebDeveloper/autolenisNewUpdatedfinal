"use client";

import { logger } from "@/lib/logger";
import { useEffect } from "react";
import { AlertCircle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

// Affiliate-portal error boundary.
// Catches unhandled errors thrown by affiliate pages and nested layouts.
export default function AffiliateError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    logger.error("[affiliate] unhandled page error:", error);
  }, [error]);

  return (
    <div
      data-testid="affiliate-error-boundary"
      className="flex flex-col items-center justify-center min-h-[60vh] p-8 text-center"
    >
      <div className="flex items-center justify-center w-12 h-12 rounded-full bg-red-100 mb-4">
        <AlertCircle className="text-red-500" size={24} />
      </div>
      <h2 className="text-xl font-semibold text-slate-900 mb-2">
        Unable to load your portal
      </h2>
      <p className="text-sm text-slate-500 max-w-sm mb-1 leading-relaxed">
        We hit a temporary issue loading your affiliate data. This usually
        resolves itself quickly — please try again.
      </p>
      {error.digest && (
        <p className="text-xs text-slate-400 mb-6">Error reference: {error.digest}</p>
      )}
      {!error.digest && <div className="mb-6" />}
      <Button data-testid="affiliate-error-retry-btn" onClick={reset} className="gap-2">
        <RefreshCw size={15} />
        Try again
      </Button>
    </div>
  );
}
