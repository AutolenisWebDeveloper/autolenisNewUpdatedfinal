"""Iter24 — Validate 5-fix bundle (FIX2 images, FIX3 search, FIX5 geo + Haversine)."""
import os
import re
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://e2e-sandbox-check.preview.emergentagent.com").rstrip("/")


@pytest.fixture(scope="module")
def s():
    sess = requests.Session()
    sess.headers.update({"Accept": "application/json"})
    return sess


# ---------- FIX2: Inventory image backfill ----------
class TestFix2Images:
    def test_no_yellow_mercedes_in_first_page(self, s):
        r = s.get(f"{BASE_URL}/api/public/inventory?pageSize=12")
        assert r.status_code == 200, r.text
        data = r.json()
        items = data["data"]["items"]
        assert len(items) > 0
        for it in items:
            for img in it.get("images") or []:
                low = img.lower()
                assert "yellow" not in low, f"yellow image found: {img}"
                assert "mercedes" not in low or "mercedes-benz" in low, f"mock mercedes image: {img}"

    def test_image_hosts_are_allowed(self, s):
        r = s.get(f"{BASE_URL}/api/public/inventory?pageSize=24")
        items = r.json()["data"]["items"]
        for it in items:
            imgs = it.get("images") or []
            if not imgs:
                continue
            cover = imgs[0]
            assert (
                "upload.wikimedia.org" in cover
                or "images.unsplash.com" in cover
                or "cdn." in cover
            ), f"Unexpected cover host: {cover}"

    def test_all_items_have_at_least_one_image(self, s):
        r = s.get(f"{BASE_URL}/api/public/inventory?pageSize=24")
        items = r.json()["data"]["items"]
        missing = [it["id"] for it in items if not (it.get("images") or [])]
        assert len(missing) == 0, f"Items without images: {missing}"


# ---------- FIX3: Search filters & ZIP geo ----------
class TestFix3Search:
    def test_search_q_filter(self, s):
        r = s.get(f"{BASE_URL}/api/public/inventory?q=Toyota&pageSize=12")
        assert r.status_code == 200
        items = r.json()["data"]["items"]
        for it in items:
            txt = f"{it.get('make','')} {it.get('model','')} {it.get('trim','') or ''}".lower()
            assert "toyota" in txt, f"non-toyota result: {it.get('make')} {it.get('model')}"

    def test_search_make_filter(self, s):
        r = s.get(f"{BASE_URL}/api/public/inventory?make=Honda&pageSize=12")
        assert r.status_code == 200
        items = r.json()["data"]["items"]
        for it in items:
            assert it["make"].lower() == "honda"

    def test_zip_geo_search_30309(self, s):
        r = s.get(f"{BASE_URL}/api/public/inventory?zip=30309&radiusMiles=200&pageSize=24")
        assert r.status_code == 200, r.text
        body = r.json()["data"]
        assert "geo" in body, "geo key missing"
        assert body["geo"]["zip"] == "30309"
        assert body["geo"]["radiusMiles"] == 200
        assert isinstance(body["geo"].get("lat"), (int, float))
        assert isinstance(body["geo"].get("lng"), (int, float))
        items = body["items"]
        # All returned items with distance must satisfy radius and be sorted asc
        prev = -1.0
        for it in items:
            d = it.get("distanceMiles")
            if d is None:
                continue
            assert 0 <= d <= 200, f"item out of radius: {d}"
            assert d >= prev - 0.05, f"items not sorted asc by distance: prev={prev} d={d}"
            prev = d

    def test_geocode_reverse(self, s):
        r = s.get(f"{BASE_URL}/api/public/geocode/reverse?lat=33.79&lng=-84.39")
        assert r.status_code == 200, r.text
        body = r.json()
        zip_code = body.get("zip") or body.get("data", {}).get("zip")
        assert zip_code and re.match(r"^\d{5}$", zip_code), f"unexpected reverse geocode: {body}"

    def test_pagination_works(self, s):
        r1 = s.get(f"{BASE_URL}/api/public/inventory?page=1&pageSize=12")
        r2 = s.get(f"{BASE_URL}/api/public/inventory?page=2&pageSize=12")
        assert r1.status_code == 200 and r2.status_code == 200
        ids1 = {it["id"] for it in r1.json()["data"]["items"]}
        ids2 = {it["id"] for it in r2.json()["data"]["items"]}
        # No overlap (dedupe)
        overlap = ids1 & ids2
        assert len(overlap) == 0, f"overlap on pagination: {overlap}"
        assert len(ids1) <= 12

    def test_no_duplicate_ids_on_page(self, s):
        r = s.get(f"{BASE_URL}/api/public/inventory?pageSize=12")
        items = r.json()["data"]["items"]
        ids = [it["id"] for it in items]
        assert len(ids) == len(set(ids)), "duplicate ids in page"


# ---------- FIX5: Coords backfill & Haversine server-side ----------
class TestFix5Coords:
    def test_at_least_some_items_have_coordinates(self, s):
        all_items = []
        for p in range(1, 10):
            r = s.get(f"{BASE_URL}/api/public/inventory?pageSize=48&page={p}")
            items = r.json()["data"]["items"]
            if not items:
                break
            all_items.extend(items)
        with_coords = [it for it in all_items if it.get("latitude") is not None and it.get("longitude") is not None]
        # Spec: ~103 of 129 active should have coords.
        assert len(with_coords) >= 90, f"only {len(with_coords)}/{len(all_items)} items with coords (expected ~103)"

    def test_distance_one_decimal_when_geo_query(self, s):
        r = s.get(f"{BASE_URL}/api/public/inventory?zip=30309&radiusMiles=500&pageSize=24")
        items = r.json()["data"]["items"]
        had_distance = False
        for it in items:
            d = it.get("distanceMiles")
            if d is None:
                continue
            had_distance = True
            # one decimal place
            assert round(d, 1) == d, f"distance not 1dp: {d}"
        assert had_distance, "no distanceMiles returned with zip query"


# ---------- FIX5: Buyer search geo ----------
class TestFix5BuyerSearch:
    def test_buyer_search_with_zip(self, s):
        r = s.get(f"{BASE_URL}/api/buyer/search?zip=30309&radiusMiles=100")
        assert r.status_code == 200, r.text
        body = r.json()
        data = body.get("data") or body
        vehicles = data.get("vehicles") or []
        # All returned vehicles should have distanceMiles within radius
        for v in vehicles:
            d = v.get("distanceMiles")
            if d is not None:
                assert 0 <= d <= 100, f"vehicle out of radius: {d}"


# ---------- FIX4: Detail API ----------
class TestFix4Detail:
    def test_detail_endpoint(self, s):
        r = s.get(f"{BASE_URL}/api/public/inventory?pageSize=1")
        items = r.json()["data"]["items"]
        assert items
        vid = items[0]["id"]
        r2 = s.get(f"{BASE_URL}/api/public/inventory/{vid}")
        assert r2.status_code == 200, r2.text
        body = r2.json()
        data = body.get("data") or body
        assert data.get("id") == vid
        for k in ("vin", "year", "make", "model", "priceCents"):
            assert k in data, f"missing {k}"
