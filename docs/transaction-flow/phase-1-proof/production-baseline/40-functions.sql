-- PRODUCTION PHYSICAL SCHEMA — functions (12/12, none denied).
-- Verbatim pg_get_functiondef() output. No credentials, no data.
--
-- OBSERVATION (not corrected here; Phase 1 changes no production object):
-- public.financing_audit_events_block_delete() has an EMPTY body in production. As a BEFORE DELETE
-- trigger function, a plpgsql body that falls through returns NULL, which suppresses the DELETE
-- silently instead of raising like its _block_update()/_block_truncate() siblings. It is reproduced
-- here EXACTLY as production has it, because this file's job is to be production, not to be correct.

CREATE OR REPLACE FUNCTION public.cleanup_old_idempotency_keys()
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  removed INT;
BEGIN
  WITH del AS (
    DELETE FROM idempotency_keys
    WHERE created_at < now() - INTERVAL '30 days'
    RETURNING 1
  )
  SELECT count(*) INTO removed FROM del;
  RETURN removed;
END;
$function$;

CREATE OR REPLACE FUNCTION public.financing_audit_events_block_delete()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
  -- function body
END;
$function$;

CREATE OR REPLACE FUNCTION public.financing_audit_events_block_truncate()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  raise exception 'financing_audit_events is append-only — truncate is not permitted'
    using errcode = 'restrict_violation', hint = 'The audit chain must never be truncated.';
end;
$function$;

CREATE OR REPLACE FUNCTION public.financing_audit_events_block_update()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  RAISE EXCEPTION 'financing_audit_events is append-only — UPDATE is not permitted (row id=%)', OLD.id
    USING ERRCODE = 'restrict_violation', HINT = 'Append a corrective event instead. The audit chain must stay immutable.';
END; $function$;

CREATE OR REPLACE FUNCTION public.prevent_audit_log_mutation()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
  RAISE EXCEPTION 'audit_log_immutable: rows in admin_audit_logs cannot be updated or deleted'
    USING ERRCODE = 'restrict_violation';
  RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.refresh_analytics_views()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_funnel_metrics;
END;
$function$;

CREATE OR REPLACE FUNCTION public.set_amips_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.set_content_attributions_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.set_social_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.set_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_content_articles_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$function$;
