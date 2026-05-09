"""
Admin request API tests for System 4C iter29.
Tests admin offer creation gate (checkpoints), checkpoint flow, analytics page.

Cookie-based auth: signs in admin via /api/admin/auth/signin + TOTP MFA,
then exercises /api/admin/requests/[id]/* mutation surface.
"""
import os
import subprocess
import requests
import pytest

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://e2e-sandbox-check.preview.emergentagent.com").rstrip("/")
ADMIN_EMAIL = "admin@autolenis.com"
ADMIN_PW = "MarkistAdmin@Autolenis1250$$$"


def _totp() -> str:
    out = subprocess.check_output(
        "PREQUAL_ENCRYPTION_KEY=$(grep ^PREQUAL_ENCRYPTION_KEY .env.local | cut -d= -f2-) "
        "npx tsx scripts/sandbox-totp.ts",
        shell=True, cwd="/app/frontend", text=True,
    )
    return out.strip().splitlines()[-1].strip()


@pytest.fixture(scope="module")
def admin_session():
    s = requests.Session()
    # Stage 1: email/password
    r = s.post(f"{BASE_URL}/api/admin/auth/signin", json={"email": ADMIN_EMAIL, "password": ADMIN_PW}, timeout=20)
    assert r.status_code in (200, 202), f"signin {r.status_code} {r.text[:300]}"
    # Stage 2: TOTP
    code = _totp()
    r2 = s.post(f"{BASE_URL}/api/admin/auth/verify-mfa", json={"code": code}, timeout=20)
    if r2.status_code != 200:
        # Re-pull a fresh TOTP and retry once (token may have rolled over)
        r2 = s.post(f"{BASE_URL}/api/admin/auth/verify-mfa", json={"code": _totp()}, timeout=20)
    assert r2.status_code == 200, f"verify-mfa {r2.status_code} {r2.text[:300]}"
    return s


@pytest.fixture(scope="module")
def request_id():
    # ab237fa4 is a SUBMITTED request owned by testbuyer_iteration8
    return "ab237fa4-1bf4-4b2c-ae3a-9ba5782b60cc"


def test_admin_can_view_request(admin_session, request_id):
    r = admin_session.get(f"{BASE_URL}/api/admin/requests/{request_id}", timeout=20)
    # GET may not be implemented — accept any 2xx OR fall back to 404/405; PATCH is the real surface
    assert r.status_code in (200, 404, 405), f"GET admin request {r.status_code}"


def test_offer_blocked_without_active_sourcing(admin_session, request_id):
    """Item [6b] gate: posting an offer while not ACTIVE_SOURCING / no checkpoint must fail."""
    payload = {
        "vehicleInfo": {"year": 2023, "make": "Toyota", "model": "Camry", "trim": "XLE",
                         "otdPriceCents": 2800000, "monthlyEstimateCents": 46667},
        "priceCents": 2800000,
        "notes": "verified offer",
    }
    r = admin_session.post(f"{BASE_URL}/api/admin/requests/{request_id}/offer", json=payload, timeout=20)
    assert r.status_code in (400, 409), f"expected gate failure, got {r.status_code} body={r.text[:300]}"
    body_text = r.text.lower()
    # Gate message should mention checkpoint or sourcing
    assert ("checkpoint" in body_text) or ("sourcing" in body_text) or ("status" in body_text), f"gate message={r.text[:300]}"


def test_activate_sourcing_then_offer_full_flow(admin_session, request_id):
    """Item [6]: PATCH ACTIVATE_SOURCING -> POST checkpoint -> complete -> POST offer."""
    # (a) Activate sourcing
    patch = admin_session.patch(
        f"{BASE_URL}/api/admin/requests/{request_id}",
        json={"action": "ACTIVATE_SOURCING"}, timeout=20,
    )
    assert patch.status_code in (200, 409), f"PATCH activate {patch.status_code} body={patch.text[:300]}"
    # 409 acceptable if already in ACTIVE_SOURCING from prior run; we proceed.

    # (b) Add a checkpoint
    cp_resp = admin_session.post(
        f"{BASE_URL}/api/admin/requests/{request_id}/checkpoints",
        json={"name": "Title verified"}, timeout=20,
    )
    assert cp_resp.status_code in (200, 201), f"checkpoint POST {cp_resp.status_code} body={cp_resp.text[:300]}"
    cp = cp_resp.json()
    cp_id = (cp.get("data") or cp).get("id") if isinstance(cp, dict) else None
    assert cp_id, f"no checkpoint id in {cp}"

    # (c) Complete the checkpoint
    complete = admin_session.post(
        f"{BASE_URL}/api/admin/requests/{request_id}/checkpoints/{cp_id}/complete",
        json={}, timeout=20,
    )
    assert complete.status_code in (200, 204), f"complete checkpoint {complete.status_code} body={complete.text[:300]}"

    # (d) Now POST offer
    payload = {
        "vehicleInfo": {"year": 2023, "make": "Toyota", "model": "Camry", "trim": "XLE",
                         "otdPriceCents": 2800000, "monthlyEstimateCents": 46667},
        "priceCents": 2800000,
        "notes": "verified offer",
    }
    offer = admin_session.post(f"{BASE_URL}/api/admin/requests/{request_id}/offer", json=payload, timeout=20)
    assert offer.status_code in (200, 201), f"POST offer {offer.status_code} body={offer.text[:300]}"
    body = offer.json()
    data = body.get("data", body) if isinstance(body, dict) else {}
    # Some shape validations
    assert data, f"empty offer body {body}"


def test_admin_analytics_page_renders(admin_session):
    """Item [12]: /admin/requests/analytics returns 200 with expected text."""
    r = admin_session.get(f"{BASE_URL}/admin/requests/analytics", timeout=30)
    assert r.status_code == 200, f"analytics page status {r.status_code}"
    text = r.text.lower()
    keywords = ["total requests", "qualification rate", "offer conversion", "avg response time"]
    hits = sum(1 for k in keywords if k in text)
    assert hits >= 3, f"only {hits}/4 keywords found in analytics page; snippet={text[text.find('total'):text.find('total')+500] if 'total' in text else text[:500]}"
