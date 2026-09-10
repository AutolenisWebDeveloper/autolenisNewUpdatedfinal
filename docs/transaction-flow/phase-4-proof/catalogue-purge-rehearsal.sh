#!/usr/bin/env bash
# Rehearsal for catalogue-purge-establish.sql and catalogue-purge-delete.sql.
#
# WHY THIS EXISTS. The purge is DML against production business tables, run by the owner. SQL
# handed over unrun is a guess dressed as a deliverable. This restores production's PHYSICAL
# schema onto a disposable loopback database, seeds a SYNTHETIC replica of the 2026-09-10
# census, runs both scripts exactly as the owner will, and asserts the outcome -- including
# every direction the delete script is supposed to REFUSE.
#
# WHAT IT PROVES: the SQL parses and runs on production's real schema; the six-predicate delete
# set selects what the establish script counted and nothing else; the two blocking foreign keys
# are respected rather than routed around; the soft references are cleaned; the SET NULL is made
# visible; and the four fail-closed paths actually fail closed.
#
# WHAT IT DOES NOT PROVE: anything about production's actual row contents. The seed is modelled
# on the owner's read-only census (221 items, none geocoded, 15 shortlist_items, 3
# auction_vehicles) and is not a copy of production data.
#
# SAFETY: destructive (DROPs and CREATEs a database), so it refuses anything but a loopback
# server and a database name it created itself. It never touches production and never reads a
# production DSN.
set -euo pipefail

PGHOST_="${PROOF_HOST:-127.0.0.1}"
PGPORT_="${PROOF_PORT:-55432}"
PGUSER_="${PROOF_USER:-pgtest}"
DB="${PROOF_DB:-autolenis_e2e_purge}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../../.." && pwd)"
BASE="$HERE/../phase-1-proof/production-baseline"
MIGS="$REPO/frontend/prisma/migrations"

case "$PGHOST_" in
  127.0.0.1|::1|localhost) ;;
  *) echo "REFUSED: rehearsal host must be loopback, got '$PGHOST_'" >&2; exit 2 ;;
esac
case "$DB" in
  autolenis_e2e*) ;;
  *) echo "REFUSED: rehearsal database must be autolenis_e2e*, got '$DB'" >&2; exit 2 ;;
esac

ADMIN="postgresql://${PGUSER_}@${PGHOST_}:${PGPORT_}/postgres"
URL="postgresql://${PGUSER_}@${PGHOST_}:${PGPORT_}/${DB}"
CHAIN="20261106000000_transaction_spine_enums \
       20261106000100_transaction_spine_foundation \
       20261110000000_claim_token_purpose \
       20261111000000_deposit_status_disputed \
       20261112000000_stage4_trade_election"

echo "server_version=$(psql "$ADMIN" -At -c "select current_setting('server_version')")"

echo "== 1. restore production physical schema + committed chain =="
psql "$ADMIN" -q -c "DROP DATABASE IF EXISTS \"$DB\";" -c "CREATE DATABASE \"$DB\";"
for f in "$BASE"/[0-9]*.sql; do psql "$URL" -v ON_ERROR_STOP=1 -q -f "$f"; done
for d in $CHAIN; do { echo "BEGIN;"; cat "$MIGS/$d/migration.sql"; echo "COMMIT;"; } | psql "$URL" -v ON_ERROR_STOP=1 -q; done
echo "  restored"

if [ "${INTROSPECT_ONLY:-0}" = "1" ]; then
  for t in buyers shortlists shortlist_items inventory_items vehicle_requests auctions auction_vehicles \
           vehicle_match_scores inventory_price_alerts inventory_quality_scores vehicle_request_match_results; do
    echo "--- $t"
    psql "$URL" -At -F'|' -c "select column_name, data_type, is_nullable, coalesce(column_default,'-')
       from information_schema.columns where table_schema='public' and table_name='$t'
       and is_nullable='NO' order by ordinal_position;"
  done
  exit 0
fi

# ── The delete-blocking topology, read from the RESTORED PHYSICAL SCHEMA rather than from
#    the migration source. `r`=RESTRICT, `a`=NO ACTION, `n`=SET NULL, `c`=CASCADE.
echo "== 2. foreign keys into inventory_items, as the database actually holds them =="
FKS=$(psql "$URL" -At -F'|' -c "
  select cl.relname, con.confdeltype::text
    from pg_constraint con
    join pg_class cl on cl.oid = con.conrelid
    join pg_class fcl on fcl.oid = con.confrelid
   where con.contype='f' and fcl.relname='inventory_items'
   order by 1;")
echo "$FKS" | sed 's/^/  /'
EXPECT_FKS=$'auction_vehicles|a\nshortlist_items|r\nvehicle_requests|n'
[ "$FKS" = "$EXPECT_FKS" ] || {
  echo "FAIL: the FK topology is not what catalogue-purge-delete.sql was written against." >&2
  diff <(echo "$EXPECT_FKS") <(echo "$FKS") >&2 || true; exit 1; }
echo "  PASS: shortlist_items RESTRICT and auction_vehicles NO ACTION both block; vehicle_requests SET NULL does not"

echo "== 3. seed a synthetic replica of the 2026-09-10 census =="
psql "$URL" -v ON_ERROR_STOP=1 -q <<'SEED'
BEGIN;
-- 221 pre-repoint listings: no city/state/zip (207 NULL, 14 empty string, as counted in
-- production), no coordinates, no rooftop of either kind, swept from the NY market.
INSERT INTO inventory_items
  (id, lane, vin, year, make, model, price_cents, city, state, zip,
   external_dealer_state, external_dealer_name, is_active, last_seen_at, created_at, updated_at)
SELECT 'old_' || lpad(n::text, 3, '0'),
       'LANE_3', 'VINOLD' || lpad(n::text, 11, '0'),
       2019 + (n % 5), 'Honda', 'Accord', 1500000 + n * 1000,
       CASE WHEN n <= 14 THEN '' END, CASE WHEN n <= 14 THEN '' END, CASE WHEN n <= 14 THEN '' END,
       'NY', 'Some Dealership ' || n, true,
       timestamp '2026-09-03 04:00:00', timestamp '2026-09-01 08:00:00' + (n || ' seconds')::interval,
       timestamp '2026-09-03 04:00:00'
FROM generate_series(1, 221) n;

-- One buyer holding a shortlist of 15 of them, and one holding 3 as auction candidates.
-- Three shortlists of five, not one of fifteen: `shortlist_items_enforce_cap_trg` caps a
-- shortlist at five and `shortlists.buyer_id` is UNIQUE, so production's 15 rows are
-- necessarily spread across at least three buyers.
INSERT INTO users (id, supabase_id, email, role, created_at, updated_at, requires_password_change)
SELECT 'u_' || x, 'sb_' || x, x || '@example.test', 'BUYER', now(), now(), false
FROM unnest(ARRAY['a','b','c','d']) x;
INSERT INTO buyers (id, user_id, first_name, last_name, created_at, updated_at)
SELECT 'b_' || x, 'u_' || x, upper(x), 'Buyer', now(), now() FROM unnest(ARRAY['a','b','c','d']) x;
INSERT INTO shortlists (id, buyer_id, created_at, updated_at)
SELECT 'sl_' || x, 'b_' || x, now(), now() FROM unnest(ARRAY['a','c','d']) x;
INSERT INTO shortlist_items (id, shortlist_id, inventory_item_id, added_at)
SELECT 'si_' || n,
       'sl_' || (ARRAY['a','c','d'])[((n - 1) / 5) + 1],
       'old_' || lpad(n::text, 3, '0'), now()
FROM generate_series(1, 15) n;

INSERT INTO deposits (id, buyer_id, amount_cents, status, created_at, updated_at)
VALUES ('dep_b','b_b', 9900, 'PAID', now(), now());
INSERT INTO auctions (id, buyer_id, deposit_id, status, created_at, updated_at)
VALUES ('auc_b','b_b','dep_b','PENDING', now(), now());
INSERT INTO auction_vehicles (id, auction_id, inventory_item_id, created_at)
SELECT 'av_' || n, 'auc_b', 'old_' || lpad((100 + n)::text, 3, '0'), now() FROM generate_series(1, 3) n;

-- Four requests pointing at doomed listings (the SET NULL path), and one at a retained one.
-- One request per buyer: `vehicle_requests_one_open_per_buyer_key` allows a buyer only one
-- request in an open status, so the fifth is CANCELLED (not one of the ten open statuses).
INSERT INTO vehicle_requests (id, buyer_id, status, inventory_item_id, created_at, updated_at)
SELECT 'vr_' || n, 'b_' || (ARRAY['a','b','c','d'])[n], 'SUBMITTED',
       'old_' || lpad((200 + n)::text, 3, '0'), now(), now()
FROM generate_series(1, 4) n;
INSERT INTO vehicle_requests (id, buyer_id, status, inventory_item_id, created_at, updated_at)
VALUES ('vr_keep', 'b_a', 'CANCELLED', 'old_001', now(), now());

-- The four soft references, straddling doomed and retained rows so the cleanup has to be
-- selective rather than a truncate.
INSERT INTO vehicle_match_scores (id, buyer_id, inventory_item_id, score, factors, calculated_at)
SELECT 'vms_' || n, 'b_a', 'old_' || lpad(n::text, 3, '0'), 0.5, '{}'::jsonb, now() FROM generate_series(1, 30) n;
INSERT INTO inventory_price_alerts (id, buyer_id, inventory_item_id, target_price_cents, created_at)
SELECT 'ipa_' || n, 'b_a', 'old_' || lpad(n::text, 3, '0'), 1400000, now()
FROM unnest(ARRAY[10,11,12,13,14, 50,51,52,53,54]) n;   -- five shortlisted, five doomed
INSERT INTO inventory_quality_scores (id, inventory_item_id, score, photo_score, data_score, price_score, computed_at)
SELECT 'iqs_' || n, 'old_' || lpad(n::text, 3, '0'), 50, 10, 20, 20, now() FROM generate_series(1, 40) n;
INSERT INTO vehicle_request_match_results (id, request_id, inventory_item_id, source, found_at)
SELECT 'vrm_' || n, 'vr_1', 'old_' || lpad((20 + n)::text, 3, '0'), 'LANE_3', now() FROM generate_series(1, 12) n;
INSERT INTO vehicle_request_match_results (id, request_id, inventory_item_id, source, found_at)
VALUES ('vrm_null', 'vr_1', NULL, 'CUSTOM', now());
COMMIT;
SEED
echo "  seeded: $(psql "$URL" -At -c 'select count(*) from inventory_items') listings, \
$(psql "$URL" -At -c 'select count(*) from shortlist_items') shortlist_items, \
$(psql "$URL" -At -c "select count(*) from auction_vehicles where inventory_item_id is not null") candidates"

echo "== 4. the establish script runs inside a SERVER-ENFORCED read-only transaction =="
psql "$URL" -X -v ON_ERROR_STOP=1 --single-transaction \
  -c "SET TRANSACTION READ ONLY" -f "$HERE/catalogue-purge-establish.sql" > /tmp/p4-establish.out
grep -q 'deletable' /tmp/p4-establish.out || { echo "FAIL: establish produced no delete-set count" >&2; exit 1; }
DELETABLE=$(psql "$URL" -At -c "
  select count(*) from inventory_items i
   where not exists (select 1 from shortlist_items s where s.inventory_item_id = i.id)
     and not exists (select 1 from auction_vehicles a where a.inventory_item_id = i.id);")
echo "  establish ran read-only; deletable = $DELETABLE (221 - 15 shortlisted - 3 candidates = 203)"
[ "$DELETABLE" = "203" ] || { echo "FAIL: expected 203 deletable, got $DELETABLE" >&2; exit 1; }

# ── The four directions the delete script must REFUSE ───────────────────────────────────
refuse() { # refuse <label> <needle> <psql args...>
  local label="$1" needle="$2"; shift 2
  local out; set +e
  out=$(psql "$URL" -X -v ON_ERROR_STOP=1 "$@" -f "$HERE/catalogue-purge-delete.sql" 2>&1); local rc=$?
  set -e
  [ $rc -ne 0 ] || { echo "FAIL: $label — the script SUCCEEDED and should have refused" >&2; exit 1; }
  case "$out" in *"$needle"*) ;; *) echo "FAIL: $label — wrong refusal: $out" >&2; exit 1 ;; esac
  local n; n=$(psql "$URL" -At -c "select count(*) from inventory_items;")
  [ "$n" = "223" ] || { echo "FAIL: $label — refused but deleted anyway ($n listings left of 223)" >&2; exit 1; }
  echo "  PASS: $label"
}

echo "== 5. refuses with no geocoded listing present (the empty-catalogue window) =="
BEFORE_N=$(psql "$URL" -At -c "select count(*) from inventory_items;")
[ "$BEFORE_N" = "221" ] || { echo "FAIL: expected 221 seeded rows, got $BEFORE_N" >&2; exit 1; }
set +e
OUT=$(psql "$URL" -X -v ON_ERROR_STOP=1 -v expected_deletes=203 -f "$HERE/catalogue-purge-delete.sql" 2>&1); RC=$?
set -e
[ $RC -ne 0 ] || { echo "FAIL: it deleted with an empty forward catalogue" >&2; exit 1; }
case "$OUT" in *"no geocoded active listing exists yet"*) ;; *) echo "FAIL: wrong refusal: $OUT" >&2; exit 1 ;; esac
[ "$(psql "$URL" -At -c 'select count(*) from inventory_items;')" = "221" ] || { echo "FAIL: rows deleted on a refusal" >&2; exit 1; }
echo "  PASS: refused before the first successful sweep, nothing deleted"

echo "== 6. a successful sweep lands two Arlington rows; the refusals that remain =="
psql "$URL" -v ON_ERROR_STOP=1 -q -c "
  insert into inventory_items (id, lane, vin, year, make, model, price_cents, city, state, zip,
    latitude, longitude, mc_rooftop_id, external_dealer_state, is_active, last_seen_at, created_at, updated_at)
  values ('new_1','LANE_3','VINNEW00000000001',2023,'Toyota','Camry',2800000,'Arlington','TX','76011',
          32.7357,-97.1081,'mcr_1','TX',true, now(), now(), now()),
         ('new_2','LANE_3','VINNEW00000000002',2022,'Ford','F-150',3900000,'Fort Worth','TX','76102',
          32.7555,-97.3308,'mcr_2','TX',true, now(), now(), now());"
refuse "refuses without -v expected_deletes"        "missing -v expected_deletes"
refuse "refuses on a count that does not reconcile" "the catalogue moved"          -v expected_deletes=204

echo "== 7. refuses to HALF-apply: a row that fails a geography predicate but is unreferenced =="
# The purge is written for one defect. A row that shares the defect but escapes one predicate
# would survive the delete and leave the catalogue in exactly the half-correct state the purge
# exists to end. The script must roll back rather than partly apply.
psql "$URL" -v ON_ERROR_STOP=1 -q -c "
  insert into inventory_items (id, lane, vin, year, make, model, price_cents,
    mc_rooftop_id, external_dealer_state, is_active, created_at, updated_at)
  values ('odd_1','LANE_3','VINODD00000000001',2020,'Kia','Soul',1200000,
          'mcr_orphan','NY', true, timestamp '2026-09-01 09:00:00', timestamp '2026-09-03 04:00:00');"
# Read the numbers from the establish SCRIPT rather than restating its query here: a copy of
# the predicates in the harness would drift from the copy in the script, which is the exact
# failure this column exists to catch.
ESTAB4=$(psql "$URL" -X -A -F'|' -v ON_ERROR_STOP=1 --single-transaction \
  -c "SET TRANSACTION READ ONLY" -f "$HERE/catalogue-purge-establish.sql" \
  | grep -A1 '^deletable|' | tail -1 | cut -d'|' -f1,3)
[ "$ESTAB4" = "203|1" ] || { echo "FAIL: expected 'deletable|defective_not_selected' = 203|1, got '$ESTAB4'" >&2; exit 1; }
echo "  establish reports: deletable=203, defective_not_selected=1 (the two healthy new rows counted in neither)"
set +e
OUT=$(psql "$URL" -X -v ON_ERROR_STOP=1 -v expected_deletes=203 -f "$HERE/catalogue-purge-delete.sql" 2>&1); RC=$?
set -e
[ $RC -ne 0 ] || { echo "FAIL: it half-applied the purge" >&2; exit 1; }
case "$OUT" in *"ungeocoded, unreferenced listing(s) survived"*) ;; *) echo "FAIL: wrong refusal: $OUT" >&2; exit 1 ;; esac
[ "$(psql "$URL" -At -c 'select count(*) from inventory_items;')" = "224" ] || { echo "FAIL: rows deleted on a refusal" >&2; exit 1; }
echo "  PASS: rolled back with 0 rows deleted — the count assertion passed and the SURVIVOR assertion caught it"
psql "$URL" -v ON_ERROR_STOP=1 -q -c "delete from inventory_items where id = 'odd_1';"

echo "== 7b. refuses on HALF a coordinate pair — the gap the OR closes =="
# A row carrying a latitude and a NULL longitude is exactly as unplaceable as one carrying
# neither: `distanceMilesBetween` needs both. The first version of these scripts tested
# `latitude IS NULL` alone, so such a row was neither doomed by the six predicates (which
# require both NULL) nor caught by the survivor assertion — invisible to both, it would have
# survived the purge still showing the defect and nothing would have said so. This is that
# row, and the run must refuse.
psql "$URL" -v ON_ERROR_STOP=1 -q -c "
  insert into inventory_items (id, lane, vin, year, make, model, price_cents,
    latitude, external_dealer_state, is_active, created_at, updated_at)
  values ('half_1','LANE_3','VINHALF0000000001',2019,'Mazda','CX-5',1500000,
          32.7357,'TX', true, timestamp '2026-09-01 09:00:00', timestamp '2026-09-03 04:00:00');"
ESTAB4=$(psql "$URL" -X -A -F'|' -v ON_ERROR_STOP=1 --single-transaction \
  -c "SET TRANSACTION READ ONLY" -f "$HERE/catalogue-purge-establish.sql" \
  | grep -A1 '^deletable|' | tail -1 | cut -d'|' -f1,3)
[ "$ESTAB4" = "203|1" ] || { echo "FAIL: expected 'deletable|defective_not_selected' = 203|1, got '$ESTAB4' — the establish script does not see half a coordinate pair as the defect" >&2; exit 1; }
echo "  establish reports: deletable=203, defective_not_selected=1 (the half-geocoded row)"
set +e
OUT=$(psql "$URL" -X -v ON_ERROR_STOP=1 -v expected_deletes=203 -f "$HERE/catalogue-purge-delete.sql" 2>&1); RC=$?
set -e
[ $RC -ne 0 ] || { echo "FAIL: a half-geocoded row survived a purge that reported success" >&2; exit 1; }
case "$OUT" in *"ungeocoded, unreferenced listing(s) survived"*) ;; *) echo "FAIL: wrong refusal: $OUT" >&2; exit 1 ;; esac
[ "$(psql "$URL" -At -c 'select count(*) from inventory_items;')" = "224" ] || { echo "FAIL: rows deleted on a refusal" >&2; exit 1; }
echo "  PASS: rolled back with 0 rows deleted"
psql "$URL" -v ON_ERROR_STOP=1 -q -c "delete from inventory_items where id = 'half_1';"

echo "== 8. the real run =="
BEFORE=$(psql "$URL" -At -F'|' -c "select
  (select count(*) from inventory_items), (select count(*) from shortlist_items),
  (select count(*) from auction_vehicles), (select count(*) from vehicle_requests),
  (select count(*) from vehicle_match_scores), (select count(*) from inventory_price_alerts),
  (select count(*) from inventory_quality_scores), (select count(*) from vehicle_request_match_results);")
echo "  before: items|shortlist|candidates|requests|scores|alerts|quality|matches = $BEFORE"
psql "$URL" -X -v ON_ERROR_STOP=1 -v expected_deletes=203 -f "$HERE/catalogue-purge-delete.sql" > /tmp/p4-delete.out 2>&1 || {
  echo "FAIL: the purge did not run:" >&2; tail -30 /tmp/p4-delete.out >&2; exit 1; }
grep -E '^(NOTICE|psql:.*NOTICE)' /tmp/p4-delete.out | sed 's/^/  /'

echo "== 9. verify the outcome =="
AFTER=$(psql "$URL" -At -F'|' -c "select
  (select count(*) from inventory_items), (select count(*) from shortlist_items),
  (select count(*) from auction_vehicles), (select count(*) from vehicle_requests),
  (select count(*) from vehicle_match_scores), (select count(*) from inventory_price_alerts),
  (select count(*) from inventory_quality_scores), (select count(*) from vehicle_request_match_results);")
echo "  after:  items|shortlist|candidates|requests|scores|alerts|quality|matches = $AFTER"
# 223 - 203 = 20 items left: 15 shortlisted + 3 candidates + the 2 new Arlington rows.
# Soft references are cut selectively, never truncated — each of the four straddles the two
# populations: scores 30 -> 15 (old_001..015 are shortlisted and survive), alerts 10 -> 5,
# quality 40 -> 15, match results 13 -> 1 (the twelve pointed at doomed listings go; the row
# with a NULL inventory_item_id is untouched, because it references nothing).
EXPECT_AFTER="20|15|3|5|15|5|15|1"
[ "$AFTER" = "$EXPECT_AFTER" ] || { echo "FAIL: expected $EXPECT_AFTER, got $AFTER" >&2; exit 1; }

CHECKS=$(psql "$URL" -At -F'|' -c "select
  (select count(*) from inventory_items i
     where not exists (select 1 from shortlist_items s where s.inventory_item_id=i.id)
       and not exists (select 1 from auction_vehicles a where a.inventory_item_id=i.id)
       and (i.state is null or btrim(i.state)='')),
  (select count(*) from vehicle_requests where inventory_item_id is null),
  (select count(*) from vehicle_request_events where event_type='inventory_listing_purged'),
  (select count(*) from vehicle_match_scores v where not exists (select 1 from inventory_items i where i.id=v.inventory_item_id))
  + (select count(*) from inventory_price_alerts v where not exists (select 1 from inventory_items i where i.id=v.inventory_item_id))
  + (select count(*) from inventory_quality_scores v where not exists (select 1 from inventory_items i where i.id=v.inventory_item_id))
  + (select count(*) from vehicle_request_match_results v where v.inventory_item_id is not null
       and not exists (select 1 from inventory_items i where i.id=v.inventory_item_id)),
  (select count(*) from vehicle_requests where id='vr_keep' and inventory_item_id='old_001');")
echo "  ungeocoded_unreferenced_left|requests_nulled|purge_events|orphans|retained_request_link = $CHECKS"
[ "$CHECKS" = "0|4|4|0|1" ] || { echo "FAIL: expected '0|4|4|0|1', got $CHECKS" >&2; exit 1; }
echo "  PASS: 203 deleted; 15 shortlisted and 3 candidate listings retained; 4 requests cleared and evented;"
echo "        the request pointing at a RETAINED listing kept its link; 0 orphans; 0 buyer rows moved"

echo "== 10. re-running the same command is refused, not repeated =="
set +e
OUT=$(psql "$URL" -X -v ON_ERROR_STOP=1 -v expected_deletes=203 -f "$HERE/catalogue-purge-delete.sql" 2>&1); RC=$?
set -e
[ $RC -ne 0 ] || { echo "FAIL: a second run succeeded" >&2; exit 1; }
case "$OUT" in *"selected 0 rows, expected 203"*) ;; *) echo "FAIL: wrong refusal on re-run: $OUT" >&2; exit 1 ;; esac
echo "  PASS: second run selects 0 and refuses — not idempotent-by-silence, refused by assertion"
echo "== 11. the sweep-failure diagnostic parses and runs read-only on the same schema =="
psql "$URL" -X -v ON_ERROR_STOP=1 --single-transaction \
  -c "SET TRANSACTION READ ONLY" -f "$HERE/sweep-failure-diagnostic.sql" > /tmp/p4-diagnostic.out 2>&1 || {
  echo "FAIL: the diagnostic did not run:" >&2; tail -20 /tmp/p4-diagnostic.out >&2; exit 1; }
SECTIONS=$(grep -c '^=== ' /tmp/p4-diagnostic.out || true)
[ "$SECTIONS" = "7" ] || { echo "FAIL: expected 7 diagnostic sections, got $SECTIONS" >&2; exit 1; }
echo "  PASS: all 7 sections executed inside a read-only transaction"

echo
echo "REHEARSAL PASSED (PostgreSQL $(psql "$ADMIN" -At -c "select current_setting('server_version')"))"
echo "Both scripts run on production's restored physical schema. The establish script runs inside a"
echo "server-enforced read-only transaction. The delete script refuses four ways, deletes exactly the"
echo "203 unreferenced ungeocoded listings, retains every buyer-owned reference, cleans the four soft"
echo "references the database does not police, and leaves no orphan."
