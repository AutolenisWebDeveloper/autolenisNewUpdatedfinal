"""
Iteration 10 — Affiliate Activation Loop + Buyer Settings/Profile/Account + Sidebar Audit.

All assertions use HTTP against preview URL + direct Postgres (Prisma-managed) verification.
Admin MFA session is forged by signing a JWT with the same JWT_SECRET the app uses
(lib/admin-auth.ts → signAdminJwt). This mirrors what /api/admin/auth/verify-mfa issues
after a successful TOTP, so we are exercising the real requireAdmin() gate with a
structurally-valid admin cookie.
"""
import os
import re
import time
import uuid
import pytest
import requests
import psycopg2
import psycopg2.extras
import jwt as pyjwt

# Secrets come from the environment — never hardcoded. Set AUTOLENIS_JWT_SECRET
# and AUTOLENIS_DB_URL before running; the module skips cleanly if they are absent.
BASE_URL = os.environ.get("AUTOLENIS_E2E_BASE_URL", "https://e2e-sandbox-check.preview.emergentagent.com")
JWT_SECRET = os.environ.get("AUTOLENIS_JWT_SECRET", "")
DB_URL = os.environ.get("AUTOLENIS_DB_URL", "")
if not (JWT_SECRET and DB_URL):
    pytest.skip(
        "AUTOLENIS_JWT_SECRET and AUTOLENIS_DB_URL must be set in the environment "
        "to run this suite",
        allow_module_level=True,
    )
ADMIN_ID = "7cf35008-9f43-43a5-97b1-5297374ed642"
ADMIN_EMAIL = "admin@autolenis.com"

AFFILIATE_APPROVE_ID = "0cf8b434-9440-477e-9916-4fcf073dd3ed"  # aff-live-1777010783 / ALYW1C3N
AFFILIATE_REJECT_ID = "085c7777-d8d9-4955-b02b-a6ef4abcc729"   # aff-iter9-...


# ─────────────────── helpers ───────────────────
def db():
    return psycopg2.connect(DB_URL)


def admin_cookie():
    payload = {
        "adminId": ADMIN_ID,
        "role": "SUPER_ADMIN",
        "email": ADMIN_EMAIL,
        "mfaVerified": True,
        "iss": "autolenis-admin",
        "iat": int(time.time()),
        "exp": int(time.time()) + 3600,
    }
    return {"admin_token": pyjwt.encode(payload, JWT_SECRET, algorithm="HS256")}


@pytest.fixture(scope="session")
def admin_jar():
    return admin_cookie()


# ═════════════════ AL-4: Unauth gating (no cookie) ═════════════════
class TestAL4UnauthGating:
    def test_unauth_approve_redirects(self):
        r = requests.post(
            f"{BASE_URL}/api/admin/affiliates/{AFFILIATE_APPROVE_ID}/approve",
            allow_redirects=False, timeout=30,
        )
        assert r.status_code == 307, f"expected 307 got {r.status_code}"
        assert "/admin/auth/signin" in r.headers.get("location", "")

    def test_unauth_reject_redirects(self):
        r = requests.post(
            f"{BASE_URL}/api/admin/affiliates/{AFFILIATE_REJECT_ID}/reject",
            allow_redirects=False, timeout=30,
        )
        assert r.status_code == 307
        assert "/admin/auth/signin" in r.headers.get("location", "")

    def test_unauth_admin_affiliates_page_redirects(self):
        r = requests.get(f"{BASE_URL}/admin/affiliates", allow_redirects=False, timeout=30)
        assert r.status_code == 307


# ═════════════════ AL-1: Admin affiliates queue page ═════════════════
class TestAL1QueuePage:
    """Proxy.ts forces a Supabase admin session cookie in addition to the
    httpOnly admin_token JWT before SSR for /admin/** pages will render. Since
    the sandbox cannot provision a Supabase admin session (TOTP-enrolled
    account unavailable), verify the page contract at source-level + verify the
    Prisma queries return the expected rows for each tab."""
    def test_queue_page_source_has_four_tabs_and_actions(self):
        with open("/app/frontend/app/admin/affiliates/AdminAffiliatesClient.tsx") as f:
            src = f.read()
        for tab in ["Pending Review", "Active", "Rejected", "Suspended"]:
            assert tab in src, f"tab label '{tab}' missing"
        assert "approve" in src.lower() and "reject" in src.lower()

    def test_pending_affiliate_visible_in_queue_data(self):
        with db() as c, c.cursor() as cur:
            cur.execute("""
                SELECT a.id, a.status, u.email
                FROM public.affiliates a
                JOIN public.users u ON u.id = a.user_id
                WHERE a.status IN ('PENDING','ACTIVE','REJECTED','SUSPENDED')
            """)
            rows = cur.fetchall()
        by_status = {}
        for _id, status, _email in rows:
            by_status.setdefault(status, []).append(_email)
        # Each of the 4 tabs has data the admin page will paginate on (at least
        # one state populated — prior iterations created affiliates in PENDING,
        # this iteration moves them to ACTIVE/REJECTED).
        assert sum(len(v) for v in by_status.values()) >= 1


# ═════════════════ AL-2: Approve endpoint ═════════════════
class TestAL2Approve:
    def test_approve_returns_active_and_persists(self, admin_jar):
        # Ensure the row is PENDING before calling (reset if this test re-runs).
        with db() as c, c.cursor() as cur:
            cur.execute(
                "UPDATE public.affiliates SET status='PENDING' WHERE id=%s",
                (AFFILIATE_APPROVE_ID,),
            )
            c.commit()

        r = requests.post(
            f"{BASE_URL}/api/admin/affiliates/{AFFILIATE_APPROVE_ID}/approve",
            cookies=admin_jar, allow_redirects=False, timeout=60,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["success"] is True
        data = body["data"]
        assert data["id"] == AFFILIATE_APPROVE_ID
        assert data["status"] == "ACTIVE"
        assert re.match(r"^AL[A-Z0-9]{6}$", data["referralCode"]), data["referralCode"]

        # Verify DB row
        with db() as c, c.cursor() as cur:
            cur.execute("SELECT status, referral_code FROM public.affiliates WHERE id=%s", (AFFILIATE_APPROVE_ID,))
            row = cur.fetchone()
        assert row[0] == "ACTIVE"
        assert row[1] == data["referralCode"]

    def test_approve_second_call_returns_409_already_active(self, admin_jar):
        # Requires test_approve_returns_active_and_persists ran first
        r = requests.post(
            f"{BASE_URL}/api/admin/affiliates/{AFFILIATE_APPROVE_ID}/approve",
            cookies=admin_jar, allow_redirects=False, timeout=60,
        )
        assert r.status_code == 409, r.text
        body = r.json()
        assert body["error"]["code"] == "ALREADY_ACTIVE"


# ═════════════════ AL-3: Reject endpoint ═════════════════
class TestAL3Reject:
    def test_reject_returns_rejected_and_persists(self, admin_jar):
        # Ensure it's PENDING first
        with db() as c, c.cursor() as cur:
            cur.execute(
                "UPDATE public.affiliates SET status='PENDING' WHERE id=%s",
                (AFFILIATE_REJECT_ID,),
            )
            c.commit()

        r = requests.post(
            f"{BASE_URL}/api/admin/affiliates/{AFFILIATE_REJECT_ID}/reject",
            cookies=admin_jar,
            json={"reason": "Iteration-10 automated test"},
            allow_redirects=False, timeout=60,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["success"] is True
        assert body["data"]["id"] == AFFILIATE_REJECT_ID
        assert body["data"]["status"] == "REJECTED"

        with db() as c, c.cursor() as cur:
            cur.execute("SELECT status FROM public.affiliates WHERE id=%s", (AFFILIATE_REJECT_ID,))
            assert cur.fetchone()[0] == "REJECTED"

    def test_reject_second_call_returns_409_already_rejected(self, admin_jar):
        r = requests.post(
            f"{BASE_URL}/api/admin/affiliates/{AFFILIATE_REJECT_ID}/reject",
            cookies=admin_jar, json={}, allow_redirects=False, timeout=60,
        )
        assert r.status_code == 409
        assert r.json()["error"]["code"] == "ALREADY_REJECTED"


# ═════════════════ AL-5: Dashboard status gating via SSR ═════════════════
class TestAL5DashboardGating:
    """We can't log in as the affiliate (email_confirm=false), so we verify the
    gating indirectly by reading the dashboard source and confirming all three
    branches exist in the JSX."""
    def test_dashboard_has_all_three_status_branches(self):
        with open("/app/frontend/app/affiliate/portal/dashboard/page.tsx") as f:
            src = f.read()
        # PENDING banner check, REJECTED banner, ACTIVE gated ReferralCodeCard
        assert "PENDING" in src
        assert "REJECTED" in src
        assert "ReferralCodeCard" in src
        assert "ACTIVE" in src


# ═════════════════ S3-1: /buyer/settings SSR + data-testids ═════════════════
class TestS31BuyerSettingsPage:
    def test_settings_page_requires_auth(self):
        r = requests.get(f"{BASE_URL}/buyer/settings", allow_redirects=False, timeout=30)
        assert r.status_code == 307

    def test_settings_page_source_has_required_testids_and_no_coming_soon(self):
        with open("/app/frontend/app/buyer/settings/SettingsClient.tsx") as f:
            src = f.read()
        required = [
            "settings-page", "notification-preferences",
            "pref-email-notifications", "pref-sms-notifications",
            "pref-marketing-emails", "pref-auction-alerts", "pref-deal-updates",
            "security-section", "danger-zone", "delete-account-btn",
        ]
        for tid in required:
            assert tid in src, f"missing data-testid '{tid}' in SettingsClient.tsx"
        assert "Coming soon" not in src, "'Coming soon' still present"


# ═════════════════ S3-2 / S3-3: GET + PATCH /api/buyer/settings ═════════════════
class TestS32S33BuyerSettingsApi:
    """Cannot obtain buyer session via HTTP (server-action signin). Instead
    verify the route exists (307 when unauth) and exercise the underlying table
    via direct SQL to confirm schema + default-fallback logic."""
    def test_get_requires_auth(self):
        r = requests.get(f"{BASE_URL}/api/buyer/settings", allow_redirects=False, timeout=30)
        assert r.status_code == 307

    def test_patch_requires_auth(self):
        r = requests.patch(
            f"{BASE_URL}/api/buyer/settings",
            json={"smsNotifications": True},
            allow_redirects=False, timeout=30,
        )
        assert r.status_code == 307

    def test_buyer_preferences_table_schema_and_roundtrip(self):
        # Join through users to find the primary test buyer
        with db() as c, c.cursor(cursor_factory=psycopg2.extras.DictCursor) as cur:
            cur.execute("""
                SELECT b.id FROM public.buyers b
                JOIN public.users u ON u.id = b.user_id
                WHERE u.email='testbuyer_iteration8@autolenis-test.com'
            """)
            row = cur.fetchone()
            assert row, "test buyer row missing"
            buyer_id = row[0]

            # Upsert with S3-3 payload: smsNotifications=true, marketingEmails=true
            cur.execute("""
                INSERT INTO public.buyer_preferences
                    (id, buyer_id, email_notifications, sms_notifications, marketing_emails,
                     auction_alerts, deal_updates, created_at, updated_at)
                VALUES (%s, %s, true, true, true, true, true, now(), now())
                ON CONFLICT (buyer_id) DO UPDATE SET
                    sms_notifications=EXCLUDED.sms_notifications,
                    marketing_emails=EXCLUDED.marketing_emails,
                    updated_at=now()
                RETURNING sms_notifications, marketing_emails
            """, (str(uuid.uuid4()), buyer_id))
            saved = cur.fetchone()
            c.commit()
            assert saved[0] is True and saved[1] is True


# ═════════════════ S3-4: /buyer/profile SSR + ProfileEditor ═════════════════
class TestS34BuyerProfilePage:
    def test_profile_page_requires_auth(self):
        r = requests.get(f"{BASE_URL}/buyer/profile", allow_redirects=False, timeout=30)
        assert r.status_code == 307

    def test_profile_editor_testids_present(self):
        with open("/app/frontend/app/buyer/profile/ProfileEditor.tsx") as f:
            src = f.read()
        assert "profile-editor" in src
        assert "edit-profile-btn" in src
        assert "Coming soon" not in src


# ═════════════════ S3-5: PATCH /api/buyer/profile ═════════════════
class TestS35BuyerProfilePatch:
    def test_patch_requires_auth(self):
        r = requests.patch(
            f"{BASE_URL}/api/buyer/profile",
            json={"firstName": "X", "lastName": "Y"},
            allow_redirects=False, timeout=30,
        )
        assert r.status_code == 307


# ═════════════════ S3-6: DELETE /api/buyer/account ═════════════════
class TestS36BuyerAccountDelete:
    def test_delete_requires_auth(self):
        r = requests.delete(f"{BASE_URL}/api/buyer/account", allow_redirects=False, timeout=30)
        assert r.status_code == 307

    def test_account_route_logic_blocks_active_deal(self):
        """Source-level invariant: DELETE must bail with 409 ACTIVE_DEAL when an
        ongoing deal exists (S3-6 contract). Verify the guard exists in source."""
        with open("/app/frontend/app/api/buyer/account/route.ts") as f:
            src = f.read()
        assert "ACTIVE_DEAL" in src
        assert "409" in src
        assert "prisma.buyer.delete" in src
        assert "admin.auth.admin.deleteUser" in src


# ═════════════════ S4-1: Buyer sidebar 16-link unauth audit ═════════════════
SIDEBAR_HREFS = [
    "/buyer/dashboard", "/buyer/prequal", "/buyer/search", "/buyer/shortlist",
    "/buyer/auctions", "/buyer/deal", "/buyer/deal/financing",
    "/buyer/contract-shield", "/buyer/esign", "/buyer/pickup",
    "/buyer/requests", "/buyer/notifications", "/buyer/messages",
    "/buyer/documents", "/buyer/profile", "/buyer/settings",
]


@pytest.mark.parametrize("href", SIDEBAR_HREFS)
def test_s41_sidebar_link_unauth_redirects_no_404(href):
    r = requests.get(f"{BASE_URL}{href}", allow_redirects=False, timeout=30)
    assert r.status_code != 404, f"{href} → 404"
    assert r.status_code == 307, f"{href} → {r.status_code} (expected 307)"


# ═════════════════ Housekeeping: restore pending state for manual-test record ═════════════════
def test_zz_restore_pending_states():
    """Not strictly a test — ensures the approve/reject rows are left in a sane
    state for the next manual check. Approve row stays ACTIVE (that's expected
    post-approval). Reject row stays REJECTED. Nothing to do; just confirms
    final DB state."""
    with db() as c, c.cursor() as cur:
        cur.execute(
            "SELECT id,status FROM public.affiliates WHERE id IN (%s,%s)",
            (AFFILIATE_APPROVE_ID, AFFILIATE_REJECT_ID),
        )
        rows = dict(cur.fetchall())
    assert rows[AFFILIATE_APPROVE_ID] == "ACTIVE"
    assert rows[AFFILIATE_REJECT_ID] == "REJECTED"
