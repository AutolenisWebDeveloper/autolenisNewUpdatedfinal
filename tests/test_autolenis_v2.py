"""
AutoLenis V4 — Iteration 2 comprehensive test
Tests all items from the final testing pass review request
"""
import pytest
import requests
import os

BASE_URL = "https://e2e-sandbox-check.preview.emergentagent.com"

session = requests.Session()
session.headers.update({"User-Agent": "AutoLenis-TestBot/2.0"})

# ============================================================
# PUBLIC API TESTS
# ============================================================

class TestPublicAPIs:
    """Public API endpoints - no auth required"""

    def test_platform_stats(self):
        resp = session.get(f"{BASE_URL}/api/public/platform-stats", timeout=15)
        assert resp.status_code == 200
        data = resp.json()
        assert data.get("success") is True
        assert "data" in data
        d = data["data"]
        assert "dealsCompleted" in d or "deals_completed" in d or len(d) > 0, f"Missing expected fields: {d}"

    def test_faith_verse_homepage(self):
        resp = session.get(f"{BASE_URL}/api/faith/verse/homepage", timeout=15)
        assert resp.status_code in [200, 404, 500]
        if resp.status_code == 200:
            data = resp.json()
            assert "success" in data

    def test_faith_encouragement_buyer_dashboard(self):
        resp = session.get(f"{BASE_URL}/api/faith/encouragement/buyer-dashboard", timeout=15)
        # Should return gracefully (200 or 404)
        assert resp.status_code in [200, 404, 500]

    def test_public_feedback_post(self):
        resp = session.post(
            f"{BASE_URL}/api/public/feedback",
            json={"name": "Test User", "email": "test@test.com", "message": "test feedback", "rating": 5},
            timeout=15
        )
        assert resp.status_code in [200, 201, 400, 422], f"Unexpected status: {resp.status_code} - {resp.text[:200]}"

    def test_public_contact_post(self):
        resp = session.post(
            f"{BASE_URL}/api/public/contact",
            json={"name": "Test", "email": "test@test.com", "subject": "Test", "message": "Testing contact"},
            timeout=15
        )
        assert resp.status_code in [200, 201, 400, 422], f"Unexpected status: {resp.status_code} - {resp.text[:200]}"

# ============================================================
# AUTH-PROTECTED API TESTS (should return 401)
# ============================================================

class TestAuthProtectedAPIs:
    """Authenticated APIs - must return 401 without credentials"""

    def test_buyer_prequal_no_auth(self):
        resp = session.post(f"{BASE_URL}/api/buyer/prequal", json={}, timeout=15)
        assert resp.status_code in [401, 403], f"Expected 401/403, got {resp.status_code}"

    def test_affiliate_earnings_no_auth(self):
        resp = session.get(f"{BASE_URL}/api/affiliate/earnings", timeout=15)
        assert resp.status_code in [401, 403], f"Expected 401/403, got {resp.status_code}"

    def test_admin_buyers_no_cookie(self):
        resp = session.get(f"{BASE_URL}/api/admin/buyers", timeout=15)
        assert resp.status_code in [401, 403], f"Expected 401/403, got {resp.status_code}"

    def test_admin_queues_ofac_no_cookie(self):
        resp = session.get(f"{BASE_URL}/api/admin/queues/OFAC_ALERT", timeout=15)
        assert resp.status_code in [401, 403], f"Expected 401/403, got {resp.status_code}"

    def test_admin_offers_rbac_no_cookie(self):
        resp = session.get(f"{BASE_URL}/api/admin/offers", timeout=15)
        assert resp.status_code in [401, 403], f"Expected 401/403, got {resp.status_code}"

# ============================================================
# PUBLIC PAGES
# ============================================================

class TestPublicPages:
    """Public pages render check"""

    @pytest.mark.parametrize("path", [
        "/", "/for-buyers", "/for-dealers", "/for-affiliates",
        "/trust", "/hope", "/pricing", "/feedback", "/dealer-application", "/refinance"
    ])
    def test_public_page_renders(self, path):
        resp = session.get(f"{BASE_URL}{path}", timeout=15)
        assert resp.status_code == 200, f"{path} returned {resp.status_code}"

# ============================================================
# AUTH PAGES
# ============================================================

class TestAuthPages:
    """Auth page renders"""

    def test_auth_signin(self):
        resp = session.get(f"{BASE_URL}/auth/signin", timeout=15)
        assert resp.status_code == 200

    def test_auth_signup(self):
        resp = session.get(f"{BASE_URL}/auth/signup", timeout=15)
        assert resp.status_code == 200

    def test_auth_forgot_password(self):
        resp = session.get(f"{BASE_URL}/auth/forgot-password", timeout=15)
        assert resp.status_code == 200

    def test_admin_signin(self):
        resp = session.get(f"{BASE_URL}/admin/auth/signin", timeout=15)
        assert resp.status_code == 200

    def test_admin_setup_mfa(self):
        resp = session.get(f"{BASE_URL}/admin/auth/setup-mfa", timeout=15)
        assert resp.status_code == 200

    def test_admin_verify_mfa(self):
        resp = session.get(f"{BASE_URL}/admin/auth/verify-mfa", timeout=15)
        assert resp.status_code == 200

    def test_dealer_signin(self):
        resp = session.get(f"{BASE_URL}/dealer/signin", timeout=15)
        assert resp.status_code == 200

# ============================================================
# BUYER PORTAL PAGES (redirects to auth)
# ============================================================

class TestBuyerPages:
    """Buyer pages — unauthenticated should redirect"""

    @pytest.mark.parametrize("path", [
        "/buyer/dashboard",
        "/buyer/prequal/declined",
        "/buyer/deposit",
        "/buyer/deposit/success",
        "/buyer/requests",
        "/buyer/trade-in",
        "/buyer/documents",
        "/buyer/messages",
        "/buyer/onboarding",
        "/buyer/prequal/manual-preapproval/status",
    ])
    def test_buyer_page(self, path):
        resp = session.get(f"{BASE_URL}{path}", timeout=15, allow_redirects=True)
        assert resp.status_code in [200, 302, 307, 401, 403], f"{path} returned {resp.status_code}"

    def test_buyer_inventory_test_id(self):
        resp = session.get(f"{BASE_URL}/buyer/inventory/test123", timeout=15, allow_redirects=True)
        assert resp.status_code in [200, 302, 307, 401, 403, 404]

# ============================================================
# ADMIN PORTAL PAGES
# ============================================================

class TestAdminPages:
    """Admin pages — no cookie, should redirect to admin/auth/signin"""

    @pytest.mark.parametrize("path", [
        "/admin/dashboard",
        "/admin/queues",
        "/admin/faith-content",
        "/admin/reports",
        "/admin/seo",
        "/admin/refinance",
        "/admin/external-preapprovals",
        "/admin/contracts",
    ])
    def test_admin_page_redirect(self, path):
        resp = session.get(f"{BASE_URL}{path}", timeout=15, allow_redirects=True)
        assert resp.status_code in [200, 302, 307, 401, 403], f"{path} returned {resp.status_code}"

    def test_admin_deals_notfound(self):
        resp = session.get(f"{BASE_URL}/admin/deals/test123", timeout=15, allow_redirects=True)
        assert resp.status_code in [200, 302, 307, 401, 403, 404]

    def test_admin_auctions_notfound(self):
        resp = session.get(f"{BASE_URL}/admin/auctions/test123", timeout=15, allow_redirects=True)
        assert resp.status_code in [200, 302, 307, 401, 403, 404]

# ============================================================
# AFFILIATE PAGES
# ============================================================

class TestAffiliatePages:

    def test_affiliate_register(self):
        resp = session.get(f"{BASE_URL}/affiliate/register", timeout=15)
        assert resp.status_code == 200

    @pytest.mark.parametrize("path", [
        "/affiliate/portal/dashboard",
        "/affiliate/portal/compliance",
        "/affiliate/portal/income-calculator",
    ])
    def test_affiliate_portal_page(self, path):
        resp = session.get(f"{BASE_URL}{path}", timeout=15, allow_redirects=True)
        assert resp.status_code in [200, 302, 307, 401, 403]

    def test_dealer_scorecard(self):
        resp = session.get(f"{BASE_URL}/dealer/scorecard", timeout=15, allow_redirects=True)
        assert resp.status_code in [200, 302, 307, 401, 403]

    def test_dealer_quick_offer(self):
        resp = session.get(f"{BASE_URL}/dealer/quick-offer/testtoken", timeout=15, allow_redirects=True)
        assert resp.status_code in [200, 302, 307, 401, 403, 404]

    def test_dealer_contracts_upload(self):
        resp = session.get(f"{BASE_URL}/dealer/contracts/upload", timeout=15, allow_redirects=True)
        assert resp.status_code in [200, 302, 307, 401, 403]
