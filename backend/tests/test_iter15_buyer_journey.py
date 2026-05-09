"""Iteration 15 — Buyer journey final re-test after 5 fixes for the 4 BLOCKED steps."""
import time, json, base64, hmac, hashlib, requests, pytest, os

BASE_URL = "https://e2e-sandbox-check.preview.emergentagent.com"
TS = int(time.time())

SBX_BUYER_EMAIL = "sandbox-buyer@autolenis-test.com"
SBX_BUYER_PWD = "SandboxBuyer1!"
SBX_DEALER_EMAIL = "sandbox-dealer@autolenis-test.com"
SBX_DEALER_PWD = "SandboxDealer1!"

ENV = {}
for line in open("/app/frontend/.env").readlines():
    if "=" in line and not line.startswith("#"):
        k, v = line.strip().split("=", 1)
        ENV[k] = v
SUPABASE_URL = ENV.get("NEXT_PUBLIC_SUPABASE_URL", "")
SUPABASE_ANON = ENV.get("NEXT_PUBLIC_SUPABASE_ANON_KEY", "")
CRON_SECRET = ENV.get("CRON_SECRET", "")
STRIPE_WEBHOOK_SECRET = ENV.get("STRIPE_WEBHOOK_SECRET", "")


def supabase_signin(email, password):
    r = requests.post(f"{SUPABASE_URL}/auth/v1/token?grant_type=password",
        headers={"apikey": SUPABASE_ANON, "Content-Type": "application/json"},
        json={"email": email, "password": password}, timeout=30)
    if r.status_code != 200: return None, None
    j = r.json()
    return j.get("access_token"), j.get("refresh_token")


def make_buyer_sess(at, rt):
    s = requests.Session()
    project_ref = SUPABASE_URL.split("//")[1].split(".")[0]
    cookie_name = f"sb-{project_ref}-auth-token"
    payload = {"access_token": at, "refresh_token": rt, "token_type": "bearer",
               "expires_in": 3600, "expires_at": int(time.time()) + 3600}
    cookie_value = "base64-" + base64.b64encode(json.dumps(payload).encode()).decode()
    s.cookies.set(cookie_name, cookie_value, domain="vehicle-photo-match.preview.emergentagent.com")
    return s


@pytest.fixture(scope="session")
def buyer_sess():
    at, rt = supabase_signin(SBX_BUYER_EMAIL, SBX_BUYER_PWD)
    if not at: pytest.skip("sandbox-buyer signin failed")
    return make_buyer_sess(at, rt)


@pytest.fixture(scope="session")
def dealer_sess():
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/dealer/auth/signin",
               json={"email": SBX_DEALER_EMAIL, "password": SBX_DEALER_PWD}, timeout=30)
    if r.status_code != 200: pytest.skip(f"sandbox-dealer signin {r.status_code}")
    return s


@pytest.fixture(scope="session")
def seed_ids():
    """Read seeds from /tmp/iter15_seed_ids.json (written manually after yarn sandbox:seed-deal)."""
    with open("/tmp/iter15_seed_ids.json") as f:
        return json.load(f)


# ---------- MINOR — journey-status now wrapped in try/catch ----------
def test_journey_status_200(buyer_sess):
    r = buyer_sess.get(f"{BASE_URL}/api/buyer/journey-status", timeout=30)
    assert r.status_code == 200, f"{r.status_code}: {r.text[:300]}"
    d = r.json().get("data", r.json())
    assert "currentStage" in d or "stage" in d or "completedStages" in d, f"missing keys: {list(d.keys())}"


# ---------- STEP 5 ----------
def test_step05_financing_within_cap(buyer_sess):
    r = buyer_sess.post(f"{BASE_URL}/api/buyer/financing",
        json={"otdAmountCents": 3000000, "downPaymentCents": 200000,
              "termMonths": 60, "aprDecimal": 0.069, "financingPath": "DEALER"}, timeout=30)
    assert r.status_code == 200, f"{r.status_code}: {r.text[:300]}"


def test_step05_financing_over_cap(buyer_sess):
    r = buyer_sess.post(f"{BASE_URL}/api/buyer/financing",
        json={"otdAmountCents": 5000000, "downPaymentCents": 0,
              "termMonths": 60, "aprDecimal": 0.07, "financingPath": "DEALER"}, timeout=30)
    assert r.status_code == 422
    assert r.json().get("error") == "BUDGET_EXCEEDED"


# ---------- STEP 6 ----------
def test_step06_search_budget(buyer_sess):
    r = buyer_sess.get(f"{BASE_URL}/api/buyer/search?budgetOnly=true&limit=24", timeout=30)
    assert r.status_code == 200
    d = r.json().get("data", r.json())
    assert d.get("budgetGuarded") is True


# ---------- STEP 8 ----------
def test_step08_deposit(buyer_sess):
    r = buyer_sess.post(f"{BASE_URL}/api/buyer/deposit/create-intent", json={}, timeout=30)
    assert r.status_code in (200, 400)


# ---------- STEP 9 ----------
def test_step09_stripe_webhook():
    payload = json.dumps({"id": f"evt_test_{TS}", "type": "payment_intent.succeeded",
        "data": {"object": {"id": f"pi_test_{TS}", "metadata": {"buyerId": "test", "type": "deposit"}}}},
        separators=(",", ":"))
    ts = int(time.time())
    sig = hmac.new(STRIPE_WEBHOOK_SECRET.encode(), f"{ts}.{payload}".encode(), hashlib.sha256).hexdigest()
    r = requests.post(f"{BASE_URL}/api/webhooks/stripe", data=payload,
        headers={"Stripe-Signature": f"t={ts},v1={sig}", "Content-Type": "application/json"}, timeout=30)
    assert r.status_code in (200, 400)


# ---------- STEP 11 ----------
def test_step11_dealer_offers(dealer_sess):
    r = dealer_sess.get(f"{BASE_URL}/api/dealer/offers", timeout=30)
    assert r.status_code == 200


# ---------- STEP 12 — best-price ACTIVE auction now returns ranked offers + preliminary:true ----------
def test_step12_best_price_active(buyer_sess, seed_ids):
    aid = seed_ids["auctionId"]
    r = buyer_sess.get(f"{BASE_URL}/api/buyer/auctions/{aid}/best-price", timeout=30)
    assert r.status_code == 200, f"{r.status_code}: {r.text[:300]}"
    d = r.json().get("data", r.json())
    offers = d.get("offers") or d.get("rankedOffers") or []
    assert len(offers) >= 1, f"expected ranked offers, got: {d}"
    assert d.get("preliminary") is True
    assert "Preliminary" in (d.get("label") or "")


# ---------- STEP 16 — Contract Shield with-text now should detect doc-fee + etch warranty ----------
def test_step16_contract_shield_mock(buyer_sess, seed_ids):
    did = seed_ids["dealId"]
    r = buyer_sess.post(f"{BASE_URL}/api/buyer/contract-shield/{did}", json={}, timeout=30)
    assert r.status_code == 200
    d = r.json().get("data", r.json())
    assert d.get("score") == 88
    assert d.get("status") == "PASS"


def test_step16_contract_shield_with_text(buyer_sess, seed_ids):
    did = seed_ids["dealId"]
    r = buyer_sess.post(f"{BASE_URL}/api/buyer/contract-shield/{did}",
        json={"contractText": "documentation fee $899 plus mandatory etch warranty $499"},
        timeout=60)
    assert r.status_code == 200, f"{r.status_code}: {r.text[:300]}"
    d = r.json().get("data", r.json())
    score = d.get("score")
    fix = d.get("fixList") or []
    assert isinstance(score, (int, float))
    assert score <= 75, f"expected score <=75 (FAIL/WARNING), got {score} body={d}"
    assert len(fix) >= 1, f"expected non-empty fixList, got {fix}"
    # Must flag at least the doc fee or etch warranty
    flat = json.dumps(fix).lower()
    assert ("doc" in flat or "899" in flat) or ("etch" in flat or "499" in flat), \
        f"fixList does not mention doc fee or etch warranty: {fix}"


# ---------- STEP 17 ----------
def test_step17_esign(buyer_sess, seed_ids):
    did = seed_ids["dealId"]
    r = buyer_sess.post(f"{BASE_URL}/api/buyer/esign/{did}", json={}, timeout=30)
    assert r.status_code == 200
    d = r.json().get("data", r.json())
    assert d.get("envelopeId") == "mock-envelope-id"


# ---------- STEP 18 — generate QR; STEP 19 uses qrToken ----------
@pytest.fixture(scope="session")
def pickup_qr(buyer_sess, seed_ids):
    did = seed_ids["dealId"]
    r = buyer_sess.post(f"{BASE_URL}/api/buyer/pickup/{did}/qr", json={}, timeout=30)
    if r.status_code != 200:
        pytest.skip(f"pickup QR generation failed: {r.status_code} {r.text[:200]}")
    d = r.json().get("data", r.json())
    return d


def test_step18_pickup_qr(pickup_qr):
    assert pickup_qr.get("qrToken")
    assert len(pickup_qr["qrToken"]) >= 24
    assert pickup_qr.get("qrCodeBase64", "").startswith("data:image/")


# ---------- STEP 19 — Dealer scans QR → COMPLETED ----------
def test_step19a_invalid_token(dealer_sess):
    r = dealer_sess.post(f"{BASE_URL}/api/dealer/pickup/scan",
                         json={"qrToken": "garbage-invalid-token-zzz"}, timeout=30)
    assert r.status_code == 422, f"{r.status_code}: {r.text[:300]}"
    body = r.json()
    assert body.get("error") == "INVALID_TOKEN"


def test_step19b_dealer_scan_success(dealer_sess, pickup_qr, seed_ids):
    qr = pickup_qr["qrToken"]
    r = dealer_sess.post(f"{BASE_URL}/api/dealer/pickup/scan", json={"qrToken": qr}, timeout=30)
    assert r.status_code == 200, f"{r.status_code}: {r.text[:300]}"
    d = r.json().get("data", r.json())
    assert d.get("success") is True
    assert d.get("dealId") == seed_ids["dealId"]
    assert d.get("completedAt")


def test_step19c_already_scanned(dealer_sess, pickup_qr):
    """Re-scan same token → 409 ALREADY_SCANNED. Depends on test_step19b ordering."""
    qr = pickup_qr["qrToken"]
    r = dealer_sess.post(f"{BASE_URL}/api/dealer/pickup/scan", json={"qrToken": qr}, timeout=30)
    assert r.status_code == 409, f"{r.status_code}: {r.text[:300]}"
    assert r.json().get("error") == "ALREADY_SCANNED"


# ---------- STEP 20 — Receipt only after step 19 completes ----------
def test_step20_receipt(buyer_sess, seed_ids):
    did = seed_ids["dealId"]
    r = buyer_sess.get(f"{BASE_URL}/api/buyer/deals/{did}/receipt", timeout=30)
    assert r.status_code == 200, f"{r.status_code}: {r.text[:300]}"


# ---------- EDGE 1 ----------
def test_edge01_auction_close_cron():
    r = requests.get(f"{BASE_URL}/api/cron/auction-close",
        headers={"Authorization": f"Bearer {CRON_SECRET}"}, timeout=60)
    assert r.status_code == 200


# ---------- EDGE 4 ----------
def test_edge04_plan_upgrade_idempotent(buyer_sess):
    r1 = buyer_sess.post(f"{BASE_URL}/api/buyer/plan/upgrade", json={}, timeout=30)
    assert r1.status_code == 200
    r2 = buyer_sess.post(f"{BASE_URL}/api/buyer/plan/upgrade", json={}, timeout=30)
    assert r2.status_code == 200
    d2 = r2.json().get("data", r2.json())
    assert d2.get("plan") == "PREMIUM"
    assert d2.get("alreadyUpgraded") is True
