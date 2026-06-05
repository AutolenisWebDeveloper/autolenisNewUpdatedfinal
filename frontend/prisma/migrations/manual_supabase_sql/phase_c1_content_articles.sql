-- =====================================================
-- AutoLenis Phase C1 — ContentArticle Migration
-- Programmatic SEO content engine storage + lifecycle.
-- Run this in the Supabase SQL Editor.
-- Idempotent: safe to re-run.
-- =====================================================

-- Article lifecycle status enum.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ArticleStatus') THEN
    CREATE TYPE "ArticleStatus" AS ENUM ('DRAFT', 'REVIEW_NEEDED', 'PUBLISHED', 'ARCHIVED');
  END IF;
END$$;

CREATE TABLE IF NOT EXISTS content_articles (
  id               TEXT NOT NULL DEFAULT gen_random_uuid()::TEXT,
  slug             TEXT NOT NULL,
  cluster          TEXT NOT NULL,           -- dealer_quotes|otd_price|dealer_fees|trade_in|leasing
  make             TEXT,
  model            TEXT,
  city             TEXT NOT NULL,
  state            TEXT NOT NULL,
  metro            TEXT,
  wave             INTEGER NOT NULL DEFAULT 1,
  target_keyword   TEXT NOT NULL,
  title            TEXT NOT NULL,
  meta_description TEXT NOT NULL,
  h1               TEXT NOT NULL,
  body             TEXT NOT NULL,
  faq_json         TEXT,
  word_count       INTEGER,
  author_slug      TEXT NOT NULL DEFAULT 'markist',
  status           "ArticleStatus" NOT NULL DEFAULT 'DRAFT',
  quality_score    INTEGER,
  quality_flags    TEXT,
  published_at     TIMESTAMPTZ,
  generated_at     TIMESTAMPTZ,
  groq_model       TEXT,
  search_grounded  BOOLEAN,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT content_articles_pkey PRIMARY KEY (id)
);

CREATE UNIQUE INDEX IF NOT EXISTS content_articles_slug_key       ON content_articles (slug);
CREATE INDEX IF NOT EXISTS content_articles_cluster_idx           ON content_articles (cluster);
CREATE INDEX IF NOT EXISTS content_articles_status_idx            ON content_articles (status);
CREATE INDEX IF NOT EXISTS content_articles_city_state_idx        ON content_articles (city, state);
CREATE INDEX IF NOT EXISTS content_articles_metro_idx             ON content_articles (metro);
CREATE INDEX IF NOT EXISTS content_articles_wave_idx              ON content_articles (wave);
CREATE INDEX IF NOT EXISTS content_articles_published_at_idx      ON content_articles (published_at);

-- Keep updated_at fresh on UPDATE (Prisma @updatedAt parity at the DB layer).
CREATE OR REPLACE FUNCTION set_content_articles_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_content_articles_updated_at ON content_articles;
CREATE TRIGGER trg_content_articles_updated_at
  BEFORE UPDATE ON content_articles
  FOR EACH ROW
  EXECUTE FUNCTION set_content_articles_updated_at();
