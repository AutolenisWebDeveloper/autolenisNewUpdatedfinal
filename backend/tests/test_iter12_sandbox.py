"""
Iteration 12 — Sandbox testing regression.
Covers: public routes, public APIs, admin MFA + admin GETs,
dealer JWT signin + dealer GETs, cron routes (sample), affiliate ACTIVE record.
"""
import os
import re
import subprocess
import time
import uuid
import pytest
import requests

BASE_URL = os.environ.get(
    "REACT_APP_BACKEND_URL",
    "https://e2e-sandbox-check.preview.emergentagent.com",
).rstrip("/")

ADMIN_EMAIL = "admin@autolenis.com"
ADMIN_PW = "MarkistAdmin@Autolenis1250$$$"
DEALER_EMAIL = "testdealer@autolenis-test.com"
DEALER_PW = "TestDealer@2026!"

# --- Read CRON_SECRET from frontend env ---
def _read_env(key, path):
    try:
        with open(path) as f:
            for line in f:
                if line.startswith(key + "="):
                    return line.split("=", 1)[1].strip()
    except FileNotFoundError:
        return None
    return None

CRON_SECRET = _read_env("CRON_SECRET", "/app/frontend/.env")


# ============================================================
# Public site UI routes — SSR HTML 200
# ============================================================
PUBLIC_ROUTES = [
    "/", "/inventory", "/for-dealers", "/for-buyers", "/for-affiliates",
    "/pricing", "/contract-shield", "/dealer-application",
    "/auth/signin", "/dealer/signin", "/admin/signin",
]


@pytest.mark.parametrize("path", PUBLIC_ROUTES)
def test_public_route_returns_200(path):
    r = requests.get(BASE_URL + path, timeout=30, allow_redirects=True)
    assert r.status_code == 200, f"{path} -> {r.status_code}"
    # quick HTML sanity
    assert "<html" in r.text.lower() or "<!doctype" in r.text.lower()


# ============================================================
# Public APIs
# ============================================================
def test_public_inventory():
    r = requests.get(f"{BASE_URL}/api/public/inventory?limit=2", timeout=30)
    assert r.status_code == 200
    data = r.json()
    # Accept list or dict with items
    assert isinstance(data, (list, dict))


def test_public_platform_stats():
    r = requests.get(f"{BASE_URL}/api/public/platform-stats", timeout=30)
    assert r.status_code == 200
    data = r.json()
    assert isinstance(data, dict)


def test_public_dealer_application_create_and_duplicate():
    unique_email = f"sandbox-iter12-{int(time.time())}@autolenis-test.com"
    payload = {
        "dealershipName": "Iter12 Test Motors",
        "dealershipType": "Used",
        "state": "TX",
        "city": "Austin",
        "zip": "78701",
        "licenseNumber": "TX-ITER12-" + uuid.uuid4().hex[:6],
        "contactName": "Iter12 Tester",
        "contactEmail": unique_email,
        "contactPhone": "555-555-1212",
    }
    r1 = requests.post(
        f"{BASE_URL}/api/public/dealer-application", json=payload, timeout=30
    )
    assert r1.status_code in (200, 201), f"Create: {r1.status_code} {r1.text[:300]}"

    # duplicate
    r2 = requests.post(
        f"{BASE_URL}/api/public/dealer-application", json=payload, timeout=30
    )
    assert r2.status_code == 409, f"Dup: {r2.status_code} {r2.text[:300]}"


def test_public_dealer_application_validation():
    r = requests.post(
        f"{BASE_URL}/api/public/dealer-application",
        json={"dealershipName": "x"},
        timeout=30,
    )
    assert r.status_code in (400, 422)


# ============================================================
# Admin MFA flow + 9 admin GETs
# ============================================================
@pytest.fixture(scope="module")
def admin_token():
    s = requests.Session()
    r = s.post(
        f"{BASE_URL}/api/admin/auth/signin",
        json={"email": ADMIN_EMAIL, "password": ADMIN_PW},
        timeout=30,
    )
    assert r.status_code == 200, f"signin: {r.status_code} {r.text[:300]}"
    body = r.json()
    assert body.get("requiresMfa") is True

    # current TOTP
    out = subprocess.run(
        [
            "bash",
            "-c",
            'cd /app/frontend && PREQUAL_ENCRYPTION_KEY=$(grep ^PREQUAL_ENCRYPTION_KEY .env.local | cut -d= -f2-) npx tsx scripts/sandbox-totp.ts',
        ],
        capture_output=True,
        text=True,
        timeout=60,
    )
    code = out.stdout.strip().splitlines()[-1].strip()
    assert re.fullmatch(r"\d{6}", code), f"Bad totp output: {out.stdout!r} / {out.stderr!r}"

    r2 = s.post(
        f"{BASE_URL}/api/admin/auth/verify-mfa",
        json={"code": code},
        timeout=30,
    )
    assert r2.status_code == 200, f"verify-mfa: {r2.status_code} {r2.text[:300]}"

    # extract admin_token from raw Set-Cookie header (multiple cookies separated by comma)
    raw = r2.headers.get("set-cookie", "")
    m = re.search(r"admin_token=([^;,\s]+)", raw)
    assert m, f"admin_token cookie not found in {raw!r}"
    return m.group(1)


ADMIN_GETS = [
    "/api/admin/buyers",
    "/api/admin/dealers",
    "/api/admin/affiliates",
    "/api/admin/dealers/applications",
    "/api/admin/dealers/invitations",
    "/api/admin/auctions",
    "/api/admin/reports/funnel",
    "/api/admin/reports/risk",
    "/api/admin/inventory/coverage-map",
]


@pytest.mark.parametrize("path", ADMIN_GETS)
def test_admin_get(admin_token, path):
    r = requests.get(
        BASE_URL + path,
        cookies={"admin_token": admin_token},
        timeout=30,
    )
    assert r.status_code == 200, f"{path} -> {r.status_code} {r.text[:200]}"


def test_admin_users_create_buyer(admin_token):
    email = f"TEST_iter12_buyer_{int(time.time())}@autolenis-test.com"
    payload = {
        "userType": "BUYER",
        "email": email,
        "firstName": "Iter12",
        "lastName": "Buyer",
        "plan": "STANDARD",
        "temporaryPassword": "TempPass@2026!Buyer",
    }
    r = requests.post(
        f"{BASE_URL}/api/admin/users/create",
        cookies={"admin_token": admin_token},
        json=payload,
        timeout=60,
    )
    assert r.status_code in (200, 201), f"{r.status_code} {r.text[:300]}"


def test_admin_dealers_invite(admin_token):
    email = f"TEST_iter12_invite_{int(time.time())}@autolenis-test.com"
    r = requests.post(
        f"{BASE_URL}/api/admin/dealers/invite",
        cookies={"admin_token": admin_token},
        json={"email": email, "dealershipName": "Iter12 Invite Co", "contactName": "Iter12 Contact"},
        timeout=30,
    )
    assert r.status_code in (200, 201), f"{r.status_code} {r.text[:300]}"
    body = r.json()
    inv = body.get("data", body)
    assert "token" in inv and "inviteUrl" in inv

    # Verify it appears in invitations list
    list_r = requests.get(
        f"{BASE_URL}/api/admin/dealers/invitations",
        cookies={"admin_token": admin_token},
        timeout=30,
    )
    assert list_r.status_code == 200
    txt = list_r.text
    assert email.lower() in txt, "new invite email not found in invitations list"


def test_admin_inventory_search_tool_run(admin_token):
    r = requests.post(
        f"{BASE_URL}/api/admin/inventory/search-tool/run",
        cookies={"admin_token": admin_token},
        json={"make": "Toyota", "model": "Camry", "yearMin": 2018, "yearMax": 2024, "limit": 5},
        timeout=60,
    )
    assert r.status_code == 200, f"{r.status_code} {r.text[:300]}"
    data = r.json()
    # results array
    assert isinstance(data, dict)
    assert any(k in data for k in ("results", "items", "data"))


def test_admin_affiliate_active_record_present(admin_token):
    r = requests.get(
        f"{BASE_URL}/api/admin/affiliates",
        cookies={"admin_token": admin_token},
        timeout=30,
    )
    assert r.status_code == 200
    assert "aff-live-1777010783@example.com" in r.text or "ALYW1C3N" in r.text


# ============================================================
# Dealer JWT flow
# ============================================================
@pytest.fixture(scope="module")
def dealer_token():
    s = requests.Session()
    r = s.post(
        f"{BASE_URL}/api/dealer/auth/signin",
        json={"email": DEALER_EMAIL, "password": DEALER_PW},
        timeout=30,
    )
    assert r.status_code == 200, f"{r.status_code} {r.text[:300]}"
    raw = r.headers.get("set-cookie", "")
    m = re.search(r"dealer_token=([^;,\s]+)", raw)
    assert m, f"no dealer_token cookie {raw!r}"
    return m.group(1)


DEALER_GETS = [
    "/api/dealer/leads",
    "/api/dealer/notifications",
    "/api/dealer/scorecard",
    "/api/dealer/inventory",
]


@pytest.mark.parametrize("path", DEALER_GETS)
def test_dealer_get(dealer_token, path):
    r = requests.get(
        BASE_URL + path,
        cookies={"dealer_token": dealer_token},
        timeout=30,
    )
    assert r.status_code == 200, f"{path} -> {r.status_code} {r.text[:200]}"


def test_dealer_invalid_creds_returns_401():
    r = requests.post(
        f"{BASE_URL}/api/dealer/auth/signin",
        json={"email": DEALER_EMAIL, "password": "WrongPassword!"},
        timeout=30,
    )
    assert r.status_code in (400, 401)


# ============================================================
# Cron endpoints (all 20)
# ============================================================
CRON_ROUTES = [
    "affiliate-digest", "affiliates", "analytics-snapshot", "auction-close",
    "contract-shield", "faith-verse-rotation", "health-check", "holds",
    "inventory-stale-sweep", "inventory-sync-full", "inventory-sync-priority",
    "prequal-ibv-reminders", "prequal-message-delivery", "prequal-purge",
    "prequal-sla-escalation", "prequal-stale-cleanup", "sessions", "sla-check",
    "trust-check", "workflow-automation",
]


@pytest.mark.parametrize("name", CRON_ROUTES)
def test_cron_route_authorized(name):
    assert CRON_SECRET, "CRON_SECRET missing"
    r = requests.get(
        f"{BASE_URL}/api/cron/{name}",
        headers={"Authorization": f"Bearer {CRON_SECRET}"},
        timeout=60,
    )
    assert r.status_code == 200, f"cron/{name} -> {r.status_code} {r.text[:200]}"


def test_cron_unauthorized_returns_401():
    r = requests.get(f"{BASE_URL}/api/cron/health-check", timeout=30)
    assert r.status_code in (401, 403)
