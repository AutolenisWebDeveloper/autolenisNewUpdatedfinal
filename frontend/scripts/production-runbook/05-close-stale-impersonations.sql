-- ############################################################################
-- ⛔ MOOT as of 2026-08-29 — admin_impersonations has 0 ROWS in production.
--
-- Verified by read-only inspection: the table exists and is empty, so there are
-- no stranded ACTIVE sessions to close and nothing for the UPDATE below to do.
-- The runbook this belongs to also has an INVALID premise and is disabled —
-- see scripts/production-runbook/RUNBOOK.md.
--
-- The SELECT remains safe to run at any time.
-- ############################################################################

-- STEP 5 (OPTIONAL, owner decision) — stale ACTIVE impersonation sessions.
--
-- Batch 3 (PR #346) tightened impersonation to SUPER_ADMIN. Any session a
-- SUPPORT_ADMIN opened before that merge is stranded: its owner can no longer
-- call the end route, there is no auto-expiry, and the audit record shows it
-- ACTIVE forever. Nothing consults these rows for authorization — this is
-- audit-record hygiene, not a live privilege.
--
-- Run the SELECT first. If (and only if) the rows shown should be closed,
-- uncomment and run the UPDATE — it stamps endedAt and flags the reason.

select id, admin_id, target_user_id, reason, started_at, now()-started_at as open_for
from admin_impersonations
where status = 'ACTIVE'
order by started_at;

-- update admin_impersonations
--    set status = 'ENDED',
--        ended_at = now(),
--        reason = reason || ' [closed administratively: stranded ACTIVE session]'
--  where status = 'ACTIVE'
--    and started_at < 'YYYY-MM-DD';   -- <- set an explicit cutoff before running
