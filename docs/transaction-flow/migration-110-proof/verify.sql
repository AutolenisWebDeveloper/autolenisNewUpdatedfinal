-- Migration 110 verification — the PHYSICAL half. Run AFTER `prisma migrate deploy`.
--
-- CLAUDE.md requires BOTH halves and says neither alone is sufficient: this file and ledger.sql.
-- A correct ledger row with the wrong index is a silent lie, and a correct index with no ledger row
-- gets re-applied on the next deploy.
--
-- Every row returns PRESENT or MISSING. A MISSING row is REPORTED, never repaired with DDL: the
-- repair is a new forward migration or an owner-approved `migrate resolve`.
--
-- Read-only. Same mandated shape as the preflight.

\pset footer off

-- The predicate is asserted, not just the index's existence. An index on the right columns with the
-- wrong WHERE clause is the defect this migration exists to remove.
SELECT 'V1 rooftop index is partial AND excludes REPLACED' AS assertion,
       CASE WHEN count(*) = 1 THEN 'PRESENT' ELSE 'MISSING' END AS verdict,
       coalesce(max(indexdef), 'absent') AS detail
  FROM pg_indexes
 WHERE tablename = 'auction_invitations'
   AND indexname = 'auction_invitations_auction_rooftop_active_key'
   AND indexdef LIKE '%rooftop_id IS NOT NULL%'
   AND indexdef LIKE '%REPLACED%'
UNION ALL
SELECT 'V2 dealer index is partial AND excludes REPLACED',
       CASE WHEN count(*) = 1 THEN 'PRESENT' ELSE 'MISSING' END,
       coalesce(max(indexdef), 'absent')
  FROM pg_indexes
 WHERE tablename = 'auction_invitations'
   AND indexname = 'auction_invitations_auction_id_dealer_active_key'
   AND indexdef LIKE '%dealer_id IS NOT NULL%'
   AND indexdef LIKE '%REPLACED%'
UNION ALL
SELECT 'V3 both superseded indexes are GONE',
       CASE WHEN count(*) = 0 THEN 'PRESENT' ELSE 'MISSING' END,
       CASE WHEN count(*) = 0 THEN 'neither remains'
            ELSE 'STILL PRESENT: ' || string_agg(indexname, ', ') END
  FROM pg_indexes
 WHERE tablename = 'auction_invitations'
   AND indexname IN ('auction_invitations_auction_rooftop_key',
                     'auction_invitations_auction_id_dealer_id_key')
UNION ALL
-- Both new indexes must still be UNIQUE. A partial index that lost its uniqueness would satisfy
-- V1/V2's name and predicate checks and enforce nothing.
SELECT 'V4 both new indexes are UNIQUE',
       CASE WHEN count(*) = 2 THEN 'PRESENT' ELSE 'MISSING' END,
       count(*)::text || ' of 2 unique'
  FROM pg_index i
  JOIN pg_class c ON c.oid = i.indexrelid
 WHERE i.indisunique
   AND c.relname IN ('auction_invitations_auction_rooftop_active_key',
                     'auction_invitations_auction_id_dealer_active_key')
UNION ALL
-- The guarantee that matters, restated as data: uniqueness still holds for LIVE invitations.
SELECT 'V5 no duplicate live (auction_id, rooftop_id) survives',
       CASE WHEN count(*) = 0 THEN 'PRESENT' ELSE 'MISSING' END,
       count(*)::text || ' duplicate(s)'
  FROM (
    SELECT auction_id, rooftop_id FROM auction_invitations
     WHERE rooftop_id IS NOT NULL AND status <> 'REPLACED'
     GROUP BY 1, 2 HAVING count(*) > 1
  ) d
 ORDER BY 1
;
