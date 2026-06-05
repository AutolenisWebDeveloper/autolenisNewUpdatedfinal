-- Fix dealer_prospects schema drift
--
-- The Prisma DealerProspect model defines `contactTitle String? @map("contact_title")`,
-- but that column was never added to the live database (its sibling `contact_name`
-- was). Because the /admin/dealer-outreach query does `findMany({ include: ... })`
-- with no `select`, Prisma asks Postgres for every mapped column — including the
-- missing `contact_title` — which fails. Prisma surfaces this as a misleading
-- "column dealer_prospects.contact_name does not exist" error (it reports an
-- adjacent column from the SELECT list).
--
-- Run in the Supabase SQL editor. Safe to re-run (guarded with IF NOT EXISTS).

ALTER TABLE dealer_prospects
  ADD COLUMN IF NOT EXISTS contact_title TEXT;
