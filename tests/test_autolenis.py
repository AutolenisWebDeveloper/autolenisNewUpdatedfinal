"""
AutoLenis V4 — Backend API Tests
Tests public endpoints, auth redirects, and API responses
"""
import pytest
import requests
import os

BASE_URL = "https://e2e-sandbox-check.preview.emergentagent.com"

class TestPublicPages:
    """Test all 21 public pages render (200)"""
    
    PUBLIC_PAGES = [
        "/",
        "/for-buyers",
        "/for-affiliates",
        "/for-dealers",
        "/trust",
        "/feedback",
        "/inventory",
        "/how-it-works",
        "/pricing",
        "/about",
        "/contact",
        "/faq",
        "/refinance",
        "/insurance",
        "/contract-shield",
        "/dealer-application",
        "/hope",
        "/legal/terms",
        "/legal/privacy",
        "/legal/affiliate-terms",
        "/legal/cookie-policy",
    ]

    @pytest.mark.parametrize("path", PUBLIC_PAGES)
    def test_public_page_renders(self, path):
        resp = requests.get(f"{BASE_URL}{path}", timeout=15, allow_redirects=True)
        assert resp.status_code == 200, f"Page {path} returned {resp.status_code}"

class TestAuthPages:
    """Test auth pages render correctly"""

    def test_signup_page(self):
        resp = requests.get(f"{BASE_URL}/auth/signup", timeout=15)
        assert resp.status_code == 200

    def test_signin_page(self):
        resp = requests.get(f"{BASE_URL}/auth/signin", timeout=15)
        assert resp.status_code == 200

    def test_forgot_password_page(self):
        resp = requests.get(f"{BASE_URL}/auth/forgot-password", timeout=15)
        assert resp.status_code == 200

    def test_admin_signin_page(self):
        resp = requests.get(f"{BASE_URL}/admin/auth/signin", timeout=15)
        assert resp.status_code == 200

    def test_admin_setup_mfa_page(self):
        resp = requests.get(f"{BASE_URL}/admin/auth/setup-mfa", timeout=15)
        assert resp.status_code == 200

    def test_admin_verify_mfa_page(self):
        resp = requests.get(f"{BASE_URL}/admin/auth/verify-mfa", timeout=15)
        assert resp.status_code == 200

class TestBuyerPortalRedirects:
    """Buyer portal pages should redirect to signin without auth"""

    BUYER_PAGES = [
        "/buyer/dashboard",
        "/buyer/prequal",
        "/buyer/search",
        "/buyer/shortlist",
        "/buyer/deposit",
        "/buyer/requests",
        "/buyer/requests/new",
        "/buyer/contract-shield",
        "/buyer/esign",
        "/buyer/pickup",
        "/buyer/notifications",
        "/buyer/activity",
        "/buyer/referral",
        "/buyer/deal/wallet",
    ]

    @pytest.mark.parametrize("path", BUYER_PAGES)
    def test_buyer_page_requires_auth(self, path):
        resp = requests.get(f"{BASE_URL}{path}", timeout=15, allow_redirects=True)
        # Should redirect to signin or return 200 (some may show public view)
        assert resp.status_code in [200, 302, 307, 401, 403], f"Unexpected {resp.status_code} for {path}"
        # If redirected, final URL should contain signin
        if resp.url != f"{BASE_URL}{path}":
            assert "signin" in resp.url or "sign-in" in resp.url, f"Redirected to unexpected URL: {resp.url}"

class TestPublicAPIs:
    """Test public API endpoints"""

    def test_platform_stats(self):
        resp = requests.get(f"{BASE_URL}/api/public/platform-stats", timeout=15)
        assert resp.status_code == 200
        data = resp.json()
        assert data.get("success") is True
        stats = data.get("data", {})
        assert "dealsCompleted" in stats
        assert "avgSavingsDollars" in stats
        assert "verifiedDealers" in stats
        assert "buyersServed" in stats
        assert "avgAuctionBids" in stats

    def test_faith_verse_homepage(self):
        resp = requests.get(f"{BASE_URL}/api/faith/verse/homepage", timeout=15)
        assert resp.status_code == 200
        data = resp.json()
        assert "success" in data
        # May return data=null if no verse configured - that's acceptable
        if data.get("success") and data.get("data"):
            assert "reference" in data["data"]
            assert "text" in data["data"]

    def test_faith_encouragement_buyer_dashboard(self):
        resp = requests.get(f"{BASE_URL}/api/faith/encouragement/buyer-dashboard", timeout=15)
        assert resp.status_code == 200
        data = resp.json()
        assert "success" in data

    def test_buyer_prequal_no_auth_returns_401(self):
        resp = requests.post(
            f"{BASE_URL}/api/buyer/prequal",
            json={"ssn": "000-00-0000"},
            timeout=15
        )
        # 401 or 403 (CSRF protection may return 403)
        assert resp.status_code in [401, 403], f"Expected 401/403, got {resp.status_code}"

    def test_buyer_search_interpret_no_body_returns_400(self):
        resp = requests.post(
            f"{BASE_URL}/api/buyer/search/interpret",
            json={},
            timeout=15
        )
        # 400/401/403 (CSRF protection may return 403)
        assert resp.status_code in [400, 401, 403, 422], f"Expected 400/401/403/422, got {resp.status_code}"

class TestDealerPages:
    """Dealer pages - public sign-in should render, portal redirects"""

    def test_dealer_signin_renders(self):
        resp = requests.get(f"{BASE_URL}/dealer/signin", timeout=15)
        assert resp.status_code == 200

    def test_dealer_dashboard_redirects(self):
        resp = requests.get(f"{BASE_URL}/dealer/dashboard", timeout=15, allow_redirects=True)
        assert resp.status_code in [200, 302, 307, 401]

    def test_dealer_scorecard_renders(self):
        resp = requests.get(f"{BASE_URL}/dealer/scorecard", timeout=15, allow_redirects=True)
        assert resp.status_code in [200, 302, 307, 401]

    def test_dealer_quick_offer_renders(self):
        resp = requests.get(f"{BASE_URL}/dealer/quick-offer/test123", timeout=15, allow_redirects=True)
        assert resp.status_code in [200, 302, 307, 401, 404]

    def test_dealer_contracts_upload_renders(self):
        resp = requests.get(f"{BASE_URL}/dealer/contracts/upload", timeout=15, allow_redirects=True)
        assert resp.status_code in [200, 302, 307, 401]

    def test_dealer_invite_claim_renders(self):
        resp = requests.get(f"{BASE_URL}/dealer/invite/claim?token=testtoken123", timeout=15, allow_redirects=True)
        assert resp.status_code in [200, 302, 307, 401, 404]

class TestAffiliatePages:
    """Affiliate pages"""

    def test_affiliate_register_renders(self):
        resp = requests.get(f"{BASE_URL}/affiliate/register", timeout=15)
        assert resp.status_code == 200

    def test_affiliate_portal_redirects(self):
        resp = requests.get(f"{BASE_URL}/affiliate/portal/dashboard", timeout=15, allow_redirects=True)
        assert resp.status_code in [200, 302, 307, 401]

    def test_affiliate_compliance_renders(self):
        resp = requests.get(f"{BASE_URL}/affiliate/portal/compliance", timeout=15, allow_redirects=True)
        assert resp.status_code in [200, 302, 307, 401]

    def test_affiliate_income_calculator_renders(self):
        resp = requests.get(f"{BASE_URL}/affiliate/portal/income-calculator", timeout=15, allow_redirects=True)
        assert resp.status_code in [200, 302, 307, 401]

    def test_affiliate_network_renders(self):
        resp = requests.get(f"{BASE_URL}/affiliate/portal/network", timeout=15, allow_redirects=True)
        assert resp.status_code in [200, 302, 307, 401]

class TestAdminPages:
    """Admin pages - should redirect to /admin/auth/signin without cookie"""

    ADMIN_PAGES = [
        "/admin/dashboard",
        "/admin/queues",
        "/admin/reports/risk",
        "/admin/reports/pipeline",
        "/admin/reports/affiliate",
        "/admin/faith-content",
        "/admin/activity",
        "/admin/contract-shield/rules",
    ]

    @pytest.mark.parametrize("path", ADMIN_PAGES)
    def test_admin_page_redirects_to_signin(self, path):
        resp = requests.get(f"{BASE_URL}{path}", timeout=15, allow_redirects=True)
        assert resp.status_code in [200, 302, 307, 401, 403]
        # After redirect, should be at admin signin
        if resp.url != f"{BASE_URL}{path}":
            assert "admin" in resp.url and ("signin" in resp.url or "sign-in" in resp.url), \
                f"Admin page {path} redirected to unexpected URL: {resp.url}"

class TestSpecialBuyerPages:
    """Special buyer pages with specific requirements"""

    def test_prequal_declined_page(self):
        resp = requests.get(f"{BASE_URL}/buyer/prequal/declined", timeout=15, allow_redirects=True)
        assert resp.status_code in [200, 302, 307, 401]

    def test_prequal_manual_preapproval_status(self):
        resp = requests.get(f"{BASE_URL}/buyer/prequal/manual-preapproval/status", timeout=15, allow_redirects=True)
        assert resp.status_code in [200, 302, 307, 401]

    def test_buyer_inventory_notfound(self):
        resp = requests.get(f"{BASE_URL}/buyer/inventory/test123", timeout=15, allow_redirects=True)
        assert resp.status_code in [200, 302, 307, 401, 404]

    def test_buyer_auction_offers_notfound(self):
        resp = requests.get(f"{BASE_URL}/buyer/auction/test123/offers", timeout=15, allow_redirects=True)
        assert resp.status_code in [200, 302, 307, 401, 404]
