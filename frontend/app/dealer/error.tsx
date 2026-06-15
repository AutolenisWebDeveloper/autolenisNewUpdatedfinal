"use client";

import { logger } from "@/lib/logger";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { AlertTriangle } from "lucide-react";
import Link from "next/link";

export default function DealerError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Log the error so the operator can correlate via the digest displayed
    // to the dealer. We deliberately do not surface the raw message because
    // it may include implementation details.
    logger.error("[dealer/error]", error);
  }, [error]);

  return (
    <div
      className="p-6 md:p-12 max-w-xl mx-auto"
      data-testid="dealer-error-boundary"
    >
      <div className="bg-white border border-red-200 rounded-2xl p-6 sm:p-8">
        <div className="flex items-start gap-3 mb-4">
          <AlertTriangle size={22} className="text-red-500 shrink-0 mt-0.5" />
          <div>
            <h1 className="text-lg font-bold text-slate-900">This page couldn&apos;t load</h1>
            <p className="text-sm text-slate-600 mt-1">
              Something interrupted this page. Your account, inventory, and bids
              are safe. The issue has been logged and our team will investigate.
            </p>
            {error.digest && (
              <p className="text-xs text-slate-400 mt-3 font-mono">
                Reference: {error.digest}
              </p>
            )}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={reset} className="min-h-[44px]" data-testid="dealer-error-retry">
            Try again
          </Button>
          <Link
            href="/dealer/dashboard"
            className="inline-flex items-center justify-center px-4 py-2 text-sm font-semibold text-slate-700 border border-slate-200 rounded-md hover:bg-slate-50 min-h-[44px]"
            data-testid="dealer-error-home"
          >
            Back to dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}
