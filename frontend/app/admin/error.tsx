"use client";

import { useEffect } from "react";
import { AlertCircle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

// Admin-console error boundary.
// Catches unhandled errors thrown by admin pages and nested layouts. A finer-
// grained boundary at admin/crm/analytics/error.tsx overrides this where present.
export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[admin] unhandled page error:", error);
  }, [error]);

  return (
    <div
      data-testid="admin-error-boundary"
      className="flex flex-col items-center justify-center min-h-[60vh] p-8 text-center"
    >
      <div className="flex items-center justify-center w-12 h-12 rounded-full bg-red-100 mb-4">
        <AlertCircle className="text-red-500" size={24} />
      </div>
      <h2 className="text-xl font-semibold text-slate-900 mb-2">
        Something went wrong
      </h2>
      <p className="text-sm text-slate-500 max-w-sm mb-1 leading-relaxed">
        This admin view failed to load. The error has been logged — please try
        again, or reload the console.
      </p>
      {error.digest && (
        <p className="text-xs text-slate-400 mb-6">Error reference: {error.digest}</p>
      )}
      {!error.digest && <div className="mb-6" />}
      <Button data-testid="admin-error-retry-btn" onClick={reset} className="gap-2">
        <RefreshCw size={15} />
        Try again
      </Button>
    </div>
  );
}
