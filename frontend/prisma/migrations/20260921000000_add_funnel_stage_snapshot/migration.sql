-- S5 — funnel observability snapshot store (derive-by-snapshot, not an
-- event-incremented counter). One row per named funnel metric per snapshot run.
CREATE TABLE "funnel_stage_snapshots" (
    "id" TEXT NOT NULL,
    "snapshot_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metric" TEXT NOT NULL,
    "count" INTEGER NOT NULL,
    "window_hours" INTEGER,
    CONSTRAINT "funnel_stage_snapshots_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "funnel_stage_snapshots_metric_snapshot_date_idx" ON "funnel_stage_snapshots"("metric", "snapshot_date");
