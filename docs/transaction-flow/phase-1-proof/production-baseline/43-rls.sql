-- PRODUCTION PHYSICAL SCHEMA — row-level security enablement.
-- Production has RLS ENABLED on 249/249 public tables and FORCE on exactly one
-- (public.encouragement_messages, which carries no policy at all).
DO $$
DECLARE r record; n int := 0;
BEGIN
  FOR r IN SELECT c.relname FROM pg_class c JOIN pg_namespace ns ON ns.oid=c.relnamespace
           WHERE ns.nspname='public' AND c.relkind='r' ORDER BY c.relname
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', r.relname);
    n := n + 1;
  END LOOP;
  IF n <> 249 THEN
    RAISE EXCEPTION 'RLS enablement covered % tables, production has 249', n;
  END IF;
END $$;

ALTER TABLE public.encouragement_messages FORCE ROW LEVEL SECURITY;
