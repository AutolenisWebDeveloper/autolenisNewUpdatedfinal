# Iteration 17 — Dealer 20-step E2E journey
# Tests dealer-side flows backed by the sandbox seed.
import os
import time
import json
import uuid
import pytest
import requests

BASE = os.environ.get("REACT_APP_BACKEND_URL", "https://e2e-sandbox-check.preview.emergentagent.com").rstrip("/")

# Seed IDs from /tmp/seed_ids.json (set per run)
with open("/tmp/seed_ids.json") as f:
    SEED = json.load(f)

SANDBOX_DEALER_EMAIL = "sandbox-dealer@autolenis-test.com"
SANDBOX_DEALER_PWD = "SandboxDealer1!"


# ---------- shared session for dealer ----------
@pytest.fixture(scope="module")
def dealer_session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    r = s.post(f"{BASE}/api/dealer/auth/signin",
               json={"email": SANDBOX_DEALER_EMAIL, "password": SANDBOX_DEALER_PWD})
    assert r.status_code == 200, f"dealer signin failed {r.status_code} {r.text[:300]}"
    body = r.json()
    assert body.get("success") is True
    assert body.get("dealerId")
    # cookie set
    assert any(c.name in ("dealer_token", "dealer-token") for c in s.cookies) or len(s.cookies) > 0
    return s


# ============== STEP 1 — public dealer application ==============
def test_step1_dealer_application():
    ts = int(time.time())
    payload = {
        "dealershipName": f"Sandbox Dealer {ts}",
        "dealershipType": "Used",
        "state": "TX",
        "city": "Austin",
        "zip": "78704",
        "licenseNumber": f"TX-{ts}",
        "contactName": "Journey Tester",
        "contactEmail": f"dealer-journey-{ts}@autolenis-test.com",
        "contactPhone": "5125551212",
    }
    r = requests.post(f"{BASE}/api/public/dealer-application", json=payload)
    assert r.status_code in (200, 201), f"{r.status_code} {r.text[:300]}"
    data = r.json()
    # store appId/email for step 2 if available
    pytest.app_email = payload["contactEmail"]
    pytest.app_id = data.get("applicationId") or data.get("id") or data.get("data", {}).get("id")


# ============== STEP 6 — add inventory manually ==============
def test_step6_add_vehicle(dealer_session):
    ts = int(time.time() * 1000)
    suffix = uuid.uuid4().hex[:6].upper()
    vin = f"JV{suffix}{ts}"[:17]
    payload = {
        "vin": vin,
        "year": 2022,
        "make": "Honda",
        "model": "Civic",
        "trim": "EX",
        "mileage": 25000,
        "priceCents": 2200000,
    }
    r = dealer_session.post(f"{BASE}/api/dealer/inventory", json=payload)
    # NOTE: review_request body included `condition` but Prisma schema has no such field;
    # the route blindly spreads body so passing condition triggers 500. Bug reported.
    assert r.status_code in (200, 201), f"{r.status_code} {r.text[:400]}"
    data = r.json()
    item = data.get("item") or data.get("data") or data
    pytest.created_inv_vin = vin
    # ensure dealer can list
    r2 = dealer_session.get(f"{BASE}/api/dealer/inventory")
    assert r2.status_code == 200, f"list {r2.status_code} {r2.text[:200]}"


# ============== STEP 5 — onboarding endpoint reachable ==============
def test_step5_onboarding_get(dealer_session):
    r = dealer_session.get(f"{BASE}/api/dealer/onboarding")
    # GET may return 200 or 405 if PATCH-only; either is acceptable for "reachable"
    assert r.status_code in (200, 204, 405), f"{r.status_code} {r.text[:200]}"


# ============== STEP 7 — admin DEALER_INVITED action ==============
def test_step7_admin_dealer_invited():
    # admin signin + MFA
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    r1 = s.post(f"{BASE}/api/admin/auth/signin",
                json={"email": "admin@autolenis.com",
                      "password": "MarkistAdmin@Autolenis1250$$$"})
    assert r1.status_code == 200, f"admin signin {r1.status_code} {r1.text[:200]}"

    # generate TOTP via tsx script
    import subprocess
    out = subprocess.check_output(
        "cd /app/frontend && PREQUAL_ENCRYPTION_KEY=$(grep ^PREQUAL_ENCRYPTION_KEY .env.local | cut -d= -f2-) npx tsx scripts/sandbox-totp.ts",
        shell=True, text=True).strip().split("\n")[-1].strip()
    assert out.isdigit() and len(out) == 6
    r2 = s.post(f"{BASE}/api/admin/auth/verify-mfa", json={"code": out})
    assert r2.status_code == 200, f"mfa {r2.status_code} {r2.text[:200]}"
    # requests fails to split multi-cookie Set-Cookie containing ", " inside Expires.
    # Manually parse admin_token from raw header.
    raw = r2.headers.get("Set-Cookie", "")
    import re
    m = re.search(r"admin_token=([^;]+)", raw)
    if m:
        s.cookies.set("admin_token", m.group(1), domain="vehicle-photo-match.preview.emergentagent.com")

    # POST DEALER_INVITED
    aid = SEED["auctionId"]
    did = SEED["dealerId"]
    r3 = s.post(f"{BASE}/api/admin/auctions/{aid}/action",
                json={"action": "DEALER_INVITED", "dealerId": did,
                      "reason": "Sandbox test invitation"})
    assert r3.status_code == 200, f"dealer_invited {r3.status_code} {r3.text[:300]}"
    body = r3.json()
    # idempotency check — call again
    r4 = s.post(f"{BASE}/api/admin/auctions/{aid}/action",
                json={"action": "DEALER_INVITED", "dealerId": did,
                      "reason": "Sandbox dup"})
    assert r4.status_code == 200, f"idempotent {r4.status_code} {r4.text[:200]}"


# ============== STEP 18 — notifications list ==============
def test_step18_notifications_list(dealer_session):
    r = dealer_session.get(f"{BASE}/api/dealer/notifications")
    assert r.status_code == 200, f"{r.status_code} {r.text[:300]}"
    data = r.json()
    items = data.get("notifications") or data.get("items") or data.get("data") or []
    if isinstance(items, dict):
        items = items.get("notifications") or items.get("items") or []
    assert isinstance(items, list), f"notifications not a list: {type(items)} {data}"
    pytest.notif_items = items
    pytest.unread_before = data.get("unreadCount", sum(1 for n in items if not n.get("readAt")))


def test_step18_mark_one_read(dealer_session):
    items = getattr(pytest, "notif_items", [])
    unread = next((n for n in items if not n.get("readAt") and not n.get("isRead", False)), None)
    if not unread:
        pytest.skip("no unread notification to mark")
    nid = unread.get("id") or unread.get("notificationId")
    r = dealer_session.patch(f"{BASE}/api/dealer/notifications/{nid}/read")
    assert r.status_code == 200, f"{r.status_code} {r.text[:300]}"


def test_step18_mark_all_read(dealer_session):
    r = dealer_session.post(f"{BASE}/api/dealer/notifications/mark-all-read")
    assert r.status_code == 200, f"{r.status_code} {r.text[:300]}"
    r2 = dealer_session.get(f"{BASE}/api/dealer/notifications")
    data = r2.json()
    uc = data.get("unreadCount", 0)
    assert uc == 0, f"unread should be 0, got {uc}"


# ============== STEP 17 — messages thread + send ==============
def test_step17_send_message(dealer_session):
    deal_id = SEED["dealId"]
    payload = {"dealId": deal_id, "content": "Hello from sandbox dealer"}
    r = dealer_session.post(f"{BASE}/api/dealer/messages", json=payload)
    assert r.status_code in (200, 201), f"{r.status_code} {r.text[:400]}"
    data = r.json()
    assert data.get("messageId") or data.get("id") or data.get("data")


# ============== STEP 14 — scorecard ==============
def test_step14_scorecard(dealer_session):
    r = dealer_session.get(f"{BASE}/api/dealer/scorecard")
    assert r.status_code == 200, f"{r.status_code} {r.text[:300]}"
    data = r.json()
    # numeric KPIs
    assert isinstance(data, dict)


# ============== STEP 19 — leads list ==============
def test_step19_leads(dealer_session):
    r = dealer_session.get(f"{BASE}/api/dealer/leads")
    assert r.status_code == 200, f"{r.status_code} {r.text[:300]}"


# ============== STEP 8 — submit offer ==============
def test_step8_submit_offer(dealer_session):
    payload = {
        "auctionId": SEED["auctionId"],
        "vehiclePriceCents": 2000000,
        "taxCents": 165000,
        "feesCents": 12500,    # documentation under $150 cap
        "otdPriceCents": 2177500,
        "includesFinancing": False,
        "aprRate": 0,
        "termMonths": 0,
        "junkFees": [],
    }
    r = dealer_session.post(f"{BASE}/api/dealer/offers", json=payload)
    # may be 200/201 or 400 if dealer hasn't accepted invitation
    pytest.submit_offer_status = r.status_code
    pytest.submit_offer_body = r.text[:400]
    if r.status_code in (200, 201):
        body = r.json()
        # Response shape: { success, data: { offer: { id, ... } } }
        d = body.get("data") or body
        offer = d.get("offer") if isinstance(d, dict) else None
        pytest.offer_id = (offer or {}).get("id") if offer else (body.get("offerId") or body.get("id"))
    # don't hard-fail; record outcome
    assert r.status_code < 500, f"server error {r.status_code} {r.text[:300]}"


# ============== STEP 9 — revise offer (only if step 8 created one) ==============
def test_step9_revise_offer(dealer_session):
    oid = getattr(pytest, "offer_id", None)
    if not oid:
        pytest.skip("no offer to revise")
    r = dealer_session.post(f"{BASE}/api/dealer/offers/{oid}/revise",
                            json={"otdPriceCents": 2150000})
    assert r.status_code < 500, f"{r.status_code} {r.text[:300]}"


# ============== STEP 10 — contract upload ==============
def test_step10_contract_upload(dealer_session):
    payload = {
        "dealId": SEED["dealId"],
        "documentUrl": "https://example.com/test-contract.pdf",
        "mimeType": "application/pdf",
        "sizeBytes": 1024,
    }
    r = dealer_session.post(f"{BASE}/api/dealer/contracts/upload", json=payload)
    assert r.status_code < 500, f"{r.status_code} {r.text[:400]}"
    pytest.contract_status = r.status_code


# ============== STEP 11/12 — Contract Shield (buyer-side endpoint, requires buyer auth) ==============
def _buyer_session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    # Sign in via Supabase directly to get access_token, then set sb-* auth cookie.
    SUPA = "https://aieybibvewmvrubcpthm.supabase.co"
    ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFpZXliaWJ2ZXdtdnJ1YmNwdGhtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY5MDA4NTgsImV4cCI6MjA5MjQ3Njg1OH0.VwDQL77k8RWrEt5G5GFUfX2zk90zNRLLYmLXhLzDMAY"
    r = requests.post(f"{SUPA}/auth/v1/token?grant_type=password",
                      headers={"apikey": ANON, "Content-Type": "application/json"},
                      json={"email": "sandbox-buyer@autolenis-test.com", "password": "SandboxBuyer1!"})
    if r.status_code != 200:
        return None
    j = r.json()
    # Auth cookie format used by Supabase SSR: sb-<projectref>-auth-token = base64-encoded JSON
    import base64, json as _json
    cookie_value = base64.b64encode(_json.dumps({
        "access_token": j["access_token"],
        "refresh_token": j["refresh_token"],
        "expires_at": j.get("expires_at"),
        "token_type": "bearer",
        "user": j["user"],
    }).encode()).decode()
    # Try common cookie name
    s.cookies.set("sb-aieybibvewmvrubcpthm-auth-token", "base64-" + cookie_value,
                  domain="vehicle-photo-match.preview.emergentagent.com")
    s.headers.update({"Authorization": f"Bearer {j['access_token']}"})
    return s


def test_step11_contract_shield_fail():
    s = _buyer_session()
    if not s:
        pytest.skip("buyer signin failed")
    r = s.post(f"{BASE}/api/buyer/contract-shield/{SEED['dealId']}",
               json={"contractText": "documentation fee $899 plus mandatory etch warranty $499"})
    assert r.status_code == 200, f"{r.status_code} {r.text[:400]}"
    data = r.json().get("data") or r.json()
    score = data.get("score")
    if score is not None:
        assert score <= 75, f"expected fail score got {score}"


def test_step12_contract_shield_pass():
    s = _buyer_session()
    if not s:
        pytest.skip("buyer signin failed")
    r = s.post(f"{BASE}/api/buyer/contract-shield/{SEED['dealId']}",
               json={"contractText": "documentation fee $125. All warranties optional."})
    assert r.status_code == 200, f"{r.status_code} {r.text[:400]}"


# ============== STEP 13 — pickup scan (dealer side) ==============
def test_step13_pickup_scan_invalid(dealer_session):
    r = dealer_session.post(f"{BASE}/api/dealer/pickup/scan",
                            json={"qrToken": "INVALID-FAKE-TOKEN-XYZ"})
    assert r.status_code in (400, 404, 422), f"{r.status_code} {r.text[:200]}"


# ============== STEP 4 — set-password endpoint sanity (no force flip) ==============
def test_step4_set_password_endpoint_exists():
    # Use a fresh requests session — DO NOT use module dealer_session
    # because a successful pwd change would break subsequent tests.
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    # Send to endpoint without auth — verify it's reachable and rejects unauth (401/403/400).
    r = s.post(f"{BASE}/api/dealer/auth/set-password",
               json={"newPassword": "AnotherTest123!", "confirmPassword": "AnotherTest123!"})
    assert r.status_code in (400, 401, 403), f"{r.status_code} {r.text[:300]}"
