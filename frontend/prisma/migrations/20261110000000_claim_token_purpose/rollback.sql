-- Rollback for 20261110000000_claim_token_purpose.
--
-- Roll the CODE back FIRST. `issueResumeToken` requires a purpose and both lookups
-- filter on it; dropping the column under a deployment that still declares it in
-- schema.prisma raises 42703 undefined_column on every read of this table -- which
-- is the $99 resume link and the rule-16 claim link at the same time.
--
-- WHAT IS LOST. The purpose of every token minted since this applied. Tokens are
-- short-lived (five-day TTL) and single-use, so the practical loss is bounded to at
-- most five days of live rows, and the rows themselves survive -- only the column
-- saying what each one authorises goes.
--
-- WHAT ROLLING BACK RE-OPENS, stated so the trade is explicit rather than
-- discovered: without this column every token in the table is interchangeable again,
-- so a $99 pre-checkout resume link becomes a rule-16 tier-2 write credential if
-- pasted into `/request-vehicle?claim=`. That is the defect the migration exists to
-- close. Rolling back is safe for the schema and not safe for the boundary.
--
-- No backfill is reversed: `legacy_unscoped` was written into a column that this
-- statement removes, so nothing is left behind.

ALTER TABLE "buyer_request_claim_tokens"
  DROP COLUMN IF EXISTS "purpose";
