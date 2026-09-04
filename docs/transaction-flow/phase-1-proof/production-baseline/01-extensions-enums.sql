-- Extensions. `supabase_vault` and `pg_stat_statements` are Supabase-platform extensions that are
-- not present in a stock PostgreSQL distribution; they are recorded here and reported as NOT
-- RESTORABLE rather than silently dropped. Neither is referenced by any column default, constraint
-- or index in the application schema (verified by catalog search), so their absence does not change
-- the objects this proof applies to.
--   CREATE EXTENSION IF NOT EXISTS pg_stat_statements WITH SCHEMA extensions;   -- NOT RESTORABLE
--   CREATE EXTENSION IF NOT EXISTS supabase_vault WITH SCHEMA vault;            -- NOT RESTORABLE
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS plpgsql WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;
