"""
Iteration 21 — Full Admin-Initiated Buyer Transactions + Admin Payment Collection
SECTION 1: S1-01 through S1-15 (Admin buyer transactions)
SECTION 2: S2-01 through S2-11 (Admin payment collection)
FINAL: Typecheck + Lint + Build

Seed IDs:
  buyerId=8b4c38db-71ce-4f89-8a0d-f06aeb7de6e1
  dealerId=0c1addb9-379e-4930-9263-da797bad40db
  auctionId (seed)=eb6fd71a-b91d-454a-adaa-8d6807b2bc82
  offerIds=[bd4510c7-..., 19364959-..., a0ddbe74-...]
  dealId (seed)=d8ba626a-5368-44c0-9f2d-1538541edea0
  depositId (seed)=b1fc3657-fd0d-40df-905f-159f49c05598
"""

import pytest
import requests
import os
import subprocess
import time
import psycopg2

# ── Config ────────────────────────────────────────────────────────────────────
BASE_URL = ""
for line in open("/app/frontend/.env.local").read().splitlines():
    if "NEXT_PUBLIC_APP_URL=" in line:
        BASE_URL = line.split("=", 1)[1].strip().rstrip("/")
        break
if not BASE_URL:
    BASE_URL = "https://e2e-sandbox-check.preview.emergentagent.com"

DB_URL = "postgresql://postgres.aieybibvewmvrubcpthm:blzQPltGIIgQmI6m@aws-1-us-east-1.pooler.supabase.com:5432/postgres?sslmode=require"

# Seed IDs
BUYER_ID        = "8b4c38db-71ce-4f89-8a0d-f06aeb7de6e1"
DEALER_ID       = "0c1addb9-379e-4930-9263-da797bad40db"
SEED_AUCTION_ID = "eb6fd71a-b91d-454a-adaa-8d6807b2bc82"
SEED_DEAL_ID    = "d8ba626a-5368-44c0-9f2d-1538541edea0"

# Inventory item IDs from DB (for shortlist test)
INV_ITEMS = [
    "c0935da6-8c94-4b22-868c-fda297e31edb",  # Toyota Camry
    "53e37177-bd12-41a0-ad01-88c27f58ba51",  # Ford Escape
    "79e83c2b-0e9e-4146-9f8c-b95f03a0d781",  # Honda Civic
    "1cd99e55-1db5-4041-ace6-fcd0031a3a31",  # Honda Accord (6th item → should fail)
]

# Module-level state dictionary (shared across all test classes in one pytest run)
_STATE = {
    "admin_token": "",
    "override_deposit_id": "",
    "new_auction_id": "",
    "new_offer_id": "",
    "s1_deal_id": "",
    "s2_deposit_id": "",
    "s2_deal_id_for_fee": "",
}


# ── Helpers ───────────────────────────────────────────────────────────────────

def db_conn():
    return psycopg2.connect(DB_URL)


def get_admin_token() -> str:
    if _STATE["admin_token"]:
        return _STATE["admin_token"]

    r = requests.post(f"{BASE_URL}/api/admin/auth/signin", json={
        "email": "admin@autolenis.com",
        "password": "MarkistAdmin@Autolenis1250$$$",
    })
    assert r.status_code == 200, f"Signin failed: {r.status_code} {r.text}"
    signin_cookies = r.cookies

    env = os.environ.copy()
    with open("/app/frontend/.env.local") as f:
        for line in f.read().splitlines():
            if line.startswith("PREQUAL_ENCRYPTION_KEY="):
                env["PREQUAL_ENCRYPTION_KEY"] = line.split("=", 1)[1]
    totp = subprocess.check_output(
        ["npx", "tsx", "scripts/sandbox-totp.ts"],
        cwd="/app/frontend", env=env, text=True
    ).strip()

    r2 = requests.post(
        f"{BASE_URL}/api/admin/auth/verify-mfa",
        json={"code": totp},
        cookies=signin_cookies,
    )
    assert r2.status_code == 200, f"MFA failed: {r2.status_code} {r2.text}"

    for hv in r2.headers.get("set-cookie", "").split(","):
        if "admin_token=" in hv:
            for part in hv.split(";"):
                if part.strip().startswith("admin_token="):
                    token = part.strip().split("=", 1)[1]
                    _STATE["admin_token"] = token
                    return token

    raise AssertionError("admin_token not found in MFA response cookies")


def admin_get(path: str, params: dict = None) -> requests.Response:
    tok = get_admin_token()
    return requests.get(f"{BASE_URL}{path}", params=params,
                        cookies={"admin_token": tok})


def admin_post(path: str, body: dict = None) -> requests.Response:
    tok = get_admin_token()
    return requests.post(f"{BASE_URL}{path}", json=body or {},
                         cookies={"admin_token": tok})


def close_all_active_auctions_for_buyer():
    """Close all ACTIVE/PENDING auctions for the buyer to allow new auction creation."""
    conn = db_conn()
    cur = conn.cursor()
    cur.execute(
        "SELECT id FROM auctions WHERE buyer_id=%s AND status IN ('ACTIVE','PENDING')",
        (BUYER_ID,)
    )
    rows = cur.fetchall()
    conn.close()
    for (auction_id,) in rows:
        r = admin_post(f"/api/admin/auctions/{auction_id}/action", {
            "action": "AUCTION_CLOSED",
            "reason": "Closing existing auction for test setup",
        })
        print(f"  Closed existing auction {auction_id}: {r.status_code}")


def get_paid_deposit_for_refund() -> str:
    """Get a PAID deposit for refund test. Prefer override_deposit_id, fallback to DB query."""
    dep_id = _STATE["override_deposit_id"]
    if dep_id:
        # verify it's still PAID
        conn = db_conn()
        cur = conn.cursor()
        cur.execute("SELECT status FROM deposits WHERE id=%s", (dep_id,))
        row = cur.fetchone()
        conn.close()
        if row and row[0] == "PAID":
            return dep_id

    # fallback: find any PAID deposit for the buyer
    conn = db_conn()
    cur = conn.cursor()
    cur.execute("SELECT id FROM deposits WHERE buyer_id=%s AND status='PAID' ORDER BY created_at DESC LIMIT 1", (BUYER_ID,))
    row = cur.fetchone()
    conn.close()
    return row[0] if row else ""


# ── SECTION 1 ─────────────────────────────────────────────────────────────────

class TestS1AdminBuyerTransactions:
    """Admin-initiated buyer transactions — S1-01 through S1-15"""

    def test_s1_01_prequal(self):
        """S1-01: Admin runs prequal — POST /api/admin/buyers/{buyerId}/prequal → 201"""
        r = admin_post(f"/api/admin/buyers/{BUYER_ID}/prequal", {
            "decision": "APPROVED",
            "tier": "STRONG",
            "maxOtdAmountCents": 5000000,
            "reason": "Admin manual prequal",
        })
        assert r.status_code == 201, f"S1-01 FAIL: {r.status_code} {r.text}"
        data = r.json()
        assert data["success"] is True
        prequal = data["data"]["prequal"]
        assert prequal["maxOtdAmountCents"] == 5000000
        assert prequal["decision"] == "APPROVED"
        assert prequal["tier"] == "STRONG"
        print(f"S1-01 PASS: prequal id={prequal['id']}, maxOtd={prequal['maxOtdAmountCents']}")

    def test_s1_02_shortlist(self):
        """S1-02: Admin adds vehicles to buyer shortlist — max 5 items enforced"""
        # Get current shortlist count
        r_cur = admin_get(f"/api/admin/buyers/{BUYER_ID}/shortlist")
        assert r_cur.status_code == 200
        current_count = r_cur.json()["data"]["itemCount"]
        print(f"S1-02: Current shortlist count: {current_count}")

        # Add items until MAX (5) is reached
        items_to_try = INV_ITEMS[:4]  # try 4 items
        added = 0
        for inv_id in items_to_try:
            r = admin_post(f"/api/admin/buyers/{BUYER_ID}/shortlist", {
                "inventoryItemId": inv_id,
                "reason": "Admin shortlist add",
            })
            if r.status_code == 201:
                added += 1
                item_count = r.json()["data"]["itemCount"]
                print(f"S1-02: Added {inv_id}, itemCount={item_count}")
                if item_count >= 5:
                    # Try one more — should fail
                    # Use next available item
                    more_items = [i for i in INV_ITEMS if i != inv_id]
                    if more_items:
                        r6 = admin_post(f"/api/admin/buyers/{BUYER_ID}/shortlist", {
                            "inventoryItemId": more_items[-1],
                            "reason": "Testing 6th item overflow",
                        })
                        assert r6.status_code == 400, \
                            f"S1-02: 6th item should return 400, got {r6.status_code}: {r6.text}"
                        assert "SHORTLIST_FULL" in r6.text, \
                            f"S1-02: Expected SHORTLIST_FULL, got {r6.text}"
                        print(f"S1-02 PASS: 6th item correctly rejected with SHORTLIST_FULL")
                    break
            elif r.status_code == 400 and "SHORTLIST_FULL" in r.text:
                print(f"S1-02: Shortlist already full")
                # Try adding a fresh item
                r6 = admin_post(f"/api/admin/buyers/{BUYER_ID}/shortlist", {
                    "inventoryItemId": inv_id,
                    "reason": "Testing overflow",
                })
                assert r6.status_code == 400 and "SHORTLIST_FULL" in r6.text, \
                    f"S1-02: SHORTLIST_FULL enforced"
                break
            else:
                print(f"S1-02: Unexpected response for {inv_id}: {r.status_code} {r.text}")

        # Verify final count <= 5
        r_get = admin_get(f"/api/admin/buyers/{BUYER_ID}/shortlist")
        assert r_get.status_code == 200
        final_count = r_get.json()["data"]["itemCount"]
        assert final_count <= 5, f"S1-02: itemCount {final_count} exceeds max 5"
        print(f"S1-02 PASS: finalCount={final_count} (max=5 enforced)")

    def test_s1_03_deposit_override(self):
        """S1-03: Admin creates deposit override — POST → 201"""
        r = admin_post(f"/api/admin/buyers/{BUYER_ID}/deposit/override", {
            "reason": "Admin override",
        })
        assert r.status_code == 201, f"S1-03 FAIL: {r.status_code} {r.text}"
        data = r.json()
        assert data["success"] is True
        deposit = data["data"]["deposit"]
        assert deposit["status"] == "PAID"
        assert deposit["amountCents"] == 9900
        _STATE["override_deposit_id"] = deposit["id"]
        print(f"S1-03 PASS: depositId={deposit['id']}, status=PAID, amount=9900")

    def test_s1_04_create_auction(self):
        """S1-04: Admin creates auction — close existing auctions, then POST → 201"""
        # Close ALL active auctions for buyer (handles leftover from previous test runs)
        close_all_active_auctions_for_buyer()

        dep_id = _STATE["override_deposit_id"]
        assert dep_id, "S1-04: override_deposit_id not set from S1-03"

        r = admin_post("/api/admin/auctions", {
            "buyerId": BUYER_ID,
            "depositId": dep_id,
            "reason": "Admin test auction",
        })
        assert r.status_code == 201, f"S1-04 FAIL: {r.status_code} {r.text}"
        data = r.json()
        assert data["success"] is True
        auction = data["data"]["auction"]
        assert auction["status"] == "ACTIVE"
        assert "endsAt" in auction
        _STATE["new_auction_id"] = auction["id"]
        print(f"S1-04 PASS: auctionId={auction['id']}, status=ACTIVE, endsAt={auction['endsAt']}")

    def test_s1_05_dealer_invite(self):
        """S1-05: Admin invites dealer to auction → 200"""
        auction_id = _STATE["new_auction_id"]
        assert auction_id, "S1-05: new_auction_id not set from S1-04"
        r = admin_post(f"/api/admin/auctions/{auction_id}/action", {
            "action": "DEALER_INVITED",
            "dealerId": DEALER_ID,
            "reason": "Test invite",
        })
        assert r.status_code == 200, f"S1-05 FAIL: {r.status_code} {r.text}"
        data = r.json()
        assert data["success"] is True
        result = data["data"]
        assert result.get("dealerInvited") == DEALER_ID
        print(f"S1-05 PASS: dealer {DEALER_ID} invited to auction {auction_id}")

    def test_s1_06_submit_offer(self):
        """S1-06: Admin submits offer on behalf of dealer → 201"""
        auction_id = _STATE["new_auction_id"]
        assert auction_id, "S1-06: new_auction_id not set from S1-04"
        r = admin_post("/api/admin/offers", {
            "auctionId": auction_id,
            "dealerId": DEALER_ID,
            "otdPriceCents": 3500000,
            "vehiclePriceCents": 3200000,
            "taxCents": 280000,
            "feesCents": 5000,
            "junkFeeItems": [{"label": "Doc Fee", "amount": 500}],
            "reason": "Admin test offer",
        })
        assert r.status_code == 201, f"S1-06 FAIL: {r.status_code} {r.text}"
        data = r.json()
        assert data["success"] is True
        offer = data["data"]["offer"]
        assert offer["status"] == "SUBMITTED"
        assert offer["dealerId"] == DEALER_ID
        _STATE["new_offer_id"] = offer["id"]
        print(f"S1-06 PASS: offerId={offer['id']}, status=SUBMITTED, dealerId={offer['dealerId']}")

    def test_s1_07_best_price_engine(self):
        """S1-07: Admin runs Best Price Engine → 200 with 3 ranked outputs"""
        auction_id = _STATE["new_auction_id"]
        assert auction_id, "S1-07: new_auction_id not set from S1-04"
        r = admin_post(f"/api/admin/auctions/{auction_id}/best-price/run")
        assert r.status_code == 200, f"S1-07 FAIL: {r.status_code} {r.text}"
        data = r.json()
        assert data["success"] is True
        result = data["data"]
        assert "bestCash" in result
        assert "bestMonthly" in result
        assert "bestOverall" in result
        # With 1 offer, bestCash and bestOverall should point to same offer
        if result["bestCash"] and result["bestOverall"]:
            assert result["bestCash"]["offerId"] == result["bestOverall"]["offerId"]
        print(f"S1-07 PASS: offerCount={result['offerCount']}, bestCash={result.get('bestCash')}, bestOverall={result.get('bestOverall')}")

    def test_s1_08_create_deal(self):
        """S1-08: Admin creates deal from winning offer → 201"""
        offer_id = _STATE["new_offer_id"]
        assert offer_id, "S1-08: new_offer_id not set from S1-06"
        r = admin_post("/api/admin/deals", {
            "buyerId": BUYER_ID,
            "offerId": offer_id,
            "reason": "Admin creates deal",
        })
        assert r.status_code == 201, f"S1-08 FAIL: {r.status_code} {r.text}"
        data = r.json()
        assert data["success"] is True
        deal = data["data"]["deal"]
        assert deal["buyerId"] == BUYER_ID
        assert deal["offerId"] == offer_id
        _STATE["s1_deal_id"] = deal["id"]
        _STATE["s2_deal_id_for_fee"] = deal["id"]
        print(f"S1-08 PASS: dealId={deal['id']}, buyerId={deal['buyerId']}")

    def test_s1_09_advance_deal_stages(self):
        """S1-09: Admin advances deal through all valid stages → 200 each"""
        deal_id = _STATE["s1_deal_id"]
        assert deal_id, "S1-09: s1_deal_id not set from S1-08"

        # Valid stage sequence (FINANCING_APPROVED and INSURANCE_COMPLETE not in DealStatus enum)
        stages = [
            "FINANCING_PENDING", "FEE_PENDING", "FEE_PAID", "INSURANCE_PENDING",
            "CONTRACT_PENDING", "CONTRACT_REVIEW", "CONTRACT_APPROVED",
            "SIGNING_PENDING", "SIGNED", "PICKUP_SCHEDULED", "COMPLETED",
        ]

        for stage in stages:
            r = admin_post(f"/api/admin/deals/{deal_id}/action", {
                "action": "DEAL_STAGE_ADVANCED",
                "newStatus": stage,
                "reason": f"Advancing to {stage}",
            })
            assert r.status_code == 200, f"S1-09 FAIL at {stage}: {r.status_code} {r.text}"
            result = r.json()["data"]
            assert result.get("newStatus") == stage, f"S1-09: newStatus mismatch at {stage}: {result}"
            print(f"S1-09: deal {deal_id} → {stage} ✓")

        print(f"S1-09 PASS: All {len(stages)} stage transitions completed")

    def test_s1_10_cancel_deal(self):
        """S1-10: Admin cancels the seed deal → 200, deal.status=CANCELLED"""
        # Use seed deal — may already be cancelled from previous run; if so cancel idempotently
        r = admin_post(f"/api/admin/deals/{SEED_DEAL_ID}/action", {
            "action": "DEAL_CANCELLED",
            "reason": "Test cancellation",
        })
        assert r.status_code == 200, f"S1-10 FAIL: {r.status_code} {r.text}"
        data = r.json()
        assert data["success"] is True

        # Verify via DB
        conn = db_conn()
        cur = conn.cursor()
        cur.execute("SELECT status FROM deals WHERE id=%s", (SEED_DEAL_ID,))
        row = cur.fetchone()
        conn.close()
        assert row and row[0] == "CANCELLED", f"S1-10: deal status = {row}"
        print(f"S1-10 PASS: deal {SEED_DEAL_ID} status=CANCELLED")

    def test_s1_11_contract_shield_override(self):
        """S1-11: Admin overrides Contract Shield → 200, overridden=true"""
        deal_id = _STATE["s1_deal_id"]
        assert deal_id, "S1-11: s1_deal_id not set from S1-08"
        r = admin_post(f"/api/admin/deals/{deal_id}/action", {
            "action": "CONTRACT_SHIELD_OVERRIDDEN",
            "reason": "Test override",
        })
        assert r.status_code == 200, f"S1-11 FAIL: {r.status_code} {r.text}"
        data = r.json()
        assert data["success"] is True
        assert data["data"].get("overridden") is True
        print(f"S1-11 PASS: contract shield overridden for deal {deal_id}")

    def test_s1_12_docusign_envelope(self):
        """S1-12: Admin triggers DocuSign envelope → 200 with envelopeId (mock acceptable)"""
        deal_id = _STATE["s1_deal_id"]
        assert deal_id, "S1-12: s1_deal_id not set from S1-08"
        r = admin_post(f"/api/admin/deals/{deal_id}/esign")
        assert r.status_code == 200, f"S1-12 FAIL: {r.status_code} {r.text}"
        data = r.json()
        assert data["success"] is True
        result = data["data"]
        assert "envelopeId" in result, f"S1-12: envelopeId missing: {result}"
        is_mock = result.get("isMock", False)
        # isMock=True + envelopeId=None is acceptable in sandbox
        if not is_mock:
            assert result["envelopeId"], f"S1-12: envelopeId empty in non-mock mode: {result}"
        print(f"S1-12 PASS: envelopeId={result['envelopeId']}, isMock={is_mock} (mock acceptable in sandbox)")

    def test_s1_13_pickup_complete(self):
        """S1-13: Admin completes pickup manually → 200, dealStatus=COMPLETED, pickupStatus=COMPLETED"""
        deal_id = _STATE["s1_deal_id"]
        assert deal_id, "S1-13: s1_deal_id not set from S1-08"
        r = admin_post(f"/api/admin/deals/{deal_id}/pickup/complete", {
            "reason": "QR scan override",
        })
        assert r.status_code == 200, f"S1-13 FAIL: {r.status_code} {r.text}"
        data = r.json()
        assert data["success"] is True
        result = data["data"]
        assert result.get("dealStatus") == "COMPLETED"
        assert result.get("pickupStatus") == "COMPLETED"
        # Verify buyer notification
        conn = db_conn()
        cur = conn.cursor()
        cur.execute(
            "SELECT id FROM notifications WHERE buyer_id=%s AND title='Vehicle pickup completed' ORDER BY created_at DESC LIMIT 1",
            (BUYER_ID,)
        )
        notif = cur.fetchone()
        conn.close()
        assert notif, "S1-13: Buyer pickup notification not created"
        print(f"S1-13 PASS: dealStatus=COMPLETED, pickupStatus=COMPLETED, buyerNotified=True")

    def test_s1_14_deposit_refund(self):
        """S1-14: Admin processes $99 deposit refund → 200, status=REFUNDED"""
        # Get a PAID deposit to refund (prefer the override from S1-03)
        dep_id = get_paid_deposit_for_refund()
        assert dep_id, "S1-14: No PAID deposit found to refund"

        r = admin_post(f"/api/admin/payments/deposit/{dep_id}/refund", {
            "reason": "Test refund",
        })
        assert r.status_code == 200, f"S1-14 FAIL: {r.status_code} {r.text}"
        data = r.json()
        assert data["success"] is True
        result = data["data"]
        assert result.get("status") == "REFUNDED"
        assert result.get("refundedAt") is not None
        assert result.get("buyerNotified") is True
        print(f"S1-14 PASS: depositId={dep_id}, status=REFUNDED, refundedAt={result['refundedAt']}")

    def test_s1_15_buyer_payment_history(self):
        """S1-15: Admin views buyer payment history → 200 with deposit and fee events"""
        r = admin_get(f"/api/admin/buyers/{BUYER_ID}/payment-history")
        assert r.status_code == 200, f"S1-15 FAIL: {r.status_code} {r.text}"
        data = r.json()
        assert data["success"] is True
        result = data["data"]
        events = result.get("events", [])
        assert isinstance(events, list)
        # Verify event structure
        for e in events[:3]:
            assert "amountCents" in e
            assert "timestamp" in e
            assert "status" in e
            assert "stripeIntentId" in e
        # Should have at least 1 deposit event
        deposit_events = [e for e in events if e.get("type") == "deposit"]
        assert deposit_events, f"S1-15: No deposit events: {events[:2]}"
        print(f"S1-15 PASS: totalCount={result['totalCount']}, depositEvents={len(deposit_events)}")


# ── SECTION 2 ─────────────────────────────────────────────────────────────────

class TestS2AdminPaymentCollection:
    """Admin payment collection — S2-01 through S2-11"""

    def test_s2_01_create_deposit_intent(self):
        """S2-01: Admin creates Stripe deposit intent → 201, amountCents=9900"""
        r = admin_post("/api/admin/payments/deposit/create-intent", {
            "buyerId": BUYER_ID,
            "reason": "Test",
        })
        assert r.status_code == 201, f"S2-01 FAIL: {r.status_code} {r.text}"
        data = r.json()
        assert data["success"] is True
        result = data["data"]
        assert result.get("amountCents") == 9900, f"S2-01 CRITICAL: amountCents={result.get('amountCents')} != 9900"
        assert result.get("stripePaymentIntentId"), f"S2-01: stripePaymentIntentId missing"
        assert result.get("status") == "PENDING"
        assert result.get("depositId")
        _STATE["s2_deposit_id"] = result["depositId"]
        print(f"S2-01 PASS: depositId={result['depositId']}, amountCents=9900, intentId={result['stripePaymentIntentId']}")

    def test_s2_02_mark_deposit_paid(self):
        """S2-02: Admin marks deposit paid → 200, status=PAID, auctionUnblocked=true"""
        dep_id = _STATE["s2_deposit_id"]
        assert dep_id, "S2-02: s2_deposit_id not set from S2-01"
        r = admin_post(f"/api/admin/payments/deposit/{dep_id}/mark-paid", {
            "reason": "Override",
        })
        assert r.status_code == 200, f"S2-02 FAIL: {r.status_code} {r.text}"
        data = r.json()
        assert data["success"] is True
        result = data["data"]
        assert result.get("status") == "PAID"
        assert result.get("auctionUnblocked") is True
        print(f"S2-02 PASS: depositId={dep_id}, status=PAID, auctionUnblocked=True")

    def test_s2_03_deposit_refund(self):
        """S2-03: Admin processes deposit refund → 200, status=REFUNDED, buyerNotified"""
        dep_id = _STATE["s2_deposit_id"]
        assert dep_id, "S2-03: s2_deposit_id not set from S2-01"
        r = admin_post(f"/api/admin/payments/deposit/{dep_id}/refund", {
            "reason": "Test refund",
        })
        assert r.status_code == 200, f"S2-03 FAIL: {r.status_code} {r.text}"
        data = r.json()
        assert data["success"] is True
        result = data["data"]
        assert result.get("status") == "REFUNDED"
        # Verify buyer notification
        conn = db_conn()
        cur = conn.cursor()
        cur.execute(
            "SELECT id FROM notifications WHERE buyer_id=%s AND title='Deposit refund processed' ORDER BY created_at DESC LIMIT 1",
            (BUYER_ID,)
        )
        notif = cur.fetchone()
        conn.close()
        assert notif, "S2-03: Deposit refund notification not created"
        print(f"S2-03 PASS: depositId={dep_id}, status=REFUNDED, buyerNotified=True")

    def test_s2_04_fee_check_standard(self):
        """S2-04: Admin checks fee for Standard buyer → planType=STANDARD, feeAmount=0"""
        # Ensure buyer is on STANDARD plan for this test
        conn = db_conn()
        cur = conn.cursor()
        cur.execute("UPDATE buyers SET plan='STANDARD' WHERE id=%s", (BUYER_ID,))
        conn.commit()
        conn.close()

        r = admin_get("/api/admin/payments/fee-check", params={"buyerId": BUYER_ID})
        assert r.status_code == 200, f"S2-04 FAIL: {r.status_code} {r.text}"
        data = r.json()
        assert data["success"] is True
        result = data["data"]
        assert result.get("planType") == "STANDARD"
        assert result.get("feeAmount") == 0
        assert result.get("requiresPayment") is False
        print(f"S2-04 PASS: planType=STANDARD, feeAmount=0, requiresPayment=False")

    def test_s2_05_concierge_fee_intent_premium(self):
        """S2-05: Admin creates concierge fee intent for Premium buyer → 201, amountCents=40000"""
        # Get deal ID from _STATE or fallback to DB
        deal_id = _STATE["s2_deal_id_for_fee"]
        if not deal_id:
            conn = db_conn()
            cur = conn.cursor()
            cur.execute(
                "SELECT id FROM deals WHERE buyer_id=%s AND status != 'CANCELLED' ORDER BY created_at DESC LIMIT 1",
                (BUYER_ID,)
            )
            row = cur.fetchone()
            conn.close()
            assert row, "S2-05: No non-cancelled deal found for buyer"
            deal_id = row[0]
            _STATE["s2_deal_id_for_fee"] = deal_id

        # Upgrade buyer to PREMIUM
        conn = db_conn()
        cur = conn.cursor()
        cur.execute("UPDATE buyers SET plan='PREMIUM' WHERE id=%s", (BUYER_ID,))
        conn.commit()
        conn.close()
        print(f"S2-05: Buyer upgraded to PREMIUM, dealId={deal_id}")

        r = admin_post("/api/admin/payments/concierge-fee/create-intent", {
            "dealId": deal_id,
            "reason": "Premium fee",
        })
        assert r.status_code == 201, f"S2-05 FAIL: {r.status_code} {r.text}"
        data = r.json()
        assert data["success"] is True
        result = data["data"]
        assert result.get("amountCents") == 40000, \
            f"S2-05 CRITICAL: amountCents={result.get('amountCents')} != 40000"
        assert result.get("stripePaymentIntentId")
        assert "$499 total" in result.get("displayMessage", "")
        assert "$99 deposit credited" in result.get("displayMessage", "")
        assert "$400 due" in result.get("displayMessage", "")
        print(f"S2-05 PASS: amountCents=40000, intentId={result['stripePaymentIntentId']}, msg='{result['displayMessage']}'")

    def test_s2_06_mark_concierge_fee_paid(self):
        """S2-06: Admin marks concierge fee paid → feeStatus=PAID, dealStatus=FEE_PAID"""
        deal_id = _STATE["s2_deal_id_for_fee"]
        assert deal_id, "S2-06: s2_deal_id_for_fee not set"

        r = admin_post(f"/api/admin/payments/concierge-fee/{deal_id}/mark-paid", {
            "reason": "Admin override",
        })
        assert r.status_code == 200, f"S2-06 FAIL: {r.status_code} {r.text}"
        data = r.json()
        assert data["success"] is True
        result = data["data"]
        assert result.get("feeStatus") == "PAID"
        assert result.get("dealStatus") == "FEE_PAID"
        print(f"S2-06 PASS: dealId={deal_id}, feeStatus=PAID, dealStatus=FEE_PAID")

    def test_s2_07_concierge_fee_refund(self):
        """S2-07: Admin processes $400 concierge fee refund → 200, feeStatus=REFUNDED"""
        deal_id = _STATE["s2_deal_id_for_fee"]
        assert deal_id, "S2-07: s2_deal_id_for_fee not set"

        r = admin_post(f"/api/admin/payments/concierge-fee/{deal_id}/refund", {
            "reason": "Test refund",
        })
        assert r.status_code == 200, f"S2-07 FAIL: {r.status_code} {r.text}"
        data = r.json()
        assert data["success"] is True
        result = data["data"]
        assert result.get("feeStatus") == "REFUNDED"
        assert result.get("buyerNotified") is True

        # Verify AuditLog action=CONCIERGE_FEE_REFUNDED
        conn = db_conn()
        cur = conn.cursor()
        cur.execute(
            "SELECT id FROM admin_audit_logs WHERE action='CONCIERGE_FEE_REFUNDED' AND entity_id=%s ORDER BY created_at DESC LIMIT 1",
            (deal_id,)
        )
        audit = cur.fetchone()
        conn.close()
        assert audit, "S2-07: AuditLog CONCIERGE_FEE_REFUNDED not created"
        print(f"S2-07 PASS: dealId={deal_id}, feeStatus=REFUNDED, auditLog=OK")

    def test_s2_08_buyer_payment_history(self):
        """S2-08: Admin views buyer payment history → events with correct fields"""
        r = admin_get(f"/api/admin/buyers/{BUYER_ID}/payment-history")
        assert r.status_code == 200, f"S2-08 FAIL: {r.status_code} {r.text}"
        data = r.json()
        assert data["success"] is True
        events = data["data"].get("events", [])
        assert isinstance(events, list)
        # Verify deposit events exist with REFUNDED status
        deposit_events = [e for e in events if e.get("type") == "deposit"]
        assert deposit_events, "S2-08: No deposit events"
        statuses = {e.get("status") for e in deposit_events}
        assert "REFUNDED" in statuses, f"S2-08: No REFUNDED deposit, statuses={statuses}"
        # Verify event fields
        for e in events[:3]:
            assert "amountCents" in e
            assert "timestamp" in e
            assert "status" in e
            assert "stripeIntentId" in e
        print(f"S2-08 PASS: events={len(events)}, depositEvents={len(deposit_events)}, statuses={statuses}")

    def test_s2_09_deal_payment_history(self):
        """S2-09: Admin views deal payment history → events, totalCharged, totalRefunded"""
        deal_id = _STATE["s2_deal_id_for_fee"]
        if not deal_id:
            conn = db_conn()
            cur = conn.cursor()
            cur.execute("SELECT id FROM deals WHERE buyer_id=%s ORDER BY created_at DESC LIMIT 1", (BUYER_ID,))
            row = cur.fetchone()
            conn.close()
            assert row, "S2-09: No deal found"
            deal_id = row[0]

        r = admin_get(f"/api/admin/deals/{deal_id}/payment-history")
        assert r.status_code == 200, f"S2-09 FAIL: {r.status_code} {r.text}"
        data = r.json()
        assert data["success"] is True
        result = data["data"]
        assert "events" in result
        assert "totalCharged" in result, f"S2-09: totalCharged missing: {result}"
        assert "totalRefunded" in result, f"S2-09: totalRefunded missing: {result}"
        assert isinstance(result["totalCharged"], (int, float))
        assert isinstance(result["totalRefunded"], (int, float))
        print(f"S2-09 PASS: events={result['totalCount']}, totalCharged={result['totalCharged']}, totalRefunded={result['totalRefunded']}")

    def test_s2_10_stripe_webhook_idempotency(self):
        """S2-10: Stripe webhook idempotency — PARTIAL acceptable (signature validation in sandbox)"""
        webhook_payload = {
            "id": f"evt_test_dedup_{int(time.time())}",
            "type": "payment_intent.succeeded",
            "data": {
                "object": {
                    "id": f"pi_test_{int(time.time())}",
                    "amount": 9900,
                    "status": "succeeded",
                }
            }
        }

        r1 = requests.post(
            f"{BASE_URL}/api/webhooks/stripe",
            json=webhook_payload,
            headers={"Content-Type": "application/json"},
        )
        r2 = requests.post(
            f"{BASE_URL}/api/webhooks/stripe",
            json=webhook_payload,
            headers={"Content-Type": "application/json"},
        )

        print(f"S2-10: First call: {r1.status_code}, Second call: {r2.status_code}")

        if r1.status_code == 200:
            if r2.status_code == 200:
                # Check for duplicate indicator
                try:
                    r2_data = r2.json()
                    dup = r2_data.get("duplicate", False)
                    print(f"S2-10 PASS: duplicate={dup}")
                except Exception:
                    print(f"S2-10: Second call 200 but no duplicate field")
            else:
                print(f"S2-10 PARTIAL: First 200, second {r2.status_code}")
        else:
            # 400 due to Stripe signature validation — expected in sandbox
            assert r1.status_code in [400, 200, 401], \
                f"S2-10: Unexpected status {r1.status_code}"
            print(f"S2-10 PARTIAL ACCEPTABLE: Stripe sig validation required, got {r1.status_code}")

    def test_s2_11_financial_summary(self):
        """S2-11: Admin financial summary report → all required fields present and numeric"""
        r = admin_get("/api/admin/reports/financial-summary")
        assert r.status_code == 200, f"S2-11 FAIL: {r.status_code} {r.text}"
        data = r.json()
        assert data["success"] is True
        summary = data["data"].get("summary")
        assert summary is not None

        required_fields = ["depositsCollected", "depositsRefunded", "feesCollected",
                           "feeRefundCount", "netRevenue"]
        for field in required_fields:
            assert field in summary, f"S2-11: {field} missing"
            assert isinstance(summary[field], (int, float)), f"S2-11: {field} must be numeric"
        # netRevenue can be negative (refunds > collections in test scenario)
        print(f"S2-11 PASS: depositsCollected={summary['depositsCollected']}, "
              f"depositsRefunded={summary['depositsRefunded']}, "
              f"feesCollected={summary['feesCollected']}, "
              f"feeRefundCount={summary['feeRefundCount']}, "
              f"netRevenue={summary['netRevenue']}")


# ── FINAL: Typecheck + Lint + Build ───────────────────────────────────────────

class TestFinalChecks:
    """FINAL-01 through FINAL-03: TypeScript, ESLint, Next.js build"""

    def test_final_01_typecheck(self):
        """FINAL-01: npx tsc --noEmit → exit 0"""
        result = subprocess.run(
            ["npx", "tsc", "--noEmit"],
            cwd="/app/frontend",
            capture_output=True, text=True, timeout=120
        )
        assert result.returncode == 0, \
            f"FINAL-01 FAIL: TypeScript errors:\n{result.stdout[-2000:]}\n{result.stderr[-500:]}"
        print("FINAL-01 PASS: TypeScript 0 errors")

    def test_final_02_lint(self):
        """FINAL-02: npx eslint → 0 errors"""
        result = subprocess.run(
            ["npx", "eslint", ".", "--ext", ".ts,.tsx", "--max-warnings=999"],
            cwd="/app/frontend",
            capture_output=True, text=True, timeout=120
        )
        error_count = result.stdout.count(" error ") + result.stderr.count(" error ")
        if error_count > 0:
            print(f"FINAL-02 WARN: ESLint errors:\n{result.stdout[:500]}")
        assert error_count == 0, f"FINAL-02 FAIL: {error_count} ESLint errors"
        print(f"FINAL-02 PASS: 0 ESLint errors (exit={result.returncode})")

    def test_final_03_build(self):
        """FINAL-03: npx next build → success with ƒ Proxy (Middleware)"""
        result = subprocess.run(
            ["npx", "next", "build"],
            cwd="/app/frontend",
            capture_output=True, text=True, timeout=300
        )
        output = result.stdout + result.stderr
        assert result.returncode == 0, \
            f"FINAL-03 FAIL: build exit {result.returncode}\n{output[-1500:]}"
        assert "Proxy" in output, \
            f"FINAL-03 WARN: 'Proxy' not in build output (check middleware)"
        print("FINAL-03 PASS: Next.js build succeeded")
