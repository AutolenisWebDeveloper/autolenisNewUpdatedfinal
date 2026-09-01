// Review queue — /admin/content/bulk.
//
// This route used to host a second, divergent copy of the article table: its
// own filters, its own page size, its own search semantics and its own word for
// ARCHIVED. It now renders the SAME worktable component as /admin/content,
// pinned to the review queue, so the two surfaces cannot drift again.
//
// The route is deliberately preserved rather than folded away: Batch 2 registers
// it in HUB_PARENTS, it is a bookmarkable entry point to the highest-frequency
// job, and every control it offered still lives on the component it now renders.

import { Suspense } from "react";
import Link from "next/link";
import { ArrowLeft, ClipboardCheck } from "lucide-react";

import { requireAdmin } from "@/lib/auth/admin-session";
import {
  CLUSTER_OPTIONS,
  METRO_OPTIONS,
} from "@/lib/services/admin/admin-content.service";
import ContentWorktable from "@/components/admin/content/ContentWorktable";

export const dynamic = "force-dynamic";

export default async function ReviewQueuePage() {
  await requireAdmin();

  return (
    <div className="p-6 md:p-8" data-testid="bulk-article-page">
      <Link
        href="/admin/content"
        className="mb-4 inline-flex items-center gap-1.5 rounded text-sm text-al-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-al-focus"
      >
        <ArrowLeft size={14} aria-hidden /> Content Engine
      </Link>

      <div className="mb-1 flex items-center gap-3">
        <ClipboardCheck size={22} className="text-al-primary" aria-hidden />
        <h1 className="text-xl font-bold text-slate-900">Review queue</h1>
      </div>
      <p className="mb-6 text-sm text-slate-500">
        Every article waiting for a review decision. Preview, publish or archive them one at a
        time, or select a batch.
      </p>

      {/* The worktable reads useSearchParams, so it is wrapped here exactly as
          it is on /admin/content. force-dynamic makes this route render on
          demand today, but the boundary should not depend on that staying
          true — without it, losing force-dynamic would fail the build. */}
      <Suspense fallback={<div className="h-96 animate-pulse rounded-al-lg bg-slate-100" aria-hidden />}>
        <ContentWorktable
          clusters={[...CLUSTER_OPTIONS]}
          metros={[...METRO_OPTIONS]}
          scopeFilters={{ status: "REVIEW_NEEDED" }}
          showTriage={false}
        />
      </Suspense>
    </div>
  );
}
