// lib/admin/__tests__/admin-deep-links.test.ts
//
// Admin links that live OUTSIDE the console — in an email, an SMS, a
// notification row — are navigation too, and they are the least-observed kind.
// Nobody clicks them in development. Two shipped broken:
//
//   • the founder hot-lead alert pointed at /admin/opportunities/{id}, a page
//     that has never existed, so every hot-lead alert 404'd;
//   • the new-vehicle-request admin alert pointed at a real page with the wrong
//     id space, landing the operator on a read-only view instead of the command
//     view.
//
// Batch 2's capability-preservation suite proves links INSIDE app/admin resolve.
// This one closes the other half: every /admin/... path referenced anywhere in
// lib/ must resolve to a page that exists, under Next.js route precedence.
//
// Run with:  npx tsx --test lib/admin/__tests__/admin-deep-links.test.ts

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, dirname } from "node:path";

const ROOT = process.cwd();
const APP = join(ROOT, "app");

function walk(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, acc);
    else acc.push(full);
  }
  return acc;
}

/** Every admin page that exists on disk, as a route pattern. */
const PAGES = walk(join(APP, "admin"))
  .filter((f) => /[/\\]page\.tsx?$/.test(f))
  .map((f) => "/" + relative(APP, dirname(f)).split("\\").join("/"));

/** A concrete URL matches a route pattern when every dynamic segment absorbs one. */
function matches(pattern: string, url: string): boolean {
  const ps = pattern.replace(/^\//, "").split("/");
  const us = url.replace(/^\//, "").split("/");
  if (ps.length !== us.length) return false;
  return ps.every((seg, i) => seg.startsWith("[") || seg === us[i]);
}

const ADMIN_LITERAL = /['"`](\/admin\/[^'"`\s)]*)['"`]/g;

/** Every /admin/... literal in a file, with `${…}` collapsed to a segment. */
function adminLinksIn(file: string): string[] {
  const src = readFileSync(file, "utf8");
  const out: string[] = [];
  for (const m of src.matchAll(ADMIN_LITERAL)) {
    const raw = m[1].split("?")[0].split("#")[0];
    const url = raw.replace(/\$\{[^{}]*\}/g, "X").replace(/\/$/, "");
    if (url.startsWith("/admin")) out.push(url);
  }
  return out;
}

/** Test files are excluded: they NAME bad routes in order to forbid them. */
const isTest = (f: string) => f.includes("__tests__") || /\.test\.tsx?$/.test(f);

const SOURCES = walk(join(ROOT, "lib")).filter((f) => /\.tsx?$/.test(f) && !isTest(f));

describe("admin deep links from lib/ resolve to pages that exist", () => {
  test("there are links to check (the guard is not vacuous)", () => {
    const total = SOURCES.reduce((n, f) => n + adminLinksIn(f).length, 0);
    assert.ok(total > 50, `only ${total} admin links scanned — the matcher is probably broken`);
  });

  test("every /admin/... path referenced from lib/ has a page.tsx", () => {
    assert.ok(PAGES.length > 100, `only ${PAGES.length} admin pages discovered`);

    const dead: string[] = [];
    for (const file of SOURCES) {
      for (const url of adminLinksIn(file)) {
        if (!PAGES.some((p) => matches(p, url))) {
          dead.push(`${relative(ROOT, file)} -> ${url}`);
        }
      }
    }
    assert.deepEqual(
      dead,
      [],
      "these links open a page that does not exist:\n" + dead.join("\n"),
    );
  });

  test("nothing links to /admin/opportunities — it has never had a page", () => {
    // Named explicitly: this is the exact route the founder hot-lead alert
    // invented. A BuyerOpportunity has no detail page; the operational surface
    // is the VehicleRequest it produced (see adminPathForOpportunity).
    assert.ok(
      !PAGES.some((p) => p.startsWith("/admin/opportunities")),
      "an /admin/opportunities page now exists — this guard needs revisiting",
    );

    const offenders = [
      ...walk(join(ROOT, "lib")),
      ...walk(join(ROOT, "app")),
      ...walk(join(ROOT, "components")),
    ]
      .filter((f) => /\.tsx?$/.test(f) && !isTest(f))
      .filter((f) => /['"`]\/admin\/opportunities/.test(readFileSync(f, "utf8")))
      .map((f) => relative(ROOT, f));

    assert.deepEqual(offenders, [], `still linking to a phantom route:\n${offenders.join("\n")}`);
  });
});
