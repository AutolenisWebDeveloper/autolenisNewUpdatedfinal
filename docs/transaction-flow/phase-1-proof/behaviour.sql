-- Phase 1 BEHAVIOURAL proof — what the wave's enforcement objects DO, not merely that they exist.
--
-- WHY THIS FILE EXISTS. `verify.sql` asserts objects into existence and cannot see behaviour. Two
-- defects in an earlier draft of this wave passed all 371 of its assertions and were found only by
-- executing a DELETE: a bare `ON DELETE SET NULL` on a COMPOSITE key nulled the parent's PRIMARY KEY
-- (23502 on every snapshot deletion), and an unconditional append-only trigger caught the referential
-- SET NULL that a parent's deletion issues, making every `vehicle_request` and `deal` holding a
-- snapshot permanently undeletable — which breaks the live buyer account-deletion route
-- (`frontend/app/api/buyer/account/route.ts:63`). Existence checks are structurally blind to both.
--
-- CONTRACT, the same shape as `verify.sql`:
--     PASS  <=>  no row has status = 'FAILED'
-- Exactly one row has status 'CHECKED' and reports how many behaviours ran. A silent zero-row result
-- is NOT a pass — it means the block did not run.
--
-- NOT read-only: it writes a synthetic fixture. Every write is undone — each probe rolls itself back
-- through a plpgsql sub-block, and the caller wraps the whole file in a transaction it ROLLBACKs.
-- Results survive that rollback because they accumulate in a variable, not a table.
-- Run ONLY against the disposable proof database. Never against production.
CREATE TEMP TABLE behaviour_result(status text, kind text, detail text) ON COMMIT DROP;

DO $probe$
DECLARE
  res text[] := '{}';
  r   text;
BEGIN
  -- ── fixture ──────────────────────────────────────────────────────────────────────────────────
  INSERT INTO users (id,supabase_id,email,role,updated_at)
    VALUES ('__p_u1','__p_sb1','__p_a@proof.invalid','BUYER',now()),
           ('__p_u2','__p_sb2','__p_d@proof.invalid','DEALER',now());
  INSERT INTO buyers  (id,user_id,first_name,last_name,updated_at) VALUES ('__p_b1','__p_u1','P','B',now());
  INSERT INTO dealers (id,user_id,dealership_name,updated_at)      VALUES ('__p_dl1','__p_u2','P',now());
  INSERT INTO vehicle_requests (id,buyer_id,updated_at)            VALUES ('__p_vr1','__p_b1',now());
  INSERT INTO deposits (id,buyer_id,amount_cents,updated_at)       VALUES ('__p_dep1','__p_b1',9900,now());
  INSERT INTO auctions (id,buyer_id,deposit_id,updated_at)         VALUES ('__p_a1','__p_b1','__p_dep1',now());
  INSERT INTO offers (id,auction_id,dealer_id,otd_price_cents,vehicle_price_cents,updated_at)
    VALUES ('__p_o1','__p_a1','__p_dl1',1,1,now());
  INSERT INTO deals (id,buyer_id,updated_at,offer_id)              VALUES ('__p_d1','__p_b1',now(),'__p_o1');
  INSERT INTO plan_snapshots (id,buyer_id,plan,vehicle_request_id) VALUES ('__p_ps1','__p_b1','STANDARD','__p_vr1');
  INSERT INTO plan_snapshots (id,buyer_id,plan,deal_id)            VALUES ('__p_ps2','__p_b1','STANDARD','__p_d1');
  UPDATE vehicle_requests SET current_plan_snapshot_id='__p_ps1' WHERE id='__p_vr1';
  UPDATE deals            SET current_plan_snapshot_id='__p_ps2' WHERE id='__p_d1';

  -- ── 1. deleting a GOVERNING snapshot must leave the parent alive, pointer nulled, PK intact ───
  BEGIN
    DELETE FROM plan_snapshots WHERE id='__p_ps1';
    IF EXISTS (SELECT 1 FROM vehicle_requests WHERE id='__p_vr1' AND current_plan_snapshot_id IS NULL)
      THEN res := res || ('OK|delete_governing_snapshot_vehicle_request|parent kept, pointer nulled'::text);
      ELSE res := res || ('FAILED|delete_governing_snapshot_vehicle_request|parent row lost or pointer not nulled'::text);
    END IF;
    RAISE EXCEPTION 'undo' USING ERRCODE='P0002';
  EXCEPTION WHEN SQLSTATE 'P0002' THEN NULL;
            WHEN OTHERS THEN res := res || ('FAILED|delete_governing_snapshot_vehicle_request|'||SQLSTATE||' '||SQLERRM);
  END;

  BEGIN
    DELETE FROM plan_snapshots WHERE id='__p_ps2';
    IF EXISTS (SELECT 1 FROM deals WHERE id='__p_d1' AND current_plan_snapshot_id IS NULL)
      THEN res := res || ('OK|delete_governing_snapshot_deal|parent kept, pointer nulled'::text);
      ELSE res := res || ('FAILED|delete_governing_snapshot_deal|parent row lost or pointer not nulled'::text);
    END IF;
    RAISE EXCEPTION 'undo' USING ERRCODE='P0002';
  EXCEPTION WHEN SQLSTATE 'P0002' THEN NULL;
            WHEN OTHERS THEN res := res || ('FAILED|delete_governing_snapshot_deal|'||SQLSTATE||' '||SQLERRM);
  END;

  -- ── 2. the buyer account-deletion path: deleting a request that holds a snapshot ──────────────
  BEGIN
    DELETE FROM vehicle_requests WHERE id='__p_vr1';
    IF NOT EXISTS (SELECT 1 FROM vehicle_requests WHERE id='__p_vr1')
       AND EXISTS (SELECT 1 FROM plan_snapshots WHERE id='__p_ps1' AND vehicle_request_id IS NULL)
      THEN res := res || ('OK|delete_vehicle_request_holding_snapshot|deleted, snapshot kept with lineage nulled'::text);
      ELSE res := res || ('FAILED|delete_vehicle_request_holding_snapshot|request survived or snapshot lineage not nulled'::text);
    END IF;
    RAISE EXCEPTION 'undo' USING ERRCODE='P0002';
  EXCEPTION WHEN SQLSTATE 'P0002' THEN NULL;
            WHEN OTHERS THEN res := res || ('FAILED|delete_vehicle_request_holding_snapshot|'||SQLSTATE||' '||SQLERRM);
  END;

  BEGIN
    DELETE FROM deals WHERE id='__p_d1';
    IF NOT EXISTS (SELECT 1 FROM deals WHERE id='__p_d1')
      THEN res := res || ('OK|delete_deal_holding_snapshot|deleted'::text);
      ELSE res := res || ('FAILED|delete_deal_holding_snapshot|deal survived'::text);
    END IF;
    RAISE EXCEPTION 'undo' USING ERRCODE='P0002';
  EXCEPTION WHEN SQLSTATE 'P0002' THEN NULL;
            WHEN OTHERS THEN res := res || ('FAILED|delete_deal_holding_snapshot|'||SQLSTATE||' '||SQLERRM);
  END;

  -- ── 3. append-only is still append-only. The narrowing must not have opened the table. ────────
  BEGIN
    UPDATE plan_snapshots SET plan='PREMIUM' WHERE id='__p_ps1';
    res := res || ('FAILED|append_only_blocks_content_edit|edit was ACCEPTED'::text);
    RAISE EXCEPTION 'undo' USING ERRCODE='P0002';
  EXCEPTION WHEN SQLSTATE 'P0002' THEN NULL;
            WHEN SQLSTATE 'P0001' THEN res := res || ('OK|append_only_blocks_content_edit|refused P0001'::text);
            WHEN OTHERS THEN res := res || ('FAILED|append_only_blocks_content_edit|unexpected '||SQLSTATE||' '||SQLERRM);
  END;

  BEGIN
    UPDATE plan_snapshots SET deal_id='__p_d1' WHERE id='__p_ps1';
    res := res || ('FAILED|append_only_blocks_lineage_attach|NULL -> value was ACCEPTED'::text);
    RAISE EXCEPTION 'undo' USING ERRCODE='P0002';
  EXCEPTION WHEN SQLSTATE 'P0002' THEN NULL;
            WHEN SQLSTATE 'P0001' THEN res := res || ('OK|append_only_blocks_lineage_attach|refused P0001'::text);
            WHEN OTHERS THEN res := res || ('FAILED|append_only_blocks_lineage_attach|unexpected '||SQLSTATE||' '||SQLERRM);
  END;

  BEGIN
    UPDATE plan_snapshots SET vehicle_request_id=NULL, plan='PREMIUM' WHERE id='__p_ps1';
    res := res || ('FAILED|append_only_blocks_edit_smuggled_with_lineage_null|edit was ACCEPTED'::text);
    RAISE EXCEPTION 'undo' USING ERRCODE='P0002';
  EXCEPTION WHEN SQLSTATE 'P0002' THEN NULL;
            WHEN SQLSTATE 'P0001' THEN res := res || ('OK|append_only_blocks_edit_smuggled_with_lineage_null|refused P0001'::text);
            WHEN OTHERS THEN res := res || ('FAILED|append_only_blocks_edit_smuggled_with_lineage_null|unexpected '||SQLSTATE||' '||SQLERRM);
  END;

  -- ── 4. R30: a Deal with no offer lineage at all must be refused ───────────────────────────────
  BEGIN
    INSERT INTO deals (id,buyer_id,updated_at) VALUES ('__p_d2','__p_b1',now());
    res := res || ('FAILED|deals_offer_lineage_check|deal with no lineage was ACCEPTED'::text);
    RAISE EXCEPTION 'undo' USING ERRCODE='P0002';
  EXCEPTION WHEN SQLSTATE 'P0002' THEN NULL;
            WHEN check_violation THEN res := res || ('OK|deals_offer_lineage_check|refused 23514'::text);
            WHEN OTHERS THEN res := res || ('FAILED|deals_offer_lineage_check|unexpected '||SQLSTATE||' '||SQLERRM);
  END;

  -- ── 5. R43a: a listing on someone's shortlist may not be deleted out from under it ────────────
  BEGIN
    INSERT INTO inventory_items (id,year,make,model,price_cents,updated_at)
      VALUES ('__p_inv1',2020,'P','P',100,now());
    INSERT INTO shortlists (id,buyer_id,updated_at) VALUES ('__p_sl1','__p_b1',now());
    INSERT INTO shortlist_items (id,shortlist_id,inventory_item_id) VALUES ('__p_si1','__p_sl1','__p_inv1');
    DELETE FROM inventory_items WHERE id='__p_inv1';
    res := res || ('FAILED|shortlist_items_inventory_item_restrict|listing delete was ACCEPTED'::text);
    RAISE EXCEPTION 'undo' USING ERRCODE='P0002';
  EXCEPTION WHEN SQLSTATE 'P0002' THEN NULL;
            WHEN foreign_key_violation THEN res := res || ('OK|shortlist_items_inventory_item_restrict|refused 23503'::text);
            WHEN OTHERS THEN res := res || ('FAILED|shortlist_items_inventory_item_restrict|unexpected '||SQLSTATE||' '||SQLERRM);
  END;

  -- ── 6. enforcement object 2 — the sixth candidate ─────────────────────────────────────────────
  BEGIN
    INSERT INTO auction_vehicles (id,auction_id,vehicle_request_id)
      SELECT '__p_av'||g,'__p_a1','__p_vr1' FROM generate_series(1,5) g;
    INSERT INTO auction_vehicles (id,auction_id,vehicle_request_id) VALUES ('__p_av6','__p_a1','__p_vr1');
    res := res || ('FAILED|auction_vehicles_five_candidate_cap|sixth candidate was ACCEPTED'::text);
    RAISE EXCEPTION 'undo' USING ERRCODE='P0002';
  EXCEPTION WHEN SQLSTATE 'P0002' THEN NULL;
            WHEN SQLSTATE 'P0001' THEN res := res || ('OK|auction_vehicles_five_candidate_cap|sixth refused P0001'::text);
            WHEN OTHERS THEN res := res || ('FAILED|auction_vehicles_five_candidate_cap|unexpected '||SQLSTATE||' '||SQLERRM);
  END;

  -- ── 7. enforcement object 1 — a second OPEN request for the same buyer ────────────────────────
  BEGIN
    INSERT INTO vehicle_requests (id,buyer_id,updated_at) VALUES ('__p_vr2','__p_b1',now());
    res := res || ('FAILED|vehicle_requests_one_open_per_buyer|second open request was ACCEPTED'::text);
    RAISE EXCEPTION 'undo' USING ERRCODE='P0002';
  EXCEPTION WHEN SQLSTATE 'P0002' THEN NULL;
            WHEN unique_violation THEN res := res || ('OK|vehicle_requests_one_open_per_buyer|refused 23505'::text);
            WHEN OTHERS THEN res := res || ('FAILED|vehicle_requests_one_open_per_buyer|unexpected '||SQLSTATE||' '||SQLERRM);
  END;

  FOREACH r IN ARRAY res LOOP
    INSERT INTO behaviour_result
      VALUES (split_part(r,'|',1), split_part(r,'|',2), split_part(r,'|',3));
  END LOOP;
END
$probe$;

SELECT status, kind, detail FROM behaviour_result WHERE status = 'FAILED'
UNION ALL
SELECT 'CHECKED', 'behaviours_exercised', count(*)::text FROM behaviour_result
ORDER BY 1 DESC, 2;
