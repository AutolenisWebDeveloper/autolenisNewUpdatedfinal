'use client';

import { logger } from "@/lib/logger";
import { useEffect } from 'react';
import { AlertCircle, RefreshCcw } from 'lucide-react';

export default function AnalyticsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    logger.error('[crm/analytics] route error:', error);
  }, [error]);

  return (
    <div className="p-6">
      <div className="bg-white border border-red-200 rounded-xl p-6 max-w-2xl">
        <div className="flex items-start gap-3">
          <AlertCircle className="w-6 h-6 text-red-600 shrink-0 mt-0.5" />
          <div className="flex-1">
            <h1 className="text-base font-semibold text-gray-900">
              Analytics couldn&rsquo;t load
            </h1>
            <p className="text-sm text-gray-500 mt-1">
              One of the analytics queries failed. This usually means a backing
              table or matview hasn&rsquo;t been created yet, or the database is
              temporarily unreachable.
            </p>
            {error.message && (
              <p className="text-[11px] text-red-700 mt-3 font-mono break-all">
                {error.message}
              </p>
            )}
            {error.digest && (
              <p className="text-[11px] text-gray-400 mt-1">
                Error ID: {error.digest}
              </p>
            )}
            <button
              onClick={reset}
              className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg px-3 py-2 transition-colors"
            >
              <RefreshCcw className="w-4 h-4" /> Try again
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
