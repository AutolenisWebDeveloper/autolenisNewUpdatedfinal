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

/**
 * THE COMPLETING ENTRY POINTS, DERIVED FROM THE SERVICE — NOT LISTED HERE.
 *
 * This detector has now gone blind twice for the same reason, and the second time is why it
 * stopped being a list of names. §8.2 defect (4) collapsed five Deal-completion writers into
 * `pickup-completion.service.ts`. Each route that moved onto the service stopped matching the
 * signature the test knew about — first `admin/deals/[dealId]/pickup/complete` when it stopped
 * upserting the Pickup itself, then both journey routes when they stopped calling
 * `confirmPossession` directly and started calling `completeJourneyPickup`. Each time, the scan
 * silently found fewer routes than the pinned list, and each time the easy fix — shrink the
 * pinned list, or bolt on one more literal — would have left every FUTURE route that completes
 * through the service invisible to the boundary this test exists to hold.
 *
 * So the set is computed from the service's own source: seed with the functions that write the
 * Deal to COMPLETED, then take the fixpoint over calls between them. A new completing export,
 * or a new wrapper around an existing one, is picked up without editing this file.
 */
const COMPLETION_SERVICE = "lib/services/pickup/pickup-completion.service.ts";

function completingEntryPoints(): string[] {
  const src = read(ROOT, COMPLETION_SERVICE);

  // Top-level exported functions, name → body (to the next declaration).
  const starts: { name: string; at: number }[] = [];
  for (const m of src.matchAll(/^export\s+(?:async\s+)?function\s+([A-Za-z0-9_$]+)/gm)) {
    starts.push({ name: m[1], at: m.index ?? 0 });
  }
  const bodies = new Map<string, string>();
  starts.forEach((s, i) => {
    bodies.set(s.name, src.slice(s.at, i + 1 < starts.length ? starts[i + 1].at : src.length));
  });

  // Seed: it writes the Deal (or the Pickup) to COMPLETED.
  const completing = new Set<string>();
  for (const [name, body] of bodies) {
    if (/status:\s*"COMPLETED"/.test(body)) completing.add(name);
  }

  // Fixpoint: calling something that completes, completes.
  for (let changed = true; changed; ) {
    changed = false;
    for (const [name, body] of bodies) {
      if (completing.has(name)) continue;
      if ([...completing].some((t) => new RegExp(`\\b${t}\\s*\\(`).test(body))) {
        completing.add(name);
        changed = true;
      }
    }
  }

  // ANTI-VACUITY, BOTH DIRECTIONS. An empty or all-inclusive derivation is the failure mode that
  // reads as coverage: the first detects nothing, the second flags every caller of the module and
  // gets deleted as noise. `recordDealerRelease` reaches HANDOVER_PENDING and stops, so it is the
  // control that proves the derivation discriminates rather than listing exports.
  assert.ok(bodies.size >= 3, `${COMPLETION_SERVICE}: parsed ${bodies.size} exported functions — the module shape changed and this derivation is no longer reading it`);
  assert.ok(completing.has("confirmPossession"), "the derivation found no function that writes the Deal to COMPLETED — it is scanning nothing");
  assert.ok(!completing.has("recordDealerRelease"), "recordDealerRelease records HANDOVER, not completion — a derivation that includes it is returning every export");

  return [...completing].sort();
}

test("exactly three AutoLenis-actored paths can complete a pickup, and no more", () => {
  const files = sourceFiles(ROOT, ["app/api/admin"]);
  assertScanned(files, 100, "role-boundary release scan");

  const entryPoints = completingEntryPoints();

  // A path "completes a pickup" when it writes Pickup COMPLETED itself — or, since Phase 9, when
  // it calls any of the service's completing entry points.
  const candidates = files.filter((f) => {
    const src = read(ROOT, f);
    const writesPickupComplete =
      /\bpickup\.(?:update|upsert|updateMany|create)\s*\(/.test(src) && /"COMPLETED"|'COMPLETED'/.test(src);
    const callsTheCompletionWriter = entryPoints.some((n) => new RegExp(`\\b${n}\\s*\\(`).test(src));
    return writesPickupComplete || callsTheCompletionWriter;
  });

  assert.deepEqual(
    candidates.sort(),
    [...PINNED_RELEASE_ACTIONS].sort(),
    "A new AutoLenis-actored path can complete a pickup. §2 puts release on the dealership: " +
      "release evidence belongs to a dealer-authenticated action and possession confirmation to the buyer " +
      `(control/B2-03, Phase 9). Completing entry points in force: ${entryPoints.join(", ")}. ` +
      "Adding a fourth admin path widens the boundary this rule exists to hold."
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
