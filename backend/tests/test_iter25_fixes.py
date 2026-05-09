"""Iteration 25 backend tests — validate FIX1 (shortlist auth), FIX2 (features filter), FIX3 (coords backfill).

NOTE: REACT_APP_BACKEND_URL points to the Next.js public preview URL; all routes here are Next.js App Router
APIs under /api/*. Buyer auth uses Supabase email/password — we sign in via /api/auth/signin and reuse the
returned cookies via a requests.Session.
"""
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://e2e-sandbox-check.preview.emergentagent.com").rstrip("/")
BUYER_EMAIL = "testbuyer_iteration8@autolenis-test.com"
BUYER_PASSWORD = "TestBuyer@Iteration8!"


@pytest.fixture(scope="module")
def anon_client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


def _payload(resp_json):
    """API returns {success, data: {items, total, ...}} — unwrap to inner data."""
    if isinstance(resp_json, dict) and "data" in resp_json and isinstance(resp_json["data"], dict):
        return resp_json["data"]
    return resp_json


def _total(resp_json):
    p = _payload(resp_json)
    return p.get("total") or p.get("totalCount") or (p.get("pagination") or {}).get("total")


def _items(resp_json):
    p = _payload(resp_json)
    return p.get("items") or p.get("vehicles") or []


# ----------------------------------------------------------------------------- FIX1 shortlist auth gate
class TestFix1ShortlistAuthGate:
    def test_shortlist_post_anon_401(self, anon_client):
        r = anon_client.post(f"{BASE_URL}/api/buyer/shortlist", json={"inventoryItemId": "00000000-0000-0000-0000-000000000000"})
        assert r.status_code in (401, 403), f"expected 401/403, got {r.status_code}: {r.text[:200]}"
        try:
            data = r.json()
        except Exception:
            data = {}
        # Tolerate either {error:{code:UNAUTHORIZED}} or plain message
        body_text = (data.get("error") or {}).get("code", "") if isinstance(data.get("error"), dict) else ""
        assert body_text == "UNAUTHORIZED" or r.status_code == 401, f"body={data}"


# ----------------------------------------------------------------------------- FIX2 features filter
class TestFix2FeaturesFilter:
    def test_inventory_filter_sunroof(self, anon_client):
        r = anon_client.get(f"{BASE_URL}/api/public/inventory?features=Sunroof&pageSize=1")
        assert r.status_code == 200, r.text[:200]
        total = _total(r.json())
        assert total is not None and total > 0, f"no total in response: {r.json()}"
        # spec says ~97
        print(f"[Sunroof] total={total}")
        assert total >= 50, f"Sunroof filter total too low: {total}"

    def test_inventory_filter_sunroof_heated(self, anon_client):
        r = anon_client.get(f"{BASE_URL}/api/public/inventory?features=Sunroof,Heated%20Seats&pageSize=1")
        assert r.status_code == 200
        total = _total(r.json())
        print(f"[Sunroof+HeatedSeats] total={total}")
        assert total is not None and total > 0
        # spec ~65
        assert 30 <= total <= 110, f"unexpected total: {total}"

    def test_inventory_filter_three_features(self, anon_client):
        r = anon_client.get(f"{BASE_URL}/api/public/inventory?features=Sunroof,Heated%20Seats,Navigation&pageSize=1")
        assert r.status_code == 200
        total = _total(r.json())
        print(f"[Sunroof+Heated+Nav] total={total}")
        assert total is not None and total > 0, f"three-feature filter returned 0 — reshuffle script may not have run: {r.json()}"

    def test_inventory_no_filter_baseline(self, anon_client):
        r = anon_client.get(f"{BASE_URL}/api/public/inventory?pageSize=1")
        assert r.status_code == 200
        total = _total(r.json())
        print(f"[no filter] total={total}")
        assert total == 129, f"expected 129 active items, got {total}"

    def test_returned_items_have_features_field(self, anon_client):
        r = anon_client.get(f"{BASE_URL}/api/public/inventory?features=Sunroof&pageSize=5")
        assert r.status_code == 200
        items = _items(r.json())
        assert len(items) > 0
        for it in items:
            f = it.get("features")
            if f is not None:
                assert "Sunroof" in f, f"item {it.get('id')} missing Sunroof in features={f}"


# ----------------------------------------------------------------------------- FIX3 coordinates backfill
class TestFix3CoordsBackfill:
    def _collect_all(self, client):
        all_items = []
        for page in (1, 2, 3):
            r = client.get(f"{BASE_URL}/api/public/inventory?pageSize=48&page={page}")
            assert r.status_code == 200, r.text[:200]
            data = r.json()
            items = _items(r.json())
            all_items.extend(items)
        return all_items

    def test_all_129_have_lat_lon(self, anon_client):
        items = self._collect_all(anon_client)
        # de-duplicate by id in case pagination overlaps
        unique = {it.get("id"): it for it in items}
        print(f"unique items: {len(unique)}")
        assert len(unique) == 129, f"expected 129 unique items, got {len(unique)}"
        missing = [it.get("id") for it in unique.values() if it.get("latitude") is None or it.get("longitude") is None]
        print(f"missing coords: {len(missing)}")
        assert len(missing) == 0, f"items missing lat/lon: {missing[:10]}"

    def test_geo_search_3000mi_returns_all(self, anon_client):
        r = anon_client.get(f"{BASE_URL}/api/public/inventory?zip=30309&radiusMiles=3000&pageSize=1")
        assert r.status_code == 200
        total = _total(r.json())
        print(f"[geo 3000mi from 30309] total={total}")
        assert total == 129, f"expected 129 within 3000mi, got {total}"

    def test_atlanta_vs_seattle_distinct(self, anon_client):
        r1 = anon_client.get(f"{BASE_URL}/api/public/inventory?zip=30309&radiusMiles=10&pageSize=10")
        r2 = anon_client.get(f"{BASE_URL}/api/public/inventory?zip=98101&radiusMiles=10&pageSize=10")
        assert r1.status_code == 200 and r2.status_code == 200
        atl_items = _items(r1.json())
        sea_items = _items(r2.json())
        atl_ids = {i.get("id") for i in atl_items}
        sea_ids = {i.get("id") for i in sea_items}
        print(f"ATL items={len(atl_ids)}, SEA items={len(sea_ids)}, overlap={len(atl_ids & sea_ids)}")
        # In a 10mi radius the two metros should not share vehicles
        assert (atl_ids & sea_ids) == set(), "Atlanta and Seattle 10mi searches should not overlap"
        # Both should return at least 1 vehicle (round-robin assigned 26 metros to 129 items)
        assert len(atl_ids) > 0, "no Atlanta-area vehicles"
        assert len(sea_ids) > 0, "no Seattle-area vehicles"
