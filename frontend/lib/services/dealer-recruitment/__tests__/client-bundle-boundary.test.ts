// Vendor SDKs must not be reachable from a client component.
//
// FOUND BY A BUILD, NOT BY A TYPE. dealer-call-form.ts imported one pure
// predicate, isValidUsPhone, from lib/services/sms/twilio.service — a module
// that also does `import twilio from "twilio"` at the top. The queue's client
// component imports dealer-call-form, so Turbopack traced the entire Twilio SDK
// into the Client Component Browser graph and the build failed on `Can't
// resolve 'fs'`.
//
// The failure was the lucky outcome. Had those polyfills resolved, the build
// would have SUCCEEDED and shipped a vendor SDK into the browser bundle.
// typecheck and lint were both green throughout.
//
// This guard runs in milliseconds and names the rule, so the next person who
// reaches for a helper in a vendor module finds out here rather than in a
// 6-minute build — or not at all.
//
// Run: pnpm test

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// Every test:* script runs from frontend/. import.meta.dirname is undefined
// under this repo's CJS transform, so cwd is the reliable anchor — asserted
// below rather than assumed, since a wrong root would make every check here
// pass by reading nothing.
const ROOT = process.cwd();

/** Modules imported by "use client" components in the outreach surface. */
const CLIENT_REACHABLE = [
  "lib/services/dealer-recruitment/dealer-call-form.ts",
  "lib/services/dealer-recruitment/outreach-queue.service.ts",
];

/** Modules that construct or import a third-party SDK at module scope. */
const VENDOR_MODULES = [
  "@/lib/services/sms/twilio.service",
  "@/lib/services/sms/crm-sms",
  "@/lib/supabase-service",
  "@/lib/services/dealer-recruitment/dealer-sms-wiring",
];

const BARE_VENDOR_PACKAGES = ["twilio", "resend", "@supabase/supabase-js", "stripe"];

function importsOf(relPath: string): string[] {
  const full = join(ROOT, relPath);
  assert.ok(existsSync(full), `${relPath} not found from ${ROOT} — run this from frontend/`);
  const src = readFileSync(full, "utf8");
  // Strip comments first. This file's own prose names every module it forbids,
  // and matching a comment instead of an import is a mistake this branch has
  // already made three times.
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  return [...code.matchAll(/from\s+["']([^"']+)["']/g)].map((m) => m[1]);
}

for (const file of CLIENT_REACHABLE) {
  test(`${file} imports no vendor SDK, directly or through a module that does`, () => {
    const imports = importsOf(file);
    for (const vendor of [...VENDOR_MODULES, ...BARE_VENDOR_PACKAGES]) {
      assert.ok(
        !imports.includes(vendor),
        `${file} imports ${vendor}. A "use client" component reaches this module, ` +
          `so the SDK would be traced into the browser bundle. Move the helper you ` +
          `need into a pure module (lib/utils/*) and re-export it from the vendor one.`,
      );
    }
  });
}

test("the pure predicate lives in lib/utils/phone, with the vendor module re-exporting it", () => {
  const phone = readFileSync(join(ROOT, "lib/utils/phone.ts"), "utf8");
  assert.match(phone, /export function isValidUsPhone/, "the definition must be in the pure module");

  const twilio = readFileSync(join(ROOT, "lib/services/sms/twilio.service.ts"), "utf8");
  const code = twilio.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.ok(
    !/export function isValidUsPhone/.test(code),
    "a second copy in the vendor module would drift from the first",
  );
  assert.match(code, /export \{ isValidUsPhone \} from ["']@\/lib\/utils\/phone["']/);
});
