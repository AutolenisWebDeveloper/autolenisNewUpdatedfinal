"""
Iteration 22 — Admin Inventory Upload & Management API tests.

Tests:
  - GET /api/admin/inventory (list + filters)
  - POST /api/admin/inventory (create, validation, duplicate VIN)
  - GET /api/admin/inventory/template (CSV)
  - POST /api/admin/inventory/bulk-upload (rows + batch + audit)
  - GET /api/admin/inventory/upload/history
  - PATCH /api/admin/inventory/[id]
  - PATCH /api/admin/inventory/[id]/deactivate
  - DELETE /api/admin/inventory/[id]
  - POST /api/admin/inventory/upload-image (multipart, may fall back)
  - 401 enforcement on all endpoints
  - Verify created vehicles appear in /api/buyer/search
"""

import os
import io
import time
import subprocess
import requests
import pytest

BASE_URL = "https://e2e-sandbox-check.preview.emergentagent.com"
ADMIN_EMAIL = "admin@autolenis.com"
ADMIN_PW = "MarkistAdmin@Autolenis1250$$$"

# Track created items for cleanup
_created_ids = []


def _totp() -> str:
    out = subprocess.check_output(
        "cd /app/frontend && PREQUAL_ENCRYPTION_KEY=$(grep ^PREQUAL_ENCRYPTION_KEY .env.local | cut -d= -f2-) "
        "npx tsx scripts/sandbox-totp.ts 2>&1 | tail -1",
        shell=True,
    ).decode().strip()
    return out


import re


def _admin_session() -> requests.Session:
    s = requests.Session()
    # Step 1: signin
    r = s.post(f"{BASE_URL}/api/admin/auth/signin",
               json={"email": ADMIN_EMAIL, "password": ADMIN_PW},
               timeout=30)
    assert r.status_code in (200, 201), f"signin failed: {r.status_code} {r.text[:300]}"

    # Step 2: verify TOTP
    code = _totp()
    r2 = s.post(f"{BASE_URL}/api/admin/auth/verify-mfa",
                json={"code": code},
                timeout=30)
    if r2.status_code not in (200, 201):
        time.sleep(2)
        code = _totp()
        r2 = s.post(f"{BASE_URL}/api/admin/auth/verify-mfa",
                    json={"code": code}, timeout=30)
    assert r2.status_code in (200, 201), f"verify-mfa failed: {r2.status_code} {r2.text[:300]}"

    # requests can mis-parse multi-cookie Set-Cookie due to comma in Expires.
    # Extract admin_token manually from the raw Set-Cookie header.
    set_cookie_header = r2.headers.get("set-cookie", "")
    m = re.search(r"admin_token=([^;,\s]+)", set_cookie_header)
    if m:
        s.cookies.set("admin_token", m.group(1),
                      domain="e2e-sandbox-check.preview.emergentagent.com", path="/")
    assert "admin_token" in s.cookies.get_dict(), \
        f"no admin_token cookie. Got: {s.cookies.get_dict()}, header: {set_cookie_header[:200]}"
    return s


@pytest.fixture(scope="module")
def admin():
    return _admin_session()


@pytest.fixture(scope="module")
def cleanup():
    yield
    if not _created_ids:
        return
    s = _admin_session()
    for iid in _created_ids:
        try:
            s.delete(f"{BASE_URL}/api/admin/inventory/{iid}",
                     json={"confirmation": "DELETE"}, timeout=15)
        except Exception:
            pass


# ------------------------- 401 enforcement -------------------------
class TestUnauth:
    def test_list_unauth(self):
        r = requests.get(f"{BASE_URL}/api/admin/inventory", timeout=15)
        assert r.status_code == 401

    def test_create_unauth(self):
        r = requests.post(f"{BASE_URL}/api/admin/inventory", json={}, timeout=15)
        assert r.status_code == 401

    def test_template_unauth(self):
        r = requests.get(f"{BASE_URL}/api/admin/inventory/template", timeout=15)
        assert r.status_code == 401

    def test_bulk_unauth(self):
        r = requests.post(f"{BASE_URL}/api/admin/inventory/bulk-upload", json={"rows": []}, timeout=15)
        assert r.status_code == 401

    def test_history_unauth(self):
        r = requests.get(f"{BASE_URL}/api/admin/inventory/upload/history", timeout=15)
        assert r.status_code == 401


# ------------------------- LIST -------------------------
class TestList:
    def test_list_default(self, admin):
        r = admin.get(f"{BASE_URL}/api/admin/inventory?limit=10", timeout=20)
        assert r.status_code == 200, r.text[:300]
        body = r.json()
        assert body.get("success") is True
        data = body["data"]
        assert "items" in data
        assert "hasMore" in data
        assert "nextCursor" in data
        assert "count" in data
        assert isinstance(data["items"], list)

    def test_list_filter_source(self, admin):
        r = admin.get(f"{BASE_URL}/api/admin/inventory?source=manual_admin&limit=5", timeout=20)
        assert r.status_code == 200
        for it in r.json()["data"]["items"]:
            assert it.get("sourceAdapter") == "manual_admin"

    def test_list_filter_status_active(self, admin):
        r = admin.get(f"{BASE_URL}/api/admin/inventory?status=active&limit=5", timeout=20)
        assert r.status_code == 200
        for it in r.json()["data"]["items"]:
            assert it.get("isActive") is True


# ------------------------- CREATE -------------------------
class TestCreate:
    def test_create_valid(self, admin):
        ts = int(time.time())
        payload = {
            "make": "TEST_TOYOTA",
            "model": "Camry_iter22",
            "year": 2024,
            "priceCents": 2599900,
            "mileage": 12000,
            "lane": "LANE_2",
        }
        r = admin.post(f"{BASE_URL}/api/admin/inventory", json=payload, timeout=20)
        assert r.status_code == 201, r.text[:300]
        body = r.json()
        item = body["data"]["item"]
        assert item["make"] == "TEST_TOYOTA"
        assert item["year"] == 2024
        _created_ids.append(item["id"])

        # Verify auto-set sourceAdapter via GET
        r2 = admin.get(f"{BASE_URL}/api/admin/inventory/{item['id']}", timeout=15)
        assert r2.status_code == 200
        full = r2.json()["data"]["item"]
        assert full["sourceAdapter"] == "manual_admin"
        assert full["addedByAdminId"] is not None
        assert full["isActive"] is True
        # store ts to suppress unused warning
        assert ts > 0

    def test_create_invalid_year(self, admin):
        r = admin.post(f"{BASE_URL}/api/admin/inventory",
                       json={"make": "TEST", "model": "X", "year": 1990, "priceCents": 100000},
                       timeout=20)
        assert r.status_code == 400
        assert r.json().get("error", {}).get("code") == "VALIDATION_ERROR"

    def test_create_duplicate_vin(self, admin):
        vin = "1HGCM82633A123456"  # passes regex (no I,O,Q)
        p1 = {"make": "TEST_HONDA", "model": "Civic_iter22", "year": 2023,
              "priceCents": 1999900, "vin": vin}
        r1 = admin.post(f"{BASE_URL}/api/admin/inventory", json=p1, timeout=20)
        if r1.status_code == 409:
            # already exists from previous run, use a new VIN
            vin = "1HGCM82633A654321"
            p1["vin"] = vin
            r1 = admin.post(f"{BASE_URL}/api/admin/inventory", json=p1, timeout=20)
        assert r1.status_code == 201, r1.text[:300]
        _created_ids.append(r1.json()["data"]["item"]["id"])

        # second with same VIN
        p2 = {"make": "TEST_HONDA", "model": "Accord_iter22", "year": 2023,
              "priceCents": 2099900, "vin": vin}
        r2 = admin.post(f"{BASE_URL}/api/admin/inventory", json=p2, timeout=20)
        assert r2.status_code == 409
        assert r2.json().get("error", {}).get("code") == "DUPLICATE_VIN"


# ------------------------- TEMPLATE -------------------------
class TestTemplate:
    def test_template_csv(self, admin):
        r = admin.get(f"{BASE_URL}/api/admin/inventory/template", timeout=20)
        assert r.status_code == 200
        ct = r.headers.get("content-type", "")
        assert "text/csv" in ct, f"expected text/csv, got {ct}"
        text = r.text
        lines = [ln for ln in text.strip().splitlines() if ln.strip()]
        assert len(lines) >= 2, "should have header + at least 1 example row"
        headers = lines[0].split(",")
        assert len(headers) == 20, f"expected 20 headers got {len(headers)}: {headers}"


# ------------------------- BULK UPLOAD -------------------------
class TestBulk:
    def test_bulk_upload_3_valid_2_invalid(self, admin):
        rows = [
            # valid
            {"make": "TEST_BMW", "model": "M3_a", "year": "2024", "priceCents": "5000000"},
            {"make": "TEST_BMW", "model": "M3_b", "year": "2023", "priceCents": "4500000"},
            {"make": "TEST_BMW", "model": "M3_c", "year": "2022", "priceCents": "4000000"},
            # invalid year
            {"make": "TEST_BMW", "model": "Bad_year", "year": "1990", "priceCents": "1000000"},
            # invalid - missing make
            {"make": "", "model": "Missing_make", "year": "2024", "priceCents": "1000000"},
        ]
        r = admin.post(f"{BASE_URL}/api/admin/inventory/bulk-upload",
                       json={"rows": rows, "filename": "TEST_iter22.csv"},
                       timeout=30)
        assert r.status_code == 201, r.text[:400]
        data = r.json()["data"]
        assert data["successCount"] == 3, f"expected 3, got {data['successCount']}: {data}"
        assert data["failureCount"] == 2, f"expected 2, got {data['failureCount']}"
        assert "batchId" in data
        # Errors include row numbers
        errors = [r for r in data["results"] if r["status"] == "error"]
        assert len(errors) == 2
        for e in errors:
            assert "row" in e
        # Track created
        for row in data["results"]:
            if row["status"] == "success" and row.get("id"):
                _created_ids.append(row["id"])

    def test_history_lists_batch(self, admin):
        r = admin.get(f"{BASE_URL}/api/admin/inventory/upload/history?limit=5", timeout=20)
        assert r.status_code == 200
        data = r.json()["data"]
        # data structure should have batches
        batches = data.get("batches") or data.get("items") or []
        assert isinstance(batches, list)
        assert len(batches) >= 1
        # Find our test batch
        found = any(b.get("filename") == "TEST_iter22.csv" for b in batches)
        assert found, f"TEST_iter22.csv not found in history: {batches[:3]}"


# ------------------------- PATCH / DEACTIVATE / DELETE -------------------------
class TestUpdate:
    def test_patch_partial(self, admin):
        # create
        r = admin.post(f"{BASE_URL}/api/admin/inventory",
                       json={"make": "TEST_FORD", "model": "F150_iter22",
                             "year": 2024, "priceCents": 4500000},
                       timeout=20)
        assert r.status_code == 201
        iid = r.json()["data"]["item"]["id"]
        _created_ids.append(iid)

        # patch
        r2 = admin.patch(f"{BASE_URL}/api/admin/inventory/{iid}",
                         json={"priceCents": 4400000}, timeout=20)
        assert r2.status_code == 200, r2.text[:300]

        # verify
        r3 = admin.get(f"{BASE_URL}/api/admin/inventory/{iid}", timeout=15)
        assert r3.json()["data"]["item"]["priceCents"] == 4400000

    def test_patch_unknown_id(self, admin):
        r = admin.patch(f"{BASE_URL}/api/admin/inventory/00000000-0000-0000-0000-000000000000",
                        json={"priceCents": 100000}, timeout=15)
        assert r.status_code == 404

    def test_deactivate_then_reactivate(self, admin):
        # create
        r = admin.post(f"{BASE_URL}/api/admin/inventory",
                       json={"make": "TEST_NISSAN", "model": "Sentra_iter22",
                             "year": 2024, "priceCents": 1800000},
                       timeout=20)
        iid = r.json()["data"]["item"]["id"]
        _created_ids.append(iid)

        # deactivate
        r2 = admin.patch(f"{BASE_URL}/api/admin/inventory/{iid}/deactivate",
                         json={"activate": False}, timeout=15)
        assert r2.status_code == 200, r2.text[:300]
        r3 = admin.get(f"{BASE_URL}/api/admin/inventory/{iid}", timeout=15)
        assert r3.json()["data"]["item"]["isActive"] is False

        # reactivate
        r4 = admin.patch(f"{BASE_URL}/api/admin/inventory/{iid}/deactivate",
                         json={"activate": True}, timeout=15)
        assert r4.status_code == 200
        r5 = admin.get(f"{BASE_URL}/api/admin/inventory/{iid}", timeout=15)
        assert r5.json()["data"]["item"]["isActive"] is True

    def test_delete_requires_confirmation(self, admin):
        # create
        r = admin.post(f"{BASE_URL}/api/admin/inventory",
                       json={"make": "TEST_DEL", "model": "delete_iter22",
                             "year": 2024, "priceCents": 1000000},
                       timeout=20)
        iid = r.json()["data"]["item"]["id"]

        # without confirmation
        r2 = admin.delete(f"{BASE_URL}/api/admin/inventory/{iid}",
                          json={}, timeout=15)
        assert r2.status_code == 400
        assert r2.json().get("error", {}).get("code") == "CONFIRMATION_REQUIRED"

        # with confirmation
        r3 = admin.delete(f"{BASE_URL}/api/admin/inventory/{iid}",
                          json={"confirmation": "DELETE"}, timeout=15)
        assert r3.status_code == 200

        # verify gone
        r4 = admin.get(f"{BASE_URL}/api/admin/inventory/{iid}", timeout=15)
        assert r4.status_code == 404


# ------------------------- IMAGE UPLOAD -------------------------
class TestImageUpload:
    def test_image_upload(self, admin):
        # Tiny PNG bytes
        png = (
            b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
            b"\x08\x06\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\rIDATx\x9cc\xf8\xff"
            b"\xff?\x00\x05\xfe\x02\xfe\xa3\xa3\xf3\xc7\x00\x00\x00\x00IEND\xaeB`\x82"
        )
        files = {"file": ("test_iter22.png", io.BytesIO(png), "image/png")}
        r = admin.post(f"{BASE_URL}/api/admin/inventory/upload-image",
                       files=files, timeout=30)
        assert r.status_code in (200, 201), r.text[:400]
        body = r.json()
        assert body.get("success") is True
        data = body.get("data", body)
        assert "url" in data, f"missing url: {data}"
        # isFallback acceptable per spec


# ------------------------- BUYER SEARCH INTEGRATION -------------------------
class TestBuyerSearch:
    def test_manual_item_visible_in_buyer_search(self, admin):
        # create new manual_admin item
        ts = int(time.time())
        unique_make = f"TEST_BUYER_{ts}"
        r = admin.post(f"{BASE_URL}/api/admin/inventory",
                       json={"make": unique_make, "model": "search_iter22",
                             "year": 2024, "priceCents": 2200000,
                             "lane": "LANE_1"},
                       timeout=20)
        assert r.status_code == 201
        iid = r.json()["data"]["item"]["id"]
        _created_ids.append(iid)

        # Buyer search (default lane filter applies; try multiple shapes)
        time.sleep(1)
        r2 = requests.get(f"{BASE_URL}/api/buyer/search?make={unique_make}&limit=10",
                          timeout=20)
        if r2.status_code == 401:
            pytest.skip("buyer/search requires auth — skipping public visibility check")
        assert r2.status_code == 200, r2.text[:300]
        body = r2.json()
        data = body.get("data", body)
        items = data.get("vehicles") or data.get("items") or []
        ids = [i.get("id") for i in items]
        # Try without make filter if not found (filter may be exact case)
        if iid not in ids:
            r3 = requests.get(f"{BASE_URL}/api/buyer/search?limit=100", timeout=20)
            items = r3.json().get("data", {}).get("vehicles", [])
            ids = [i.get("id") for i in items]
        assert iid in ids, f"created item {iid} not found in buyer search (n={len(ids)})"


# Use the cleanup fixture
@pytest.fixture(scope="module", autouse=True)
def _cleanup_runner(cleanup):
    yield
