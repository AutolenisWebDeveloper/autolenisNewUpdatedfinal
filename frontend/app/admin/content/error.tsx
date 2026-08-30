"use client";

// Error boundary for the Content Engine subtree.
//
// Previously there was none anywhere under app/admin/content, so a failed
// aggregate query fell through to the portal-level boundary and took the whole
// admin shell's context with it. Scoping it here keeps the rail and lets the
// operator retry just this page.

import { useEffect } from "react";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { logger } from "@/lib/logger";

export default function ContentError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    logger.error("[admin/content] render failed:", error.message, error.digest ?? "");
  }, [error]);

  return (
    <div className="p-6 md:p-8" data-testid="content-error">
      <div className="max-w-xl rounded-al-lg border border-red-200 bg-al-danger-subtle p-6">
        <h1 className="flex items-center gap-2 text-base font-bold text-al-danger-fg">
          <AlertTriangle size={18} aria-hidden />
          The content engine couldn&rsquo;t load
        </h1>
        <p className="mt-2 text-sm text-al-danger-fg">
          This page failed while reading content data. Nothing was changed.
        </p>
        {error.digest && (
          <p className="mt-2 font-mono text-xs text-al-danger-fg/80">Reference: {error.digest}</p>
        )}
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={reset}
            data-testid="content-error-retry"
            className="rounded-al-md bg-al-danger px-3.5 py-2 text-sm font-semibold text-white hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-al-focus"
          >
            Try again
          </button>
          <Link
            href="/admin"
            className="rounded-al-md border border-al-border bg-white px-3.5 py-2 text-sm font-semibold text-slate-700 hover:bg-al-bg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-al-focus"
          >
            Back to admin
          </Link>
        </div>
      </div>
    </div>
  );
}
