// BUILD-FAILING RULE — the §2 responsibility boundary.
//
//   "AutoLenis never: sells or takes title to a vehicle · collects a Social
//    Security number anywhere in the buy transaction · issues titles,
//    registrations, or temporary tags · releases a vehicle or substitutes for the
//    dealership's delivery obligations."
//
// This is the executable half of that sentence. §11.5 ruling 9 moved it out of
// Phase 1 — where it would have been a fourth enforcement object in a wave
// constrained to three — into Phase 2, so that every "you may not write this" rule
// lands together.
//
// TWO HALVES, AND THE SECOND IS THE ONE THAT BITES.
//
//   1. NO ISSUANCE SYMBOLS. AutoLenis may RECORD that the dealership issued a
//      title — `PostCompletionObligation.tempTagExpiresAt`,
//      `TradeInSubmission.titleInHand` — but it may never PERFORM issuance. The
//      distinction is the verb, so the rule forbids issuing verbs
//      (`issueTitle`, `issueRegistration`, `issuePlate`) and identity nouns
//      (`sellerOfRecord`, `takeTitle`), not the recording nouns that already exist.
//
//   2. THE ADMIN RELEASE ACTIONS ARE PINNED. §2 puts release on the dealership.
//      Three AutoLenis-actored paths can nonetheless drive a deal through pickup to
//      COMPLETED, and the parity ledger (`control/B2-03`) names only TWO of them —
//      `app/api/admin/buyers/[buyerId]/journey/complete/route.ts` with
//      `stageId: "pickup"` performs the same writes and is unnamed there. A rule
//      that pinned exactly two would have left the third unpinned, which is how a
//      guard becomes a false assurance. All three are pinned here, and a FOURTH
//      fails the build.
//
//      Pinning means: role-gated, reason required, audit row AWAITED. Two of the
//      three wrote their audit row best-effort (`.catch(() => {})`) until this
//      phase — an AutoLenis-actored release could succeed with no trace, which
//      makes "pinned to the audited path" untrue. Both now await it.
//
//      The BEHAVIOURAL split — release evidence writable only by a
//      dealer-authenticated action, possession only by the buyer — is
//      `control/B2-03` and lands in Phase 9. This rule holds the line until then.
//
// Run: pnpm test:security

import test from "node:test";
import assert from "node:assert/strict";
import { sourceFiles, read, findAll, format, assertScanned } from "@/lib/testing/source-scan";

const ROOT = process.cwd();
const ROOTS = ["app", "lib", "components"] as const;

/**
 * Issuance and seller-of-record constructs. VERBS and IDENTITY nouns only —
 * recording that the dealership did something is explicitly allowed by §2 and is
 * how AutoLenis "proves every checkpoint was met" (§35).
 */
const FORBIDDEN = [
  /\bissueTitle\b/,
  /\bissueRegistration\b/,
  /\bissuePlate\b/,
  /\bissueTemporaryTag\b/,
  /\bissueTempTag\b/,
  /\bsellerOfRecord\b/,
  /\bseller_of_record\b/,
  /\btakeTitle\b/,
  /\btakesTitle\b/,
  /\btitleHolder\b/,
  /\bautolenisSells\b/,
  /\bplatformIsSeller\b/,
];

/**
 * The three AutoLenis-actored paths that can complete a pickup. Every one must be
 * role-gated, demand a reason, and await its audit row.
 */
const PINNED_RELEASE_ACTIONS = [
  "app/api/admin/deals/[dealId]/pickup/complete/route.ts",
  "app/api/admin/buyers/[buyerId]/journey/complete-all/route.ts",
  "app/api/admin/buyers/[buyerId]/journey/complete/route.ts",
] as const;

test("no code path makes AutoLenis the seller of record or issues a title, registration or tag", () => {
  const files = sourceFiles(ROOT, [...ROOTS]);
  assertScanned(files, 800, "role-boundary-frozen");

  const offenders: string[] = [];
  for (const pattern of FORBIDDEN) {
    offenders.push(...format(findAll(ROOT, files, pattern)).map((h) => `${h} [${pattern.source}]`));
  }

  assert.deepEqual(
    offenders,
    [],
    "§2: AutoLenis never sells or takes title to a vehicle, and never issues titles, registrations or " +
      "temporary tags. RECORDING that the dealership did so is fine and already exists " +
      "(PostCompletionObligation.tempTagExpiresAt, TradeInSubmission.titleInHand) — PERFORMING it is not. " +
      `Offenders: ${offenders.join(", ")}`
  );
});

test("exactly three AutoLenis-actored paths can complete a pickup, and no more", () => {
  const files = sourceFiles(ROOT, ["app/api/admin"]);
  assertScanned(files, 100, "role-boundary release scan");

  // A path "completes a pickup" when it writes Pickup COMPLETED. That write is the
  // structural signature; the route's name is not.
  const candidates = files.filter((f) => {
    const src = read(ROOT, f);
    return /\bpickup\.(?:update|upsert|updateMany|create)\s*\(/.test(src) && /"COMPLETED"|'COMPLETED'/.test(src);
  });

  assert.deepEqual(
    candidates.sort(),
    [...PINNED_RELEASE_ACTIONS].sort(),
    "A new AutoLenis-actored path can complete a pickup. §2 puts release on the dealership: " +
      "release evidence belongs to a dealer-authenticated action and possession confirmation to the buyer " +
      "(control/B2-03, Phase 9). Adding a fourth admin path widens the boundary this rule exists to hold."
  );
});

test("every pinned release action is role-gated, demands a reason, and AWAITS its audit row", () => {
  for (const file of PINNED_RELEASE_ACTIONS) {
    const src = read(ROOT, file);

    assert.match(src, /SUPER_ADMIN/, `${file}: release must be role-gated`);
    assert.ok(
      /OPERATIONS_ADMIN/.test(src),
      `${file}: release must be restricted to OPERATIONS_ADMIN or SUPER_ADMIN`
    );
    assert.ok(
      /reason|note/.test(src),
      `${file}: an override with no stated reason is an unexplained release`
    );

    // The audit write must not be swallowed. `.catch(() => {})` on the audit row
    // means a release can succeed with no trace, which is precisely what "pinned to
    // the audited path" is supposed to rule out.
    const auditWrites = [...src.matchAll(/adminAuditLog\.create\s*\(/g)];
    assert.ok(auditWrites.length > 0 || /createAuditLog\s*\(/.test(src), `${file}: release must write an audit row`);
    assert.ok(
      !/adminAuditLog\.create\s*\(\{[\s\S]*?\}\s*\)\s*\.catch\s*\(/.test(src),
      `${file}: the audit row must be AWAITED, never best-effort — an unrecorded release is an unaudited one`
    );
    assert.ok(
      !/createAuditLog\s*\([\s\S]{0,400}?\)\s*\.catch\s*\(/.test(src),
      `${file}: the audit row must be AWAITED, never best-effort`
    );
  }
});

test("the rule detects a real violation — proved against planted source", () => {
  // A guard that cannot fail passes forever. These exercise the same matchers the
  // assertions above use.
  const planted = `export async function issueTitle(dealId: string) { return { sellerOfRecord: "AutoLenis" }; }`;
  const hits = FORBIDDEN.filter((p) => p.test(planted));
  assert.equal(hits.length, 2, "both the issuing verb and the seller-of-record identity must be caught");

  const recording = `const obligation = { tempTagExpiresAt: date, titleInHand: true, titleState: "TX" };`;
  assert.deepEqual(
    FORBIDDEN.filter((p) => p.test(recording)),
    [],
    "RECORDING what the dealership did must never trip the rule — §2 requires AutoLenis to track exactly this"
  );

  const swallowed = `await prisma.adminAuditLog.create({ data: { action: "X" } }).catch(() => {});`;
  assert.ok(
    /adminAuditLog\.create\s*\(\{[\s\S]*?\}\s*\)\s*\.catch\s*\(/.test(swallowed),
    "the best-effort-audit matcher must see a swallowed audit write"
  );
});
