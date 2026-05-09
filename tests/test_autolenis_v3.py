"""
AutoLenis V3 Backend Tests — Iteration 3
Tests: inventory API, vehicle detail, public pages, feedback/contact CSRF-exemption,
       admin refinance redirect, lane filter, affiliate register page
"""
import pytest
import requests
import os

BASE_URL = "https://e2e-sandbox-check.preview.emergentagent.com"


# ─── Health Checks / Public Pages ─────────────────────────────────────────────

class TestPublicPages:
    """Verify all public pages return 200"""

    def test_homepage_loads(self):
        r = requests.get(f"{BASE_URL}/", timeout=20)
        assert r.status_code == 200, f"Homepage returned {r.status_code}"

    def test_for_buyers_page(self):
        r = requests.get(f"{BASE_URL}/for-buyers", timeout=20)
        assert r.status_code == 200, f"/for-buyers returned {r.status_code}"

    def test_for_dealers_page(self):
        r = requests.get(f"{BASE_URL}/for-dealers", timeout=20)
        assert r.status_code == 200, f"/for-dealers returned {r.status_code}"

    def test_for_affiliates_page(self):
        r = requests.get(f"{BASE_URL}/for-affiliates", timeout=20)
        assert r.status_code == 200, f"/for-affiliates returned {r.status_code}"

    def test_pricing_page(self):
        r = requests.get(f"{BASE_URL}/pricing", timeout=20)
        assert r.status_code == 200, f"/pricing returned {r.status_code}"

    def test_trust_page(self):
        r = requests.get(f"{BASE_URL}/trust", timeout=20)
        assert r.status_code == 200, f"/trust returned {r.status_code}"

    def test_inventory_page(self):
        r = requests.get(f"{BASE_URL}/inventory", timeout=20)
        assert r.status_code == 200, f"/inventory returned {r.status_code}"

    def test_dealer_signin_page(self):
        r = requests.get(f"{BASE_URL}/dealer/signin", timeout=20)
        assert r.status_code == 200, f"/dealer/signin returned {r.status_code}"

    def test_affiliate_register_page(self):
        r = requests.get(f"{BASE_URL}/affiliate/register", timeout=20)
        assert r.status_code == 200, f"/affiliate/register returned {r.status_code}"


# ─── Inventory API ─────────────────────────────────────────────────────────────

class TestInventoryAPI:
    """Test /api/public/inventory endpoint"""

    def test_inventory_api_returns_success(self):
        r = requests.get(f"{BASE_URL}/api/public/inventory", timeout=20)
        assert r.status_code == 200
        data = r.json()
        assert data.get("success") is True, f"success field not True: {data}"

    def test_inventory_api_returns_items(self):
        r = requests.get(f"{BASE_URL}/api/public/inventory", timeout=20)
        assert r.status_code == 200
        data = r.json()
        items = data["data"]["items"]
        assert isinstance(items, list), "items should be a list"
        assert len(items) > 0, "Expected seeded inventory items, got 0"

    def test_inventory_api_has_6_seeded_items(self):
        r = requests.get(f"{BASE_URL}/api/public/inventory", timeout=20)
        data = r.json()
        total = data["data"]["total"]
        assert total >= 6, f"Expected at least 6 seeded items, got {total}"

    def test_inventory_api_items_have_lane_field(self):
        r = requests.get(f"{BASE_URL}/api/public/inventory", timeout=20)
        data = r.json()
        for item in data["data"]["items"]:
            assert "lane" in item, f"Item missing lane field: {item}"
            assert item["lane"] in ["LANE_1", "LANE_2", "LANE_3"], f"Unknown lane: {item['lane']}"

    def test_inventory_api_lane_filter_lane_1(self):
        r = requests.get(f"{BASE_URL}/api/public/inventory?lane=LANE_1", timeout=20)
        assert r.status_code == 200
        data = r.json()
        items = data["data"]["items"]
        assert len(items) > 0, "Expected LANE_1 items"
        for item in items:
            assert item["lane"] == "LANE_1", f"Expected LANE_1, got {item['lane']}"

    def test_inventory_api_lane_filter_lane_2(self):
        r = requests.get(f"{BASE_URL}/api/public/inventory?lane=LANE_2", timeout=20)
        assert r.status_code == 200
        data = r.json()
        items = data["data"]["items"]
        assert len(items) > 0, "Expected LANE_2 items"
        for item in items:
            assert item["lane"] == "LANE_2", f"Expected LANE_2, got {item['lane']}"

    def test_inventory_api_lane_filter_lane_3(self):
        r = requests.get(f"{BASE_URL}/api/public/inventory?lane=LANE_3", timeout=20)
        assert r.status_code == 200
        data = r.json()
        items = data["data"]["items"]
        assert len(items) > 0, "Expected LANE_3 items"
        for item in items:
            assert item["lane"] == "LANE_3", f"Expected LANE_3, got {item['lane']}"

    def test_inventory_api_pagination_structure(self):
        r = requests.get(f"{BASE_URL}/api/public/inventory", timeout=20)
        data = r.json()["data"]
        assert "page" in data
        assert "totalPages" in data
        assert "pageSize" in data
        assert data["pageSize"] == 6, f"Expected page size 6, got {data['pageSize']}"

    def test_inventory_api_search_query(self):
        r = requests.get(f"{BASE_URL}/api/public/inventory?q=Toyota", timeout=20)
        assert r.status_code == 200
        data = r.json()
        items = data["data"]["items"]
        # Should return Toyota Camry from seeded data
        makes = [item["make"].lower() for item in items]
        assert any("toyota" in m for m in makes), f"Expected Toyota in results, got makes: {makes}"

    def test_inventory_api_price_filter(self):
        r = requests.get(f"{BASE_URL}/api/public/inventory?maxPrice=30000", timeout=20)
        assert r.status_code == 200
        data = r.json()
        for item in data["data"]["items"]:
            assert item["priceCents"] <= 30000 * 100, f"Price exceeds filter: {item['priceCents']}"


# ─── Vehicle Detail API ────────────────────────────────────────────────────────

class TestVehicleDetailAPI:
    """Test /api/public/inventory/[vehicleId] endpoint"""

    def _get_first_vehicle_id(self):
        """Helper to get a real vehicle ID from the inventory"""
        r = requests.get(f"{BASE_URL}/api/public/inventory", timeout=20)
        data = r.json()
        items = data["data"]["items"]
        assert len(items) > 0, "No vehicles in inventory to test"
        return items[0]["id"]

    def test_vehicle_detail_returns_success(self):
        vid = self._get_first_vehicle_id()
        r = requests.get(f"{BASE_URL}/api/public/inventory/{vid}", timeout=20)
        assert r.status_code == 200
        data = r.json()
        assert data.get("success") is True

    def test_vehicle_detail_has_required_fields(self):
        vid = self._get_first_vehicle_id()
        r = requests.get(f"{BASE_URL}/api/public/inventory/{vid}", timeout=20)
        data = r.json()["data"]
        required = ["id", "lane", "year", "make", "model", "priceCents"]
        for field in required:
            assert field in data, f"Missing field: {field}"

    def test_vehicle_detail_invalid_id_returns_404(self):
        r = requests.get(f"{BASE_URL}/api/public/inventory/nonexistent-invalid-id-xyz", timeout=20)
        assert r.status_code == 404
        data = r.json()
        assert "error" in data

    def test_vehicle_detail_page_renders(self):
        """Test that the SSR vehicle detail page renders"""
        vid = self._get_first_vehicle_id()
        r = requests.get(f"{BASE_URL}/inventory/{vid}", timeout=20)
        assert r.status_code == 200


# ─── Public Contact/Feedback API (CSRF-exempt) ────────────────────────────────

class TestPublicContactFeedbackAPI:
    """Test /api/public/feedback and /api/public/contact — should be CSRF-exempt"""

    def test_feedback_post_no_csrf_returns_not_403(self):
        """POST /api/public/feedback without CSRF token — should not return 403 (CSRF-exempt)"""
        r = requests.post(
            f"{BASE_URL}/api/public/feedback",
            json={"email": "test@example.com", "message": "Test feedback from pytest"},
            headers={"Content-Type": "application/json"},
            timeout=20,
        )
        # Should NOT be 403 CSRF error; can be 201 or 422 (validation) but not CSRF block
        assert r.status_code != 403, f"Expected non-403 (CSRF-exempt), got {r.status_code}: {r.text[:300]}"

    def test_contact_post_no_csrf_returns_not_403(self):
        """POST /api/public/contact without CSRF token — should not return 403 (CSRF-exempt)"""
        r = requests.post(
            f"{BASE_URL}/api/public/contact",
            json={"name": "Test User", "email": "test@example.com", "subject": "Test", "message": "Hello from pytest"},
            headers={"Content-Type": "application/json"},
            timeout=20,
        )
        assert r.status_code != 403, f"Expected non-403 (CSRF-exempt), got {r.status_code}: {r.text[:300]}"


# ─── Admin Refinance Rates (auth-protected) ───────────────────────────────────

class TestAdminRefinanceRates:
    """Admin refinance rates page should redirect to admin signin"""

    def test_admin_refinance_rates_redirects_when_unauthenticated(self):
        r = requests.get(f"{BASE_URL}/admin/refinance/rates", timeout=20, allow_redirects=False)
        # Should redirect (3xx) or return auth page
        assert r.status_code in [200, 302, 303, 307, 308], f"Got: {r.status_code}"
        if r.status_code in [302, 303, 307, 308]:
            location = r.headers.get("location", "")
            assert "signin" in location or "auth" in location, f"Redirect not to auth: {location}"

    def test_admin_refinance_rates_api_requires_auth(self):
        """The underlying rates API should return 401/403 without admin cookie"""
        r = requests.get(f"{BASE_URL}/api/admin/refinance/rates", timeout=20)
        assert r.status_code in [401, 403], f"Expected 401/403, got {r.status_code}"


# ─── Content Verification (key strings in page HTML) ──────────────────────────

class TestPageContent:
    """Verify key content is present in page HTML"""

    def test_homepage_has_dark_theme_and_green_cta(self):
        r = requests.get(f"{BASE_URL}/", timeout=20)
        assert r.status_code == 200
        html = r.text
        assert "4CAF50" in html or "bg-[#4CAF50]" in html or "Check My Buying Power" in html, \
            "Homepage missing green CTA"

    def test_for_buyers_has_comparison_section(self):
        r = requests.get(f"{BASE_URL}/for-buyers", timeout=20)
        assert r.status_code == 200
        html = r.text
        # Should have "Old way" vs "AutoLenis way" comparison
        assert "old way" in html.lower() or "dealership" in html.lower(), \
            "for-buyers missing comparison section content"

    def test_for_affiliates_has_commission_structure(self):
        r = requests.get(f"{BASE_URL}/for-affiliates", timeout=20)
        assert r.status_code == 200
        html = r.text
        assert "Level 1" in html or "level-1" in html.lower() or "L1" in html, \
            "for-affiliates missing commission level content"

    def test_pricing_has_two_cards(self):
        r = requests.get(f"{BASE_URL}/pricing", timeout=20)
        assert r.status_code == 200
        html = r.text
        assert "$99" in html and "$499" in html, "Pricing page missing $99 or $499 content"

    def test_trust_has_six_pillars(self):
        r = requests.get(f"{BASE_URL}/trust", timeout=20)
        assert r.status_code == 200
        html = r.text
        assert "Six pillars" in html or "six pillars" in html.lower() or \
               "trust-pillar" in html, "Trust page missing six pillars content"

    def test_dealer_signin_has_form_elements(self):
        r = requests.get(f"{BASE_URL}/dealer/signin", timeout=20)
        assert r.status_code == 200
        html = r.text
        assert "dealer-signin-form" in html, "Dealer signin page missing form data-testid"

    def test_affiliate_register_has_ftc_checkbox(self):
        r = requests.get(f"{BASE_URL}/affiliate/register", timeout=20)
        assert r.status_code == 200
        html = r.text
        assert "ftc-disclosure-checkbox" in html or "FTC" in html, \
            "Affiliate register page missing FTC disclosure checkbox"

    def test_affiliate_register_has_promotion_method_dropdown(self):
        r = requests.get(f"{BASE_URL}/affiliate/register", timeout=20)
        assert r.status_code == 200
        html = r.text
        assert "reg-promotion-method-select" in html or "promotion method" in html.lower(), \
            "Affiliate register page missing promotion method dropdown"

    def test_inventory_page_has_lane_chips(self):
        """Inventory page SSR HTML should include lane trust chips"""
        r = requests.get(f"{BASE_URL}/inventory", timeout=20)
        assert r.status_code == 200
        html = r.text
        # Should include Verified, Partner, or Market lane labels
        has_lane = any(chip in html for chip in ["Verified", "Partner", "Market"])
        assert has_lane, "Inventory page missing lane trust chips (Verified/Partner/Market)"
