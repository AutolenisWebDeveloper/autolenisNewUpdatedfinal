// /admin/dealer-outreach/queue — the prioritized outreach work queue.
//
// Server shell: auth, data, and the error boundary. All interaction lives in the
// client component, which is the split the existing dealer-outreach page already
// uses.
//
// The queue answers "who do I contact right now, and how?" — so the default view
// hides nothing an operator could act on, and the UNREACHABLE bucket is a
// counted, openable tile rather than a silent filter. On this data that bucket
// is the difference between a queue of ~12 and a list of 1,532.
import { requireAdmin } from "@/lib/auth/admin-session";
import { loadOutreachQueue } from "@/lib/services/dealer-recruitment/outreach-queue.service";
import QueueShell from "./QueueShell";

export const dynamic = "force-dynamic";

export default async function OutreachQueuePage({
  searchParams,
}: {
  searchParams: Promise<{ bucket?: string }>;
}) {
  await requireAdmin();
  const { bucket: bucketParam } = await searchParams;
  const bucket = bucketParam === "unreachable" ? "unreachable" : "work";

  // A load failure renders the error STATE rather than throwing to the route
  // boundary: the counts and the bucket switch stay usable, so the operator can
  // still see what exists and retry.
  let rows: Awaited<ReturnType<typeof loadOutreachQueue>>["rows"] = [];
  let counts: Awaited<ReturnType<typeof loadOutreachQueue>>["counts"] = {
    total: 0,
    emailReady: 0,
    callReady: 0,
    smsReady: 0,
    dncBlocked: 0,
    unreachable: 0,
  };
  let loadError: string | null = null;

  try {
    const q = await loadOutreachQueue({ bucket });
    rows = q.rows;
    counts = q.counts;
  } catch (err) {
    loadError = err instanceof Error ? err.message : "Failed to load the outreach queue";
  }

  return (
    <QueueShell
      rows={rows}
      counts={counts}
      bucket={bucket}
      loadError={loadError}
    />
  );
}
