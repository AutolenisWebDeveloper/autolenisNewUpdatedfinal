"use client";

import { logger } from "@/lib/logger";
import { useEffect } from "react";
import { AlertCircle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

// Buyer-portal error boundary.
// Catches unhandled errors thrown by buyer pages and nested layouts, replacing
// the generic global "Something went wrong" screen with a buyer-friendly
// message and a retry button.  Errors from /buyer/layout.tsx itself propagate
// to the root error boundary; all page-level errors land here.
export default function BuyerError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    logger.error("[buyer] unhandled page error:", error);
  }, [error]);

  return (
    <div
      data-testid="buyer-error-boundary"
      className="flex flex-col items-center justify-center min-h-[60vh] p-8 text-center"
    >
      <div className="flex items-center justify-center w-12 h-12 rounded-full bg-red-100 mb-4">
        <AlertCircle className="text-red-500" size={24} />
      </div>
      <h2 className="text-xl font-semibold text-slate-900 mb-2">
        Unable to load your dashboard
      </h2>
      <p className="text-sm text-slate-500 max-w-sm mb-1 leading-relaxed">
        We hit a temporary issue loading your account data. This usually
        resolves itself quickly — please try again.
      </p>
      {error.digest && (
        <p className="text-xs text-slate-400 mb-6">
          Error reference: {error.digest}
        </p>
      )}
      {!error.digest && <div className="mb-6" />}
      <Button
        data-testid="buyer-error-retry-btn"
        onClick={reset}
        className="gap-2"
      >
        <RefreshCw size={15} />
        Try again
      </Button>
    </div>
  );
}
