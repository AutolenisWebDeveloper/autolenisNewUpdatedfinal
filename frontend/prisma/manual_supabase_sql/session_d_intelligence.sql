-- Session D — Intelligence Index + Competitor Monitoring
-- Adds the competitor_insights table backing the weekly competitor content
-- scan and the admin Intelligence page. Safe to re-run (IF NOT EXISTS).

CREATE TABLE IF NOT EXISTS competitor_insights (
  id                   TEXT        NOT NULL PRIMARY KEY,
  competitor           TEXT        NOT NULL,
  topic                TEXT        NOT NULL,
  content_type         TEXT        NOT NULL,
  estimated_engagement TEXT        NOT NULL,
  opportunity          TEXT        NOT NULL,
  suggested_hook       TEXT        NOT NULL DEFAULT '',
  signal_created       BOOLEAN     NOT NULL DEFAULT false,
  week_of              TEXT        NOT NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS competitor_insights_week_idx
  ON competitor_insights(week_of);
