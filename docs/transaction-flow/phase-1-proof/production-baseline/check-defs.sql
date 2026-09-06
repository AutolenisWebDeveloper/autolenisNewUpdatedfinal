-- Every CHECK constraint in `public`, one per line, as
--     table.constraint|ENUMERABLE|<full pg_get_constraintdef>
--     table.constraint|OPAQUE|<full pg_get_constraintdef>
--
-- WHY THE CLASSIFICATION EXISTS. `check-sets.sql` proves a rewritten CHECK still admits every value
-- production admitted by ENUMERATING the values it accepts. That method is valid for one predicate
-- shape only: a finite list of literals. For a range, an arithmetic expression, a conditional or a
-- cross-column relationship, enumeration is not a proof of anything — such a predicate contributes
-- no literals at all, so a rewrite that narrowed it would sail through a value-set comparison
-- reporting "nothing lost". This schema already contains eight of them (the
-- `*_ip_unavailable_reason_exclusive` pair rule, `a IS NULL OR b IS NULL`), so the shape is not
-- hypothetical.
--
-- `run-proof.sh` therefore refuses to accept the enumeration proof for any constraint whose
-- DEFINITION changed unless it is ENUMERABLE on both sides. A changed OPAQUE constraint fails the
-- run and must have its preservation demonstrated explicitly — the implication old ⇒ new argued and
-- recorded — before the rewrite can ship. It also fails if a CHECK present before is absent after,
-- which a value-set comparison alone would only notice for enumerable ones.
--
-- ENUMERABLE means exactly one of the two canonical forms PostgreSQL prints for a finite list:
--     CHECK ((col = ANY (ARRAY['a'::text, 'b'::text])))
--     CHECK (((col IS NULL) OR (col = ANY (ARRAY['a'::text, 'b'::text]))))
-- with the SAME column on both sides of the second form. Anything else is OPAQUE. The classifier is
-- deliberately strict: misreading an opaque predicate as enumerable is the failure that matters, and
-- an unfamiliar-but-safe shape only costs one explicit demonstration.
--
-- The key carries the constrained column for the same reason `check-sets.sql` does: a rewrite that
-- keeps the canonical shape but changes the column would otherwise look like no change at all.
--
-- Read-only. Runs unchanged against either side, like `census.sql` and `digests.sql`.
SELECT t.relname || '.' || c.conname || '(' || coalesce((SELECT string_agg(a.attname, ',' ORDER BY k.ord)
                  FROM unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord)
                  JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum), '-') || ')|'
    || CASE
         WHEN pg_get_constraintdef(c.oid) ~
              $re$^CHECK \(\("?[a-zA-Z_][a-zA-Z0-9_]*"? = ANY \(ARRAY\['[^']*'::text(, '[^']*'::text)*\]\)\)\)$$re$
           OR pg_get_constraintdef(c.oid) ~
              $re$^CHECK \(\(\("?([a-zA-Z_][a-zA-Z0-9_]*)"? IS NULL\) OR \("?\1"? = ANY \(ARRAY\['[^']*'::text(, '[^']*'::text)*\]\)\)\)\)$$re$
         THEN 'ENUMERABLE' ELSE 'OPAQUE'
       END
    || '|' || pg_get_constraintdef(c.oid) AS check_def
FROM pg_constraint c
JOIN pg_class t ON t.oid = c.conrelid
JOIN pg_namespace n ON n.oid = t.relnamespace
WHERE n.nspname = 'public' AND c.contype = 'c'
ORDER BY 1;
