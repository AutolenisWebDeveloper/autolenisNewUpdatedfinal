-- RESTORE SCAFFOLD — NOT production objects.
--
-- Production's `public` policies reference the Supabase-managed roles (service_role, authenticated,
-- anon) and the Supabase-managed `auth` schema, neither of which lives in the `public` schema and
-- neither of which this proof claims to reproduce. Without them the policy expressions cannot be
-- parsed or stored, so the 23 policies could not be restored at all. These stubs exist ONLY so the
-- restored database can hold the same policy objects; they are explicitly NOT evidence about
-- production's auth implementation, and they are excluded from every census in the proof.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon')          THEN CREATE ROLE anon NOLOGIN;          END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role')  THEN CREATE ROLE service_role NOLOGIN;  END IF;
END $$;

CREATE SCHEMA IF NOT EXISTS auth;

-- Signature-compatible stub. Production's auth.uid() reads the request JWT; this one always returns
-- NULL, which is correct for a database with no request context and is never exercised by this proof.
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $fn$ SELECT NULL::uuid $fn$;
