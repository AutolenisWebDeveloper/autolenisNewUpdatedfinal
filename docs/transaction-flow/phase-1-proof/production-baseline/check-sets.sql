-- Every value a CHECK constraint in `public` admits, one per line, as `table.constraint|value`.
--
-- WHY THIS EXISTS. A rewritten CHECK is the one statement in this wave that can *narrow* production
-- silently. `DROP CONSTRAINT IF EXISTS` + `ADD CONSTRAINT` succeeds whether the new list is a superset
-- of the old one or a subset of it, and a subset only surfaces later as a 23514 on a value production
-- used to accept — after the migration is in the chain and, per CLAUDE.md, no longer editable.
-- Dropping `deposit_reminder_5`/`_6` would break the six-touch $99 recovery cadence exactly that way.
--
-- `run-proof.sh` runs this file against the restored production baseline BEFORE applying the wave and
-- again AFTER, and fails if any (constraint, value) pair present before is absent after. The "before"
-- side is therefore re-derived from the committed baseline on every run rather than transcribed into
-- an expectation that can go stale.
--
-- THE KEY INCLUDES THE CONSTRAINED COLUMN, not just the constraint name. Without it a rewrite that
-- keeps the shape but moves to a different column —
--     ADD CONSTRAINT comms_outbox_status_check CHECK (last_result = ANY (ARRAY[…the same 8…]))
-- a plausible copy-paste error — emits byte-identical `(constraint, value)` pairs, so the comparison
-- reports "nothing lost" while `status` is left entirely unconstrained.
--
-- Read-only. Runs unchanged against either side, like `census.sql` and `digests.sql`.
--
-- SCOPE. It reports the string literals of a constraint's definition. For the `x IN (…)` form
-- PostgreSQL normalises to `x = ANY (ARRAY[…])`, so those are exactly the admitted values. A CHECK
-- with no string literal (`ip_address IS NULL OR reason IS NULL`) contributes no line, which is
-- correct — it enumerates nothing. A literal containing an embedded quote would be reported
-- truncated; none exists in this schema, and the constraint digest in `digests.sql` would catch a
-- change to one regardless.
SELECT DISTINCT t.relname || '.' || c.conname || '(' || coalesce((SELECT string_agg(a.attname, ',' ORDER BY k.ord)
                  FROM unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord)
                  JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum), '-') || ')|' || g[1] AS check_value
FROM pg_constraint c
JOIN pg_class t ON t.oid = c.conrelid
JOIN pg_namespace n ON n.oid = t.relnamespace,
LATERAL regexp_matches(pg_get_constraintdef(c.oid), '''([^'']*)''', 'g') AS m(g)
WHERE n.nspname = 'public' AND c.contype = 'c'
ORDER BY 1;
