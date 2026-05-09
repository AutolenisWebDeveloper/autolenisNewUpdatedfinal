"""Iteration 14 — Buyer journey re-test with seeded sandbox-buyer pipeline."""
import time, json, base64, hmac, hashlib, requests, pytest

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
def seed_ids(buyer_sess):
    """Seed IDs from latest yarn sandbox:seed-deal run. Override via /tmp/iter14_seed_ids.json if present."""
    ids = {
        "dealId": "d0b311e7-2401-4f2f-967f-8083b7e423ca",
        "auctionId": "690b65f7-a077-4ace-8c9d-be9c24c84f12",
    }
    try:
        with open("/tmp/iter14_seed_ids.json") as f:
            ids.update(json.load(f))
    except FileNotFoundError:
        pass
    # Try journey-status as a discovery override (best-effort)
    try:
        r = buyer_sess.get(f"{BASE_URL}/api/buyer/journey-status", timeout=15)
        if r.status_code == 200:
            d = r.json().get("data", r.json())
            ids["dealId"] = d.get("dealId") or d.get("activeDealId") or ids["dealId"]
            ids["auctionId"] = d.get("auctionId") or d.get("activeAuctionId") or ids["auctionId"]
    except Exception:
        pass
    return ids


def test_step04_prequal(buyer_sess):
    r = buyer_sess.get(f"{BASE_URL}/api/buyer/prequal", timeout=30)
    assert r.status_code in (200, 404)
    if r.status_code == 200:
        d = r.json().get("data", r.json())
        assert d.get("maxOtdAmountCents") == 3500000


def test_step05_financing_within_cap(buyer_sess):
    r = buyer_sess.post(f"{BASE_URL}/api/buyer/financing",
        json={"otdAmountCents": 3000000, "downPaymentCents": 200000,
              "termMonths": 60, "aprDecimal": 0.069, "financingPath": "DEALER"}, timeout=30)
    assert r.status_code == 200, f"{r.status_code}: {r.text[:300]}"
    d = r.json().get("data", r.json())
    assert d.get("otdAmountCents") == 3000000
    assert d.get("financingPath") == "DEALER"


def test_step05_financing_over_cap(buyer_sess):
    r = buyer_sess.post(f"{BASE_URL}/api/buyer/financing",
        json={"otdAmountCents": 5000000, "downPaymentCents": 0,
              "termMonths": 60, "aprDecimal": 0.07, "financingPath": "DEALER"}, timeout=30)
    assert r.status_code == 422, f"{r.status_code}: {r.text[:300]}"
    body = r.json()
    assert body.get("error") == "BUDGET_EXCEEDED"
    assert body.get("maxOtdAmountCents") == 3500000


def test_step05_financing_ignores_client_cap(buyer_sess):
    r = buyer_sess.post(f"{BASE_URL}/api/buyer/financing",
        json={"otdAmountCents": 5000000, "maxOtdAmountCents": 99999999,
              "downPaymentCents": 0, "termMonths": 60, "aprDecimal": 0.07,
              "financingPath": "DEALER"}, timeout=30)
    assert r.status_code == 422


def test_step06_search_budget(buyer_sess):
    r = buyer_sess.get(f"{BASE_URL}/api/buyer/search?budgetOnly=true&limit=24", timeout=30)
    assert r.status_code == 200
    d = r.json().get("data", r.json())
    over = [v for v in d.get("vehicles", []) if (v.get("priceCents") or 0) > 3500000]
    assert not over
    assert d.get("budgetGuarded") is True


def test_step08_deposit_sandbox_mock(buyer_sess):
    r = buyer_sess.post(f"{BASE_URL}/api/buyer/deposit/create-intent", json={}, timeout=30)
    assert r.status_code in (200, 400), f"{r.status_code}: {r.text[:300]}"
    body = r.json()
    if r.status_code == 200:
        d = body.get("data", body)
        if d.get("mock"):
            assert d.get("clientSecret") == "pi_sandbox_mock_secret"
        else:
            assert "clientSecret" in d
    else:
        assert "ALREADY_PAID" in r.text


def test_step09_stripe_webhook():
    payload = json.dumps({"id": f"evt_test_{TS}", "type": "payment_intent.succeeded",
        "data": {"object": {"id": f"pi_test_{TS}", "metadata": {"buyerId": "test", "type": "deposit"}}}},
        separators=(",", ":"))
    ts = int(time.time())
    sig = hmac.new(STRIPE_WEBHOOK_SECRET.encode(), f"{ts}.{payload}".encode(), hashlib.sha256).hexdigest()
    r = requests.post(f"{BASE_URL}/api/webhooks/stripe", data=payload,
        headers={"Stripe-Signature": f"t={ts},v1={sig}", "Content-Type": "application/json"}, timeout=30)
    assert r.status_code in (200, 400, 404)


def test_step11_dealer_offers(dealer_sess):
    r = dealer_sess.get(f"{BASE_URL}/api/dealer/offers", timeout=30)
    assert r.status_code == 200, f"{r.status_code}: {r.text[:300]}"
    d = r.json().get("data", r.json())
    offers = d if isinstance(d, list) else d.get("offers", [])
    assert len(offers) >= 1


def test_step12_best_price(buyer_sess, seed_ids):
    aid = seed_ids.get("auctionId")
    if not aid: pytest.skip("no auctionId discovered")
    r = buyer_sess.get(f"{BASE_URL}/api/buyer/auctions/{aid}/best-price", timeout=30)
    assert r.status_code == 200, f"{r.status_code}: {r.text[:300]}"
    d = r.json().get("data", r.json())
    offers = d.get("offers") or d.get("rankedOffers") or []
    assert len(offers) >= 1


def test_step16_contract_shield_mock(buyer_sess, seed_ids):
    did = seed_ids.get("dealId")
    if not did: pytest.skip("no dealId")
    r = buyer_sess.post(f"{BASE_URL}/api/buyer/contract-shield/{did}", json={}, timeout=30)
    assert r.status_code == 200, f"{r.status_code}: {r.text[:300]}"
    d = r.json().get("data", r.json())
    assert d.get("score") == 88
    assert d.get("status") == "PASS"
    assert d.get("fixList") == []
    assert d.get("mock") is True


def test_step16_contract_shield_with_text(buyer_sess, seed_ids):
    did = seed_ids.get("dealId")
    if not did: pytest.skip("no dealId")
    r = buyer_sess.post(f"{BASE_URL}/api/buyer/contract-shield/{did}",
        json={"contractText": "documentation fee $899 plus mandatory etch warranty $499"}, timeout=60)
    assert r.status_code == 200, f"{r.status_code}: {r.text[:300]}"
    d = r.json().get("data", r.json())
    assert isinstance(d.get("score"), (int, float))
    assert d.get("score") < 88 or len(d.get("fixList") or []) > 0


def test_step17_esign_mock(buyer_sess, seed_ids):
    did = seed_ids.get("dealId")
    if not did: pytest.skip("no dealId")
    r = buyer_sess.post(f"{BASE_URL}/api/buyer/esign/{did}", json={}, timeout=30)
    assert r.status_code == 200, f"{r.status_code}: {r.text[:300]}"
    d = r.json().get("data", r.json())
    assert d.get("envelopeId") == "mock-envelope-id"
    assert d.get("signingUrl") == "#docusign-sandbox-mock"
    assert d.get("mock") is True


def test_step18_pickup_qr(buyer_sess, seed_ids):
    did = seed_ids.get("dealId")
    if not did: pytest.skip("no dealId")
    r = buyer_sess.post(f"{BASE_URL}/api/buyer/pickup/{did}/qr", json={}, timeout=30)
    assert r.status_code == 200, f"{r.status_code}: {r.text[:300]}"
    d = r.json().get("data", r.json())
    assert d.get("qrToken") and len(d["qrToken"]) >= 24
    assert d.get("qrCodeBase64", "").startswith("data:image/")
    assert d.get("expiresAt")


def test_step19_dealer_scan_qr(dealer_sess):
    candidates = ["/api/dealer/pickup/scan", "/api/dealer/pickups/scan",
                  "/api/dealer/deals/scan-pickup", "/api/dealer/pickup-scan"]
    found = []
    for path in candidates:
        r = dealer_sess.post(f"{BASE_URL}{path}", json={"qrToken": "test"}, timeout=15)
        if r.status_code != 404:
            found.append((path, r.status_code))
    if not found:
        pytest.skip("BLOCKED — no dealer pickup-scan endpoint exists in /api/dealer/*")


def test_step20_receipt(buyer_sess, seed_ids):
    did = seed_ids.get("dealId")
    if not did: pytest.skip("no dealId")
    r = buyer_sess.get(f"{BASE_URL}/api/buyer/deals/{did}/receipt", timeout=30)
    assert r.status_code == 200, f"{r.status_code}: {r.text[:300]}"


def test_edge01_auction_close_cron():
    r = requests.get(f"{BASE_URL}/api/cron/auction-close",
        headers={"Authorization": f"Bearer {CRON_SECRET}"}, timeout=60)
    assert r.status_code == 200, f"{r.status_code}: {r.text[:300]}"


def test_edge04_plan_upgrade_idempotent(buyer_sess):
    r1 = buyer_sess.post(f"{BASE_URL}/api/buyer/plan/upgrade", json={}, timeout=30)
    assert r1.status_code == 200
    r2 = buyer_sess.post(f"{BASE_URL}/api/buyer/plan/upgrade", json={}, timeout=30)
    assert r2.status_code == 200
    d2 = r2.json().get("data", r2.json())
    assert d2.get("plan") == "PREMIUM"
    assert d2.get("alreadyUpgraded") is True
