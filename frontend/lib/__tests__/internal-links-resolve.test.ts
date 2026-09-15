// A BUILD-FAILING guard that every hard-coded internal link in the Phase 7 surfaces resolves to a
// route that exists in `app/`.
//
// Run with:  npx tsx --test lib/__tests__/internal-links-resolve.test.ts
//
// WHY THIS EXISTS, AND IT IS THE SECOND TIME. Phase 7 shipped five email CTAs pointing at
// `/buyer/deal/{dealId}` and `/buyer/deal/{dealId}/financing` — neither route exists. That was
// caught, fixed, and a guard was written for it. The guard read ONE FILE:
// `lib/services/comms/phase7-email-content.ts`. So when the identical dead prefix sat in a PAGE
// (`app/buyer/financing/page.tsx`, `href={`/buyer/deal/${deal.id}/financing`}`), the guard could
// not see it, and a review bot found it instead.
//
// The lesson is about the guard, not the link: a guard scoped to the file where a defect was first
// noticed only prevents that instance. This one is scoped to the CLASS — every `href` and
// `appUrl()` in the Phase 7 surfaces — so the next dead internal link fails the build wherever it
// is written.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { sourceFiles, assertScanned } from "@/lib/testing/source-scan";

const ROOT = process.cwd();

/** The trees this phase touches. Not the whole app — a guard that fails on unrelated legacy debt
 *  gets disabled, and a disabled guard protects nothing. */
const SCOPE = [
  "app/buyer/deal",
  "app/buyer/financing",
  "app/dealer/deals",
  "components/buyer",
  "components/dealer",
  "lib/services/comms",
] as const;

/** `href="/x"`, `href={`/x`}` and `appUrl("/x")` / `appUrl(`/x`)`. External links are skipped. */
const LINK = /(?:href=|appUrl\()\s*[{(]?\s*[`"'](\/[^`"'?#]*)/g;

/** Resolve one internal path against `app/`, treating `${...}` as one dynamic segment. */
function routeExists(raw: string): boolean {
  const clean = raw.replace(/\$\{[^}]*\}/g, "*").replace(/\/+$/, "") || "/";
  const segments = clean.split("/").filter(Boolean);
  let dir = `${ROOT}/app`;
  for (const seg of segments) {
    if (seg === "*") {
      const dyn = existsSync(dir) ? readdirSync(dir).find((d) => d.startsWith("[")) : undefined;
      if (!dyn) return false;
      dir = `${dir}/${dyn}`;
    } else {
      // A route group — `(public)` — is a directory that does not appear in the URL.
      if (existsSync(`${dir}/${seg}`)) dir = `${dir}/${seg}`;
      else {
        const grouped = existsSync(dir)
          ? readdirSync(dir).find((d) => d.startsWith("(") && existsSync(`${dir}/${d}/${seg}`))
          : undefined;
        if (!grouped) return false;
        dir = `${dir}/${grouped}/${seg}`;
      }
    }
  }
  return existsSync(`${dir}/page.tsx`) || existsSync(`${dir}/route.ts`);
}

test("every internal link in the Phase 7 surfaces resolves to a route that exists", () => {
  const files = sourceFiles(ROOT, [...SCOPE]);
  assertScanned(files, 15, "internal-links-resolve");

  /**
   * Exempt, named, with the reason — the same shape every other guard in this repo uses, so a
   * stale entry fails rather than rotting into a permanent exemption.
   *
   * `/buyer/plan/premium` does not exist in `app/`. Both links PRE-DATE Phase 7 and were reported
   * to the owner with their file:line rather than fixed, under the standing instruction to surface
   * UI defects outside this phase and not repair them in passing. They are listed so this guard
   * stays green on Phase 7's own work while still failing the moment a NEW dead link appears.
   */
  const ALLOWED = new Set([
    "components/buyer/PremiumInvitation.tsx → /buyer/plan/premium",
    "components/buyer/PremiumReportMention.tsx → /buyer/plan/premium",
  ]);

  const offenders: string[] = [];
  let checked = 0;
  for (const file of files) {
    const src = readFileSync(`${ROOT}/${file}`, "utf8");
    for (const m of src.matchAll(LINK)) {
      const path = m[1]!;
      // `/api/...` is a route handler, matched by route.ts above; anything else is a page.
      checked++;
      const entry = `${file} → ${path}`;
      if (!routeExists(path) && !ALLOWED.has(entry)) offenders.push(entry);
    }
  }
  assert.ok(checked >= 10, `expected to find internal links to check; found ${checked}`);
  assert.deepEqual(
    offenders,
    [],
    "These links point at routes that do not exist — a 404 handed to a buyer or a dealership at " +
      `the moment the product asked for their attention. Offenders: ${offenders.join(", ")}`,
  );
});

test("every allowlisted dead link is still dead — a stale exemption fails", () => {
  // If one of the reported pre-existing links is fixed (or its file removed), the exemption must
  // go with it. An exemption that outlives its defect is how an allowlist becomes a blindfold.
  const stale: string[] = [];
  for (const entry of [
    ["components/buyer/PremiumInvitation.tsx", "/buyer/plan/premium"],
    ["components/buyer/PremiumReportMention.tsx", "/buyer/plan/premium"],
  ] as const) {
    const [file, path] = entry;
    if (!existsSync(`${ROOT}/${file}`)) { stale.push(`${file} (gone)`); continue; }
    const src = readFileSync(`${ROOT}/${file}`, "utf8");
    if (!src.includes(path)) stale.push(`${file} (no longer links ${path})`);
    else if (routeExists(path)) stale.push(`${file} (${path} now exists)`);
  }
  assert.deepEqual(stale, [], `Remove the exemption. Stale: ${stale.join(", ")}`);
});
