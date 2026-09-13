-- D12a — the email_suppression soft-reason count. ITS OWN FILE, deliberately.
--
-- RUN THIS ONLY IF preflight.sql's D12 row reported `present`.
--
-- Why it is not in preflight.sql. `email_suppression` is the one table this wave touches that
-- is NOT in the Prisma chain: it is created by `frontend/migrations/01_phase1_foundation.sql`,
-- one of the 15 numbered CRM files, so a chain-only database does not have it. PostgreSQL
-- resolves relation names at PARSE time, so a statement naming it cannot be skipped by a
-- condition inside the file — it fails before any guard could run, and under the protocol's
-- mandated `--single-transaction -v ON_ERROR_STOP=1` that aborts the run and exits non-zero.
--
-- That is finding 27's second half, found by Copilot review on #422. Splitting D12 moved the
-- presence probe into a parse-safe `to_regclass` call so every BLOCK verdict prints; it left
-- this count in the same file behind a comment that said "skip this one statement if D12
-- reported ABSENT". A comment is an instruction to a person, not an executable guard: psql runs
-- the statement regardless. The gate rows survived and the exit code did not.
--
-- A separate file makes the skip real: the operator runs it, or does not.
--
--   psql "$DIRECT_URL" -X -v ON_ERROR_STOP=1 --single-transaction \
--     -c "SET TRANSACTION READ ONLY" -f docs/transaction-flow/phase-5-proof/preflight-d12a.sql
--
-- Read-only. Production HAS this table, so the owner's step 2 runs both files and both exit 0.

\pset footer off

SELECT 'D12a email_suppression rows with a soft reason (unsubscribed / admin_added)' AS check_name,
       'CHECKED' AS verdict,
       count(*)::text || ' row(s)' AS detail
  FROM email_suppression
 WHERE reason IN ('unsubscribed', 'admin_added')
;
