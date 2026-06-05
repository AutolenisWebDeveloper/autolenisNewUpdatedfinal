-- AutoLenis Tier 4 — Phase C1: SEO Content Engine infrastructure
--
-- Creates the content_articles table that backs the programmatic buying-guide
-- pages served at /buying-guide/[slug]. One row per article. Articles are
-- generated (Phase C2), reviewed in the admin UI (Phase C3), then published.
-- Only status = 'PUBLISHED' rows are rendered publicly and listed in sitemap.
--
-- Run in the Supabase SQL editor. Safe to re-run (all statements are guarded).

-- ArticleStatus enum — DRAFT (generated, awaiting review) → PUBLISHED → ARCHIVED.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ArticleStatus') THEN
    CREATE TYPE "ArticleStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS content_articles (
  id               TEXT PRIMARY KEY,
  slug             TEXT NOT NULL,
  cluster          TEXT NOT NULL,
  make             TEXT,
  model            TEXT,
  city             TEXT NOT NULL,
  state            TEXT NOT NULL DEFAULT 'TX',
  target_keyword   TEXT NOT NULL,
  title            TEXT NOT NULL,
  meta_description TEXT NOT NULL,
  h1               TEXT NOT NULL,
  body             TEXT NOT NULL,
  faq_json         TEXT,
  word_count       INTEGER,
  status           "ArticleStatus" NOT NULL DEFAULT 'DRAFT',
  published_at     TIMESTAMP(3),
  generated_at     TIMESTAMP(3),
  groq_model       TEXT,
  search_grounded  BOOLEAN,
  created_at       TIMESTAMP(3) NOT NULL DEFAULT now(),
  updated_at       TIMESTAMP(3) NOT NULL DEFAULT now()
);

-- Unique slug (drives the /buying-guide/[slug] lookup).
CREATE UNIQUE INDEX IF NOT EXISTS content_articles_slug_key
  ON content_articles (slug);

-- Query indexes — match the Prisma @@index declarations.
CREATE INDEX IF NOT EXISTS content_articles_cluster_idx
  ON content_articles (cluster);
CREATE INDEX IF NOT EXISTS content_articles_status_idx
  ON content_articles (status);
CREATE INDEX IF NOT EXISTS content_articles_city_idx
  ON content_articles (city);
CREATE INDEX IF NOT EXISTS content_articles_published_at_idx
  ON content_articles (published_at);
