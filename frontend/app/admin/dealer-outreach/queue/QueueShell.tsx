"use client";

// Thin client wrapper: owns the bucket in the URL so a view is linkable and the
// back button behaves, and renders the page chrome from the kit's PageHeader.
import { useRouter } from "next/navigation";
import Link from "next/link";
import { PageHeader } from "@/components/admin/crm/ui";
import OutreachQueueClient, { type QueueBucket } from "./OutreachQueueClient";
import type { QueueRow, QueueCounts } from "@/lib/services/dealer-recruitment/outreach-queue.service";

export default function QueueShell({
  rows,
  counts,
  bucket,
  loadError,
}: {
  rows: QueueRow[];
  counts: QueueCounts;
  bucket: QueueBucket;
  loadError: string | null;
}) {
  const router = useRouter();

  return (
    <div className="min-h-screen bg-al-bg p-6 md:p-8" data-testid="admin-outreach-queue-page">
      <div className="mx-auto max-w-screen-2xl space-y-6">
        <PageHeader
          title="Outreach queue"
          subtitle={
            counts.total > 0
              ? `${counts.total} prospect(s) in scope — ${counts.callReady} ready to call, ${counts.emailReady} ready to email`
              : "No prospects in scope"
          }
          actions={
            <Link
              href="/admin/dealer-outreach"
              className="rounded-al-md px-3 py-2 text-sm font-medium text-al-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-al-focus"
            >
              Full pipeline
            </Link>
          }
        />

        <OutreachQueueClient
          rows={rows}
          counts={counts}
          bucket={bucket}
          loadError={loadError}
          onBucketChange={(next) =>
            router.push(next === "unreachable" ? "?bucket=unreachable" : "?bucket=work")
          }
        />
      </div>
    </div>
  );
}
