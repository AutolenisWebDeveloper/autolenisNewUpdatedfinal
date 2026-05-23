-- Migration: audit_log_append_only_trigger
--
-- Enforces the append-only invariant on `admin_audit_logs` at the database
-- level. Until now this was a code-level convention only — no Prisma call
-- writes UPDATE or DELETE against the table — but a future bug, ad-hoc DB
-- console session, or malicious admin could still mutate or erase rows.
-- The triggers below raise an exception on any UPDATE or DELETE attempt
-- so the only legal write path is INSERT.
--
-- Compliance: this protects the audit trail required for OFAC, refund, and
-- contract-shield review history. Even SUPER_ADMIN cannot tamper with logs
-- without explicitly dropping the trigger — which itself is a privileged DDL
-- operation that leaves a Postgres event-trigger trail.
--
-- Idempotent: re-running this migration is a no-op (CREATE OR REPLACE for
-- the trigger function; DROP IF EXISTS for the triggers before re-create).

DO $$ BEGIN
  IF to_regclass(format('%I.%I', current_schema(), 'admin_audit_logs')) IS NOT NULL THEN

    CREATE OR REPLACE FUNCTION admin_audit_logs_block_update()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $fn$
    BEGIN
      RAISE EXCEPTION 'admin_audit_logs is append-only — UPDATE is not permitted (row id=%)', OLD.id
        USING ERRCODE = 'restrict_violation',
              HINT = 'If you need to correct an entry, INSERT a new corrective row instead. The audit trail must remain immutable.';
    END;
    $fn$;

    CREATE OR REPLACE FUNCTION admin_audit_logs_block_delete()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $fn$
    BEGIN
      RAISE EXCEPTION 'admin_audit_logs is append-only — DELETE is not permitted (row id=%)', OLD.id
        USING ERRCODE = 'restrict_violation',
              HINT = 'Audit log entries must never be deleted. Drop and recreate this trigger only with explicit board-level approval.';
    END;
    $fn$;

    DROP TRIGGER IF EXISTS admin_audit_logs_no_update ON "admin_audit_logs";
    CREATE TRIGGER admin_audit_logs_no_update
      BEFORE UPDATE ON "admin_audit_logs"
      FOR EACH ROW
      EXECUTE FUNCTION admin_audit_logs_block_update();

    DROP TRIGGER IF EXISTS admin_audit_logs_no_delete ON "admin_audit_logs";
    CREATE TRIGGER admin_audit_logs_no_delete
      BEFORE DELETE ON "admin_audit_logs"
      FOR EACH ROW
      EXECUTE FUNCTION admin_audit_logs_block_delete();

  END IF;
END $$;
