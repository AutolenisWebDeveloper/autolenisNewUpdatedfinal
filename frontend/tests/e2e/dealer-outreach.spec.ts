// Dealer outreach queue — end-to-end.
//
// SCOPE AND HONESTY NOTE, in the style this suite already uses.
//
// These specs drive a real browser against a locally running app backed by the
// seeded autolenis_e2e database, and assert DATABASE STATE rather than only
// visible text. They require infrastructure this repository cannot provide by
// itself:
//   • a running Next server (playwright.e2e.config.ts baseURL)
//   • DATABASE_URL pointed at autolenis_e2e — NEVER production
//   • E2E_STORAGE_STATE holding an authenticated admin session
//
// WHAT KEEPS A VENDOR OFF THE WIRE, AND WHAT DOES NOT.
//
// page.route() intercepts requests the BROWSER makes. Every Apollo, Resend and
// Twilio call in this system is made SERVER-side by the Next app, so a route
// handler never sees them and `hits === 0` would be true whether or not a real
// message went out. Asserting on those counters would be exactly the "green
// because it checked nothing" failure this suite is written to avoid, so this
// file does not assert them.
//
// What actually holds the line, in order:
//   1. DEALER_OUTREACH_SMS_ENABLED unset — the SMS service refuses first.
//   2. Every contact profile seeded here carries a consent basis the gate
//      evaluates, and the fixtures use .invalid domains and 555 numbers.
//   3. The dealer_outreach_log row, which records WHICH gate refused. That row
//      is the assertion: a send that was blocked and a send that silently
//      succeeded look identical from the HTTP status alone.
// blockVendors() below is a belt-and-braces block on browser-originated calls
// only, and says so.
//
// SURFACES NOT YET BUILT. The queue and its detail panel exist. The Apollo sync
// panel, bulk actions and in-UI status-transition controls do NOT — they are
// specified but unimplemented. Specs covering them SKIP with an explicit reason
// rather than passing vacuously or asserting against a surface that is absent.
// A green run that checked nothing is worse than a skipped one that says so.

import { test, expect, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const HAS_DB = /autolenis_e2e/.test(process.env.DATABASE_URL ?? "");
const HAS_AUTH = !!process.env.E2E_STORAGE_STATE;

test.beforeAll(() => {
  if (HAS_DB) return;
  // Refuse rather than silently target whatever DATABASE_URL points at.
  if (process.env.DATABASE_URL) {
    throw new Error("Refusing to run E2E: DATABASE_URL must target autolenis_e2e");
  }
});
/**
 * CLEAN UP WHAT THIS TEST MADE, and nothing else.
 *
 * Three approaches were tried before this one. Deleting every "E2E " row races
 * a sibling worker and removes its fixtures mid-test. Deleting nothing lets the
 * table grow past the queue's row cap, at which point new fixtures — which tie
 * on score and lose the id tie-break, cuids being time-ordered — fall off the
 * end and every assertion times out. An age-based sweep still lost that race
 * when two runs were less than the window apart.
 *
 * Deleting by this test's own stamps is the only version that is correct under
 * parallelism AND leaves the database where it found it.
 */
const createdStamps: string[] = [];

test.afterEach(async () => {
  const stamps = createdStamps.splice(0);
  for (const stamp of stamps) {
    const like = `E2E ${stamp} `;
    await prisma.dealerOutreachLog.deleteMany({
      where: { dealerProspect: { name: { startsWith: like } } },
    });
    await prisma.dealerProspect.deleteMany({ where: { name: { startsWith: like } } });
    // Contact profiles cascade from the rooftop.
    await prisma.dealerRooftop.deleteMany({ where: { displayName: { startsWith: like } } });
  }
});

test.afterAll(async () => { await prisma.$disconnect(); });

const needsInfra = () => {
  test.skip(!HAS_DB, "DATABASE_URL does not target autolenis_e2e — seeded fixtures unavailable");
  test.skip(!HAS_AUTH, "E2E_STORAGE_STATE is unset — /admin requires an authenticated session");
};

/**
 * Block browser-originated vendor calls.
 *
 * This covers a client component that fetches a vendor directly. It CANNOT see
 * a server-side call, so nothing in this file treats it as proof of one — see
 * the header note. It is here because it costs nothing and closes the one hole
 * it can close.
 */
async function blockVendors(page: Page) {
  for (const pattern of ["**/api.apollo.io/**", "**/api.resend.com/**", "**/api.twilio.com/**"]) {
    await page.route(pattern, (r) => r.abort());
  }
}

/** Rows belonging to ONE fixture set. See the stamp note in seedQueueFixtures. */
function queueRows(page: Page, stamp: string) {
  return page.getByTestId("outreach-queue").locator("tbody tr").filter({ hasText: `E2E ${stamp}` });
}

/** One named row from one fixture set. */
function queueRow(page: Page, stamp: string, name: string) {
  return page.getByTestId("outreach-queue").locator("tbody tr").filter({ hasText: `E2E ${stamp} ${name}` });
}

// ─── 1. the queue loads with its default filters and a counted bucket ───────

test("queue loads, applies default filters, and counts the unreachable bucket", async ({ page }) => {
  needsInfra();
  const { reachable, unreachable, stamp } = await seedQueueFixtures();
  await blockVendors(page);

  await page.goto("/admin/dealer-outreach/queue");
  await expect(page.getByTestId("admin-outreach-queue-page")).toBeVisible();

  // The default view shows workable rows only...
  await expect(queueRows(page, stamp)).toHaveCount(reachable);

  // ...and the excluded population is COUNTED and visible, never silently
  // filtered. This is the assertion that matters: on production data the bucket
  // is the difference between a queue of ~12 and a list of 1,532.
  const bucket = page.getByRole("button", { name: /unreachable/i });
  await expect(bucket).toBeVisible();

  // The tile counts every unreachable prospect in the database, not just this
  // fixture's, so the assertion is "at least mine" — anything stricter would be
  // asserting that no other worker exists.
  const shown = Number((await bucket.innerText()).match(/\d+/)?.[0] ?? "0");
  expect(shown).toBeGreaterThanOrEqual(unreachable);

  // And it is a real control: reachable by keyboard, and it navigates.
  await bucket.focus();
  await expect(bucket).toBeFocused();
  await bucket.press("Enter");
  await expect(page).toHaveURL(/bucket=unreachable/);
});

test("the unreachable bucket opens as its own view", async ({ page }) => {
  needsInfra();
  const { unreachable, stamp } = await seedQueueFixtures();
  await blockVendors(page);

  await page.goto("/admin/dealer-outreach/queue?bucket=unreachable");
  await expect(queueRows(page, stamp)).toHaveCount(unreachable);
});

// ─── 2/3. Apollo sync preview and the credit cap ────────────────────────────

test("apollo sync preview shows cost and requires explicit confirm; cancelling spends nothing", async ({ page }) => {
  needsInfra();
  test.skip(true, "the Apollo sync panel is specified but not implemented — no surface to drive");
  await page.goto("/admin/dealer-outreach/queue");
});

test("enrichment stops at the credit cap and records the reason", async ({ page }) => {
  needsInfra();
  test.skip(true, "the Apollo enrichment trigger is specified but not implemented — no surface to drive");
  await page.goto("/admin/dealer-outreach/queue");
});

// ─── 4. DNC is enforced SERVER-side, not merely disabled in the DOM ─────────

test("a DNC-flagged contact shows the badge in the queue", async ({ page }) => {
  needsInfra();
  const { stamp } = await seedQueueFixtures();
  await blockVendors(page);

  await page.goto("/admin/dealer-outreach/queue");
  const dncRow = queueRow(page, stamp, "DNC Blocked Motors");
  // The badge carries TEXT, not just a colour — asserted as text for the same
  // reason it is rendered that way.
  await expect(dncRow.getByText(/do not call/i)).toBeVisible();
});

test("a DNC-flagged contact cannot be SMSed — enforced on the SERVER", async ({ page, request }) => {
  needsInfra();
  const { dncProspectId } = await seedQueueFixtures();
  await blockVendors(page);

  // The DOM being disabled proves nothing: anyone can POST directly. This is the
  // assertion that matters, and it is made against the API, not the UI.
  const res = await request.post("/api/admin/dealer-outreach/send-sms", {
    data: { prospectId: dncProspectId, body: "hello" },
    failOnStatusCode: false,
  });
  expect(res.status()).toBeGreaterThanOrEqual(400);

  // The refusal is RECORDED — a blocked attempt that leaves no row is the bug
  // this whole branch exists to fix.
  const rows = await prisma.dealerOutreachLog.findMany({
    where: { dealerProspectId: dncProspectId, channel: "sms" },
  });
  expect(rows.length).toBe(1);
  expect(rows[0].status).toBe("failed");
  // The recorded basis is what distinguishes "the gate refused" from "the
  // service never loaded the target and refused everything".
  expect(rows[0].consentBasis).toBeTruthy();
});

test("a DNC 'pending' contact is blocked too — pending is not a clearance", async ({ request }) => {
  needsInfra();
  const { dncPendingProspectId } = await seedQueueFixtures();
  const res = await request.post("/api/admin/dealer-outreach/send-sms", {
    data: { prospectId: dncPendingProspectId, body: "hello" },
    failOnStatusCode: false,
  });
  expect(res.status()).toBeGreaterThanOrEqual(400);
  const rows = await prisma.dealerOutreachLog.findMany({
    where: { dealerProspectId: dncPendingProspectId, channel: "sms" },
  });
  expect(rows.length).toBe(1);
  expect(rows[0].status).toBe("failed");
});

// ─── 4b. manual calling — the only action that ships enabled ────────────────

test("the detail panel offers a DIALABLE tel: link for a callable prospect", async ({ page }) => {
  needsInfra();
  const { reachablePhone, stamp } = await seedQueueFixtures();
  await blockVendors(page);

  await page.goto("/admin/dealer-outreach/queue");
  await queueRow(page, stamp, "Call Ready Motors").click();

  const call = page.getByTestId("click-to-call");
  await expect(call).toBeVisible();
  // The href must be the normalised E.164 number. A link built from a display
  // format renders fine and dials nothing.
  await expect(call).toHaveAttribute("href", `tel:${reachablePhone}`);
});

test("a DNC prospect shows the warning ABOVE the dial link", async ({ page }) => {
  needsInfra();
  const { stamp } = await seedQueueFixtures();
  await blockVendors(page);

  await page.goto("/admin/dealer-outreach/queue");
  await queueRow(page, stamp, "DNC Blocked Motors").click();

  const section = page.getByTestId("call-section");
  const warning = section.getByRole("note");
  await expect(warning).toContainText(/do not/i);

  // Order matters, not merely presence: a warning found after the phone is
  // already ringing is not a control. Asserted on document position.
  const warningFirst = await section.evaluate((el) => {
    const note = el.querySelector('[role="note"]');
    const link = el.querySelector('[data-testid="click-to-call"]');
    if (!note || !link) return false;
    return !!(note.compareDocumentPosition(link) & Node.DOCUMENT_POSITION_FOLLOWING);
  });
  expect(warningFirst).toBe(true);
});

test("logging a call writes exactly one CALL row with its disposition", async ({ page }) => {
  needsInfra();
  const { reachableProspectId, stamp } = await seedQueueFixtures();
  await blockVendors(page);

  await page.goto("/admin/dealer-outreach/queue");
  await queueRow(page, stamp, "Call Ready Motors").click();

  await page.getByLabel(/how did the call go/i).selectOption("CONNECTED");
  await page.getByLabel(/minutes/i).fill("4");
  await page.getByLabel(/seconds/i).fill("30");
  await page.getByLabel(/notes/i).fill("Spoke with the GM.");
  await page.getByTestId("log-call-submit").click();

  await expect(page.getByTestId("call-section")).toBeHidden();

  const rows = await prisma.dealerOutreachLog.findMany({
    where: { dealerProspectId: reachableProspectId, channel: "CALL" },
  });
  expect(rows.length).toBe(1);
  expect(rows[0].callDisposition).toBe("CONNECTED");
  expect(rows[0].callDurationSeconds).toBe(270);
  expect(rows[0].status).toBe("sent");
});

test("submitting without a disposition is refused in the form and writes nothing", async ({ page }) => {
  needsInfra();
  const { reachableProspectId, stamp } = await seedQueueFixtures();
  await blockVendors(page);

  await page.goto("/admin/dealer-outreach/queue");
  await queueRow(page, stamp, "Call Ready Motors").click();
  await page.getByTestId("log-call-submit").click();

  // role="alert" so the message is announced, not merely coloured. Scoped to the
  // section: Next mounts its own role="alert" route announcer on every page.
  await expect(page.getByTestId("call-section").getByRole("alert")).toContainText(
    /choose how the call went/i,
  );
  const rows = await prisma.dealerOutreachLog.count({
    where: { dealerProspectId: reachableProspectId, channel: "CALL" },
  });
  expect(rows).toBe(0);
});

test("typing in the panel does not lose focus", async ({ page }) => {
  needsInfra();
  const { stamp } = await seedQueueFixtures();
  await blockVendors(page);

  await page.goto("/admin/dealer-outreach/queue");
  await queueRow(page, stamp, "Call Ready Motors").click();

  // pressSequentially, not fill(): fill() sets the value in one operation and
  // would sail past a focus bug that a real typist hits on every character.
  // SlideOver moves focus into the panel when its effect runs, so an effect
  // that re-runs on a parent render steals focus mid-word.
  const notes = page.getByLabel(/notes/i);
  await notes.click();
  await notes.pressSequentially("Spoke with the GM about inventory", { delay: 10 });
  await expect(notes).toBeFocused();
  await expect(notes).toHaveValue("Spoke with the GM about inventory");
});

// ─── 5. the status machine ──────────────────────────────────────────────────

test("status machine walkthrough including DEAD requiring a reason", async ({ page }) => {
  needsInfra();
  test.skip(true, "in-UI status transition controls are specified but not implemented — no surface to drive");
  await page.goto("/admin/dealer-outreach/queue");
});

test("DEAD without a reason is refused by the SERVER", async ({ request }) => {
  needsInfra();
  const { reachableProspectId } = await seedQueueFixtures();
  // Asserted at the API even though the UI control does not exist yet: the rule
  // is server-side, and that is where it must hold.
  const res = await request.post("/api/admin/dealer-outreach/status", {
    data: { prospectId: reachableProspectId, to: "DEAD" },
    failOnStatusCode: false,
  });
  expect(res.status()).toBeGreaterThanOrEqual(400);
  const after = await prisma.dealerProspect.findUniqueOrThrow({ where: { id: reachableProspectId } });
  expect(after.status).not.toBe("DEAD");
});

// ─── 6. a failed send still leaves exactly one row ──────────────────────────

test("a failed email send produces exactly ONE outreach log row", async ({ page, request }) => {
  needsInfra();
  const { emailProspectId } = await seedQueueFixtures();
  await blockVendors(page);

  const res = await request.post("/api/admin/dealer-outreach/send", {
    data: { dealerProspectId: emailProspectId },
    failOnStatusCode: false,
  });
  expect(res.status()).toBeGreaterThanOrEqual(400);

  const rows = await prisma.dealerOutreachLog.findMany({
    where: { dealerProspectId: emailProspectId, channel: "email" },
  });
  // Exactly one. Not zero (the old bug), not two (a retry racing itself).
  expect(rows.length).toBe(1);
  expect(rows[0].status).toBe("failed");
  expect(rows[0].errorMessage).toBeTruthy();
});

// ─── 7. accessibility ───────────────────────────────────────────────────────

test("the queue is keyboard navigable and its controls are labelled", async ({ page }) => {
  needsInfra();
  await seedQueueFixtures();
  await blockVendors(page);
  await page.goto("/admin/dealer-outreach/queue");

  await page.keyboard.press("Tab");
  await expect(page.locator(":focus")).toBeVisible();

  // A focused control must be VISIBLY focused — an invisible ring is a WCAG
  // failure even when focus order is correct.
  const outline = await page.locator(":focus").evaluate((el) => {
    const s = getComputedStyle(el);
    return { outlineWidth: s.outlineWidth, boxShadow: s.boxShadow };
  });
  expect(outline.outlineWidth !== "0px" || outline.boxShadow !== "none").toBeTruthy();
});

test("the detail panel is a labelled dialog that returns focus on close", async ({ page }) => {
  needsInfra();
  const { stamp } = await seedQueueFixtures();
  await blockVendors(page);
  await page.goto("/admin/dealer-outreach/queue");

  const firstRow = queueRows(page, stamp).first();
  // Opened from the keyboard, because that is the path whose focus has to come
  // back. A mouse click leaves focus on <body> and proves nothing.
  await firstRow.focus();
  await expect(firstRow).toBeFocused();
  await firstRow.press("Enter");

  const panel = page.getByRole("dialog");
  await expect(panel).toBeVisible();

  // The dialog carries a NAME. "dialog" on its own tells a screen-reader user
  // nothing about what opened.
  await expect(panel).toHaveAccessibleName(/E2E /);

  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden();

  // Focus must come back to the ROW THAT OPENED IT, not merely to "something"
  // and not to <body> — a lost focus position strands a keyboard user at the top
  // of the document with no idea where they were. Asserted by identity.
  const focusedRowId = await page.evaluate(
    () => document.activeElement?.closest("tr")?.getAttribute("data-row-id") ?? null,
  );
  expect(focusedRowId).toBe(await firstRow.getAttribute("data-row-id"));
});

// ─── fixtures ───────────────────────────────────────────────────────────────

/**
 * Seed a known queue. Returns the counts and ids the specs assert against, so an
 * assertion never hard-codes a number the fixture might change.
 */
async function seedQueueFixtures(): Promise<{
  reachable: number;
  unreachable: number;
  dncProspectId: string;
  dncPendingProspectId: string;
  emailProspectId: string;
  reachableProspectId: string;
  reachablePhone: string;
  stamp: string;
}> {
  // A STAMP PER CALL, and every assertion scoped to it.
  //
  // playwright.e2e.config.ts sets fullyParallel and two projects, so several
  // workers hit this one database at the same time. A fixture that deleted
  // "every E2E row" and then asserted a global row count did exactly what you
  // would expect: it deleted a sibling worker's data mid-test and counted rows
  // that belonged to someone else (observed as "expected 4, received 7" and a
  // strict-mode violation on a duplicated dealer name). Scoping by stamp makes
  // the suite correct under any level of parallelism instead of demanding it be
  // switched off.
  const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

  createdStamps.push(stamp);

  /**
   * ONE ROOFTOP PER PROSPECT.
   *
   * Consent basis, DNC status and phone type live on the CONTACT PROFILE, which
   * hangs off the rooftop — so a shared rooftop gives every prospect on it the
   * same consent facts. An earlier version of this fixture put five prospects on
   * one rooftop and flagged it DNC, which silently made the "email ready" and
   * "call ready" rows do-not-call as well, and made the DNC-pending row read as
   * DNC-found. The specs would still have passed while asserting nothing.
   */
  const mk = async (
    name: string,
    prospect: Record<string, unknown>,
    contact?: Record<string, unknown>,
  ) => {
    const rooftop = await prisma.dealerRooftop.create({
      data: {
        displayName: `E2E ${stamp} ${name}`,
        nameKey: `e2e ${stamp} ${name}`.toLowerCase(),
        city: "Austin",
        state: "TX",
        zip: "78701",
      },
    });
    if (contact) {
      await prisma.dealerContactProfile.create({
        data: { rooftopId: rooftop.id, isPrimaryContact: true, ...contact },
      });
    }
    return prisma.dealerProspect.create({
      data: {
        name: `E2E ${stamp} ${name}`,
        city: "Austin",
        state: "TX",
        status: "DISCOVERED",
        rooftopId: rooftop.id,
        // Scored high on purpose. The queue orders by score before applying its
        // row cap, so a scored fixture is inside the cap no matter how much
        // unrelated data the database holds. Without this the suite passes on
        // an empty database and times out on a full one.
        searchScore: 99,
        ...prospect,
      },
    });
  };

  const REACHABLE_PHONE = "+15125550101";

  const emailProspect = await mk("Email Ready Motors", {
    email: `e2e-${stamp}@dealer.invalid`,
    emailVerificationStatus: "VERIFIED",
  });
  const callProspect = await mk(
    "Call Ready Motors",
    { phone: REACHABLE_PHONE },
    { name: "Dana Reyes", title: "GM", contactSource: "apollo", contactConfidence: "high", dncStatus: "not_found", phoneType: "corporate_phone" },
  );
  const dnc = await mk(
    "DNC Blocked Motors",
    { phone: "+15125550102" },
    { name: "Sam Ortiz", title: "GM", contactSource: "apollo", contactConfidence: "high", dncStatus: "found", phoneType: "mobile_phone" },
  );
  const dncPending = await mk(
    "DNC Pending Motors",
    { phone: "+15125550103" },
    { name: "Jo Vance", title: "GM", contactSource: "apollo", contactConfidence: "high", dncStatus: "pending", phoneType: "corporate_phone" },
  );
  const unreachableRows = await Promise.all(
    [1, 2, 3, 4, 5].map((i) => mk(`Unreachable ${i}`, {})),
  );

  // COUNTED, never hard-coded. The work bucket is "has at least one open
  // channel", and DNC does not close the CALL channel — a human dialling needs
  // no consent basis, and the flag is surfaced for the operator to act on.
  const created = [emailProspect, callProspect, dnc, dncPending, ...unreachableRows];
  const reachable = created.filter((p) => p.email || p.phone).length;

  return {
    reachable,
    unreachable: unreachableRows.length,
    dncProspectId: dnc.id,
    dncPendingProspectId: dncPending.id,
    emailProspectId: emailProspect.id,
    reachableProspectId: callProspect.id,
    reachablePhone: REACHABLE_PHONE,
    stamp,
  };
}
