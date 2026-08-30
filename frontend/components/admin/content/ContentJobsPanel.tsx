"use client";

// Generation jobs + batch generation — previously unreachable.
//
// The generate, jobs-list and job-control endpoints have existed, been audit
// logged and been capability gated since Phase 3, with no UI consumer anywhere
// in app/** or components/**. The practical consequence was that a half-failed
// generation batch was invisible: ContentGenerationJob.failedItems, lastError
// and attemptCount were written and never rendered, and retryFailedItems — the
// only recovery path — had no button. This panel is that surface.
//
// Role handling follows the established mirror (lib/auth/admin-ui-roles.ts):
// controls the server will refuse are disabled with the reason shown, never
// hidden, and never treated as the authorization boundary. The server decides.

import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  Ban,
  Loader2,
  Pause,
  Play,
  RefreshCw,
  Rocket,
  Sparkles,
} from "lucide-react";

import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { api, apiErrorMessage } from "@/lib/api/client";
import { canUse, deniedReason } from "@/lib/auth/admin-ui-roles";
import { CLUSTER_ORDER, clusterLabel } from "@/lib/content/cluster-meta";

interface Job {
  id: string;
  status: string;
  jobType: string;
  totalItems: number;
  succeededItems: number;
  failedItems: number;
  lastError: string | null;
  createdAt: string;
  completedAt: string | null;
  _count?: { items: number };
}

type JobAction = "retry" | "cancel" | "pause" | "resume";

const JOB_TONE: Record<string, string> = {
  QUEUED: "bg-slate-100 text-slate-600",
  PROCESSING: "bg-al-primary-subtle text-al-primary",
  SUCCEEDED: "bg-al-success-subtle text-al-success-fg",
  FAILED: "bg-al-danger-subtle text-al-danger-fg",
  CANCELED: "bg-slate-100 text-slate-500",
  PAUSED: "bg-al-warning-subtle text-al-warning-fg",
};

/** Which job controls make sense from a given job status. */
function actionsFor(status: string): JobAction[] {
  switch (status) {
    case "PROCESSING":
      return ["pause", "cancel"];
    case "QUEUED":
      return ["pause", "cancel"];
    case "PAUSED":
      return ["resume", "cancel"];
    case "FAILED":
      return ["retry"];
    case "SUCCEEDED":
      return ["retry"];
    default:
      return [];
  }
}

const ACTION_META: Record<JobAction, { label: string; icon: typeof RefreshCw }> = {
  retry: { label: "Retry failed", icon: RefreshCw },
  cancel: { label: "Cancel", icon: Ban },
  pause: { label: "Pause", icon: Pause },
  resume: { label: "Resume", icon: Play },
};

export default function ContentJobsPanel({ adminRole }: { adminRole?: string }) {
  const [open, setOpen] = useState(false);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyJob, setBusyJob] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [cluster, setCluster] = useState("");
  const [regenerate, setRegenerate] = useState(false);
  const [reviewOnly, setReviewOnly] = useState(true);
  const [generating, setGenerating] = useState(false);

  const mayGenerate = canUse("content.generate", adminRole);
  const mayManage = canUse("content.manage_jobs", adminRole);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.get<{ jobs: Job[] }>("/api/admin/content/jobs?limit=25");
      setJobs(data.jobs ?? []);
    } catch (e) {
      setError(apiErrorMessage(e, "Failed to load generation jobs"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  const runAction = useCallback(
    async (jobId: string, action: JobAction) => {
      setBusyJob(jobId);
      setNotice(null);
      try {
        await api.post(`/api/admin/content/jobs/${jobId}`, { action });
        setNotice(`${ACTION_META[action].label} applied.`);
        await load();
      } catch (e) {
        setError(apiErrorMessage(e, `Could not ${action} this job`));
      } finally {
        setBusyJob(null);
      }
    },
    [load],
  );

  const generate = useCallback(async () => {
    setGenerating(true);
    setError(null);
    setNotice(null);
    try {
      const body: Record<string, unknown> = {
        filter: cluster ? { cluster } : {},
        reviewOnly,
        regenerate,
      };
      const data = await api.post<{ jobId: string; queued: number }>(
        "/api/admin/content/articles/generate",
        body,
      );
      setNotice(`Queued ${data.queued.toLocaleString("en-US")} article${data.queued === 1 ? "" : "s"}.`);
      await load();
    } catch (e) {
      setError(apiErrorMessage(e, "Could not start the batch"));
    } finally {
      setGenerating(false);
    }
  }, [cluster, reviewOnly, regenerate, load]);

  const activeFailures = jobs.filter((j) => j.failedItems > 0 || j.status === "FAILED").length;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        data-testid="content-jobs-trigger"
        className="inline-flex items-center gap-1.5 rounded-al-md border border-al-border px-3 py-1.5 text-xs font-semibold text-slate-600 transition-colors hover:border-al-primary hover:bg-al-primary-subtle hover:text-al-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-al-focus"
      >
        <Sparkles size={13} aria-hidden />
        Generate &amp; jobs
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          variant="sheet"
          side="right"
          className="flex w-full max-w-[560px] flex-col p-0"
          data-testid="content-jobs-panel"
        >
          <div className="border-b border-al-border px-6 py-4 pr-12">
            <DialogTitle className="text-sm font-bold text-slate-700">
              Generation &amp; jobs
            </DialogTitle>
            <DialogDescription className="mt-0.5 text-xs text-slate-500">
              Start a batch, and monitor or recover the ones already running.
            </DialogDescription>
          </div>

          <div className="flex-1 space-y-6 overflow-y-auto px-6 py-5">
            {/* Generate */}
            <section data-testid="content-generate-form">
              <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-400">
                Start a batch
              </h3>

              {!mayGenerate && (
                <p
                  className="mb-2 rounded-al-md border border-al-border bg-al-bg px-3 py-2 text-xs text-slate-500"
                  data-testid="content-generate-denied"
                >
                  {deniedReason("content.generate")}
                </p>
              )}

              <div className="space-y-2.5">
                <div>
                  <label htmlFor="gen-cluster" className="mb-1 block text-xs font-medium text-slate-600">
                    Cluster
                  </label>
                  <select
                    id="gen-cluster"
                    value={cluster}
                    onChange={(e) => setCluster(e.target.value)}
                    disabled={!mayGenerate}
                    data-testid="content-generate-cluster"
                    className="w-full rounded-al-md border border-al-border bg-white px-2.5 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-al-focus disabled:opacity-50"
                  >
                    <option value="">All clusters</option>
                    {CLUSTER_ORDER.map((c) => (
                      <option key={c} value={c}>
                        {clusterLabel(c)}
                      </option>
                    ))}
                  </select>
                </div>

                <label className="flex items-center gap-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={regenerate}
                    onChange={(e) => setRegenerate(e.target.checked)}
                    disabled={!mayGenerate}
                    data-testid="content-generate-regenerate"
                  />
                  Regenerate articles that already exist
                </label>

                <label className="flex items-center gap-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={reviewOnly}
                    onChange={(e) => setReviewOnly(e.target.checked)}
                    disabled={!mayGenerate}
                    data-testid="content-generate-review-only"
                  />
                  Send results to review rather than publishing
                </label>

                <button
                  type="button"
                  onClick={generate}
                  disabled={!mayGenerate || generating}
                  title={mayGenerate ? undefined : deniedReason("content.generate")}
                  data-testid="content-generate-submit"
                  className="inline-flex items-center gap-1.5 rounded-al-md bg-al-primary px-3.5 py-2 text-sm font-semibold text-al-primary-fg hover:bg-al-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-al-focus disabled:opacity-50"
                >
                  {generating ? (
                    <Loader2 size={14} className="animate-spin" aria-hidden />
                  ) : (
                    <Rocket size={14} aria-hidden />
                  )}
                  {regenerate ? "Regenerate batch" : "Generate batch"}
                </button>
              </div>
            </section>

            {/* Jobs */}
            <section data-testid="content-jobs-list">
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-xs font-bold uppercase tracking-wide text-slate-400">
                  Recent jobs
                  {activeFailures > 0 && (
                    <span className="ml-2 rounded-full bg-al-danger-subtle px-2 py-0.5 text-[11px] font-semibold text-al-danger-fg">
                      {activeFailures} with failures
                    </span>
                  )}
                </h3>
                <button
                  type="button"
                  onClick={() => void load()}
                  data-testid="content-jobs-refresh"
                  className="rounded px-1.5 py-0.5 text-xs font-semibold text-al-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-al-focus"
                >
                  Refresh
                </button>
              </div>

              <div aria-live="polite" className="sr-only">
                {notice}
              </div>
              {notice && (
                <p className="mb-2 rounded-al-md bg-al-success-subtle px-3 py-2 text-xs text-al-success-fg">
                  {notice}
                </p>
              )}
              {error && (
                <p
                  role="alert"
                  data-testid="content-jobs-error"
                  className="mb-2 rounded-al-md bg-al-danger-subtle px-3 py-2 text-xs text-al-danger-fg"
                >
                  {error}
                </p>
              )}

              {loading ? (
                <p className="py-8 text-center text-slate-400" data-testid="content-jobs-loading">
                  <Loader2 size={18} className="inline animate-spin" aria-hidden />
                  <span className="sr-only">Loading jobs…</span>
                </p>
              ) : jobs.length === 0 ? (
                <p className="py-8 text-center text-sm text-slate-500" data-testid="content-jobs-empty">
                  No generation batches have been run yet.
                </p>
              ) : (
                <ul className="space-y-2">
                  {jobs.map((job) => {
                    const actions = actionsFor(job.status);
                    const done = job.succeededItems + job.failedItems;
                    const pct = job.totalItems > 0 ? Math.round((done / job.totalItems) * 100) : 0;
                    return (
                      <li
                        key={job.id}
                        data-testid={`content-job-${job.id}`}
                        className="rounded-al-md border border-al-border bg-white p-3"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <span
                            className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                              JOB_TONE[job.status] ?? "bg-slate-100 text-slate-600"
                            }`}
                          >
                            {job.status}
                          </span>
                          <span className="text-xs font-medium text-slate-600">{job.jobType}</span>
                          <span className="ml-auto text-xs tabular-nums text-slate-400">
                            {new Date(job.createdAt).toLocaleString("en-US")}
                          </span>
                        </div>

                        <p className="mt-1.5 text-xs tabular-nums text-slate-600">
                          {job.succeededItems.toLocaleString("en-US")} succeeded ·{" "}
                          <span className={job.failedItems > 0 ? "font-semibold text-al-danger" : ""}>
                            {job.failedItems.toLocaleString("en-US")} failed
                          </span>{" "}
                          · {job.totalItems.toLocaleString("en-US")} total
                        </p>

                        <div
                          className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-100"
                          role="img"
                          aria-label={`${pct} percent of items settled`}
                        >
                          <span
                            className="block h-full rounded-full bg-al-primary"
                            style={{ width: `${pct}%` }}
                          />
                        </div>

                        {job.lastError && (
                          <p className="mt-2 flex items-start gap-1.5 rounded bg-al-danger-subtle px-2 py-1.5 text-[11px] text-al-danger-fg">
                            <AlertTriangle size={12} className="mt-0.5 shrink-0" aria-hidden />
                            <span className="break-words">{job.lastError}</span>
                          </p>
                        )}

                        {actions.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {actions.map((action) => {
                              const Icon = ACTION_META[action].icon;
                              return (
                                <button
                                  key={action}
                                  type="button"
                                  onClick={() => runAction(job.id, action)}
                                  disabled={!mayManage || busyJob === job.id}
                                  title={mayManage ? undefined : deniedReason("content.manage_jobs")}
                                  data-testid={`content-job-${action}-${job.id}`}
                                  className="inline-flex items-center gap-1 rounded border border-al-border px-2 py-1 text-[11px] font-semibold text-slate-600 hover:bg-al-bg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-al-focus disabled:opacity-50"
                                >
                                  {busyJob === job.id ? (
                                    <Loader2 size={11} className="animate-spin" aria-hidden />
                                  ) : (
                                    <Icon size={11} aria-hidden />
                                  )}
                                  {ACTION_META[action].label}
                                </button>
                              );
                            })}
                          </div>
                        )}

                        {!mayManage && actions.length > 0 && (
                          <p className="mt-1.5 text-[11px] text-slate-400">
                            {deniedReason("content.manage_jobs")}
                          </p>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
