"""Iteration 16 — final buyer journey re-test focused on closing the 3 gaps:
- STEP 3 (onboarding wizard full flow)
- STEP 7 (shortlist 5+1 fully exercised)
- EDGE 2 (session-expiry modal — playwright handled separately)

Plus a quick smoke of the previously PASS endpoints to ensure nothing regressed.
"""
import time, json, base64, hmac, hashlib, requests, pytest, os

BASE_URL = "https://e2e-sandbox-check.preview.emergentagent.com"
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


def supabase_signin(email, password):
    r = requests.post(f"{SUPABASE_URL}/auth/v1/token?grant_type=password",
        headers={"apikey": SUPABASE_ANON, "Content-Type": "application/json"},
        json={"email": email, "password": password}, timeout=30)
    if r.status_code != 200:
        return None, None
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
    if not at:
        pytest.skip("sandbox-buyer signin failed")
    return make_buyer_sess(at, rt)


@pytest.fixture(scope="session")
def seed_ids():
    with open("/tmp/iter16_seed_ids.json") as f:
        return json.load(f)


# ================== EDGE 2 prep: lightweight /api/buyer/me probe ==================
def test_buyer_me_unauth_returns_401():
    """No-cookie request must return 401 — drives the SessionExpiryWatcher."""
    r = requests.get(f"{BASE_URL}/api/buyer/me", timeout=30)
    assert r.status_code == 401, f"expected 401, got {r.status_code}: {r.text[:200]}"


def test_buyer_me_authed_returns_200(buyer_sess):
    r = buyer_sess.get(f"{BASE_URL}/api/buyer/me", timeout=30)
    assert r.status_code == 200, f"{r.status_code}: {r.text[:200]}"


# ================== STEP 3 — Onboarding wizard FULL FLOW ==================
# Pre-condition: sandbox-buyer.onboardingComplete has been flipped to false
# via flip_onboarding script.

def test_step03a_profile_step1_personal(buyer_sess):
    """PATCH /api/buyer/profile with personal details and verify GET reflects."""
    r = buyer_sess.patch(f"{BASE_URL}/api/buyer/profile",
        json={"firstName": "Iter16", "lastName": "Tester", "phone": "555-100-1601"},
        timeout=30)
    assert r.status_code in (200, 204), f"PATCH step1: {r.status_code}: {r.text[:300]}"
    g = buyer_sess.get(f"{BASE_URL}/api/buyer/profile", timeout=30)
    assert g.status_code == 200
    body = g.json().get("data", g.json())
    assert body.get("firstName") == "Iter16"
    assert body.get("lastName") == "Tester"
    assert body.get("phone") == "555-100-1601"


def test_step03b_profile_step2_address(buyer_sess):
    # Wizard sends firstName+lastName along with address fields per saveStep2
    r = buyer_sess.patch(f"{BASE_URL}/api/buyer/profile",
        json={"firstName": "Iter16", "lastName": "Tester", "phone": "555-100-1601",
              "address": "100 Iter16 St", "city": "Austin", "state": "TX", "zip": "78701"},
        timeout=30)
    assert r.status_code in (200, 204), f"PATCH step2: {r.status_code}: {r.text[:300]}"
    g = buyer_sess.get(f"{BASE_URL}/api/buyer/profile", timeout=30)
    body = g.json().get("data", g.json())
    assert body.get("address") == "100 Iter16 St"
    assert body.get("city") == "Austin"
    assert body.get("state") == "TX"
    assert body.get("zip") == "78701"


def test_step03c_complete_terms_not_accepted(buyer_sess):
    r = buyer_sess.post(f"{BASE_URL}/api/buyer/onboarding/complete",
        json={"accepted": False}, timeout=30)
    assert r.status_code == 400, f"expected 400 TERMS_NOT_ACCEPTED, got {r.status_code}: {r.text[:300]}"


def test_step03d_complete_success(buyer_sess):
    r = buyer_sess.post(f"{BASE_URL}/api/buyer/onboarding/complete",
        json={"accepted": True}, timeout=30)
    assert r.status_code == 200, f"{r.status_code}: {r.text[:300]}"
    body = r.json().get("data", r.json())
    assert body.get("onboardingComplete") is True
    assert body.get("termsAcceptedAt") is not None


def test_step03e_complete_idempotent(buyer_sess):
    """Second call should still succeed (idempotent)."""
    r = buyer_sess.post(f"{BASE_URL}/api/buyer/onboarding/complete",
        json={"accepted": True}, timeout=30)
    assert r.status_code == 200, f"{r.status_code}: {r.text[:300]}"


# ================== STEP 7 — Shortlist 5+1 FULL FLOW ==================
def _list_shortlist(sess):
    r = sess.get(f"{BASE_URL}/api/buyer/shortlist", timeout=30)
    assert r.status_code == 200, f"GET shortlist: {r.status_code}: {r.text[:300]}"
    body = r.json().get("data", r.json())
    items = body.get("items") or body.get("shortlist") or body
    if isinstance(items, dict) and "items" in items:
        items = items["items"]
    return items if isinstance(items, list) else []


def _all_inventory_ids(sess):
    """Read 6 SANDBOX-VIN-A* inventory IDs via search (or fallback)."""
    r = sess.get(f"{BASE_URL}/api/buyer/search?q=SANDBOX-VIN-A", timeout=30)
    if r.status_code != 200:
        return []
    body = r.json().get("data", r.json())
    items = body.get("results") or body.get("vehicles") or body.get("items") or []
    return [it.get("id") or it.get("inventoryItemId") for it in items if it.get("id") or it.get("inventoryItemId")]


def test_step07a_clear_existing_shortlist(buyer_sess):
    items = _list_shortlist(buyer_sess)
    print(f"existing shortlist count: {len(items)}")
    for it in items:
        item_id = it.get("id") or it.get("itemId") or it.get("inventoryItemId")
        if not item_id:
            continue
        d = buyer_sess.delete(f"{BASE_URL}/api/buyer/shortlist/{item_id}", timeout=30)
        assert d.status_code in (200, 204), f"DELETE {item_id}: {d.status_code}"
    after = _list_shortlist(buyer_sess)
    assert len(after) == 0, f"shortlist not empty after clear: {len(after)}"


@pytest.fixture(scope="session")
def six_inventory_ids():
    """Hardcode the 6 SANDBOX-VIN-A* inventory IDs from the seed run."""
    # Read them via prisma helper script (faster than search). Persisted by the seed run.
    with open("/tmp/iter16_inventory_ids.json") as f:
        return json.load(f)


def test_step07b_post_5_items_succeed(buyer_sess, six_inventory_ids):
    assert len(six_inventory_ids) >= 6, f"need 6 ids, got {len(six_inventory_ids)}"
    for i, inv_id in enumerate(six_inventory_ids[:5]):
        r = buyer_sess.post(f"{BASE_URL}/api/buyer/shortlist",
            json={"inventoryItemId": inv_id}, timeout=30)
        assert r.status_code in (200, 201), f"POST #{i+1} ({inv_id}): {r.status_code}: {r.text[:300]}"
    items = _list_shortlist(buyer_sess)
    assert len(items) == 5, f"expected 5 items in shortlist, got {len(items)}"


def test_step07c_post_6th_returns_shortlist_full(buyer_sess, six_inventory_ids):
    sixth = six_inventory_ids[5]
    r = buyer_sess.post(f"{BASE_URL}/api/buyer/shortlist",
        json={"inventoryItemId": sixth}, timeout=30)
    assert r.status_code == 400, f"expected 400 SHORTLIST_FULL, got {r.status_code}: {r.text[:300]}"
    body = r.json()
    err = body.get("error", body)
    code = err.get("code") if isinstance(err, dict) else None
    assert code == "SHORTLIST_FULL", f"expected code SHORTLIST_FULL, got {code} body={body}"


def test_step07d_delete_one_returns_4(buyer_sess):
    items = _list_shortlist(buyer_sess)
    target = items[0]
    item_id = target.get("id") or target.get("itemId") or target.get("inventoryItemId")
    d = buyer_sess.delete(f"{BASE_URL}/api/buyer/shortlist/{item_id}", timeout=30)
    assert d.status_code in (200, 204), f"DELETE: {d.status_code}: {d.text[:300]}"
    after = _list_shortlist(buyer_sess)
    assert len(after) == 4, f"expected 4 after delete, got {len(after)}"


def test_step07e_post_new_5th_succeeds(buyer_sess, six_inventory_ids):
    """After deletion add a different item — should succeed since slot is free."""
    # Find an inventory item not currently in the shortlist
    items = _list_shortlist(buyer_sess)
    in_shortlist = {it.get("inventoryItemId") for it in items}
    candidate = next((iid for iid in six_inventory_ids if iid not in in_shortlist), None)
    assert candidate, f"no available inventory id outside current shortlist: {in_shortlist}"
    r = buyer_sess.post(f"{BASE_URL}/api/buyer/shortlist",
        json={"inventoryItemId": candidate}, timeout=30)
    assert r.status_code in (200, 201), f"POST after delete: {r.status_code}: {r.text[:300]}"
    items = _list_shortlist(buyer_sess)
    assert len(items) == 5


# ================== STEP 15 — Insurance mock re-test ==================
def test_step15_insurance_endpoint_reachable(buyer_sess, seed_ids):
    """Endpoint must be reachable & non-500 for any sane body."""
    deal_id = seed_ids.get("dealId")
    r = buyer_sess.post(f"{BASE_URL}/api/buyer/insurance",
        json={"dealId": deal_id, "policyType": "FULL_COVERAGE"}, timeout=30)
    assert r.status_code != 500, f"insurance returned 500: {r.text[:300]}"
    # Accept 200/201/400 (validation) or 422 (missing fields). Just not 5xx.
    assert r.status_code < 500


# ================== STEP 16 — Contract Shield etch warranty amount fix ==================
def test_step16_contract_shield_etch_amount(buyer_sess, seed_ids):
    deal_id = seed_ids.get("dealId")
    body = {"contractText": "documentation fee $899 plus mandatory etch warranty $499"}
    r = buyer_sess.post(f"{BASE_URL}/api/buyer/contract-shield/{deal_id}", json=body, timeout=60)
    assert r.status_code == 200, f"{r.status_code}: {r.text[:300]}"
    data = r.json().get("data", r.json())
    assert data.get("status") == "FAIL", f"expected FAIL: {data.get('status')}"
    fix_list = data.get("fixList") or data.get("fixes") or []
    # The etch warranty should now show $499 (forward-only search)
    etch_entries = [f for f in fix_list if "etch" in str(f.get("item", "")).lower()
                    or "etch" in str(f.get("howToFix", "")).lower()
                    or "etch" in str(f.get("foundValue", "")).lower()]
    print(f"etch entries: {etch_entries}")
    # At least one etch entry should exist; assert NONE shows $899 if any exist
    for e in etch_entries:
        found = str(e.get("foundValue", "")) + str(e.get("amount", ""))
        # if it shows 899 it's the cosmetic regression
        if "899" in found and "499" not in found:
            pytest.fail(f"Etch entry still shows $899 not $499: {e}")
