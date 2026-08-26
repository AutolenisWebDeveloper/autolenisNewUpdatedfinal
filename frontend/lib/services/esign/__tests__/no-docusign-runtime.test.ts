// Negative proof (Program 4 correction §22): the buyer signing path has ZERO
// active DocuSign runtime — no DocuSign auth/token, no isDocuSignConfigured gate,
// no DOCUSIGN_* env read, no import of the deleted DocuSign modules, no external
// signing URL. Historical comments (e.g. "replaces DocuSign") are allowed; this
// scans for RUNTIME tokens only. If a future change reintroduces DocuSign into
// the signing flow, this test fails.
//
// Run: npx tsx --test lib/services/esign/__tests__/no-docusign-runtime.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

const ROOT = join(process.cwd());
const RUNTIME_FILES = [
  "lib/services/esign/buyer-signing.service.ts",
  "lib/services/esign/buyer-contract-certificate.service.ts",
  "lib/services/esign/esign.service.ts",
  "app/api/buyer/esign/[dealId]/route.ts",
  "app/api/buyer/esign/[dealId]/sign/route.ts",
  "app/api/buyer/esign/[dealId]/certificate/route.ts",
  "lib/services/contract-shield/contract-shield.service.ts",
];

// Runtime DocuSign call-path tokens that must NOT appear (comments are fine).
const FORBIDDEN = [
  "getDocuSignAccessToken",
  "isDocuSignConfigured",
  "docusign-auth.service",
  "envelope-template.service",
  "dealer-marketplace-agreement.service",
  /DOCUSIGN_[A-Z_]+/, // any DocuSign env var read
  "na4.docusign.net",
  "recipient/views",
];

test("the deleted DocuSign runtime modules no longer exist", () => {
  for (const p of [
    "lib/services/esign/docusign-auth.service.ts",
    "lib/services/esign/envelope-template.service.ts",
    "lib/services/esign/dealer-marketplace-agreement.service.ts",
    "lib/services/esign/esign-reconcile.service.ts",
    "lib/services/esign/signed-contract-refetch.service.ts",
    "app/api/webhooks/docusign/route.ts",
    "app/api/cron/esign-envelope-reconcile/route.ts",
    "app/api/cron/signed-contract-refetch/route.ts",
  ]) {
    assert.equal(existsSync(join(ROOT, p)), false, `${p} must be deleted (DocuSign removal)`);
  }
});

test("no DocuSign runtime token appears in the in-house signing path", () => {
  for (const rel of RUNTIME_FILES) {
    const full = join(ROOT, rel);
    assert.equal(existsSync(full), true, `${rel} should exist`);
    // Strip line comments so a historical "// replaces DocuSign" note never trips
    // the runtime scan; block-comment tokens here are not runtime calls either.
    const src = readFileSync(full, "utf8")
      .split("\n")
      .map((l) => l.replace(/\/\/.*$/, "").replace(/\/\*.*$/, ""))
      .join("\n");
    for (const f of FORBIDDEN) {
      if (typeof f === "string") {
        assert.ok(!src.includes(f), `${rel} must not contain runtime DocuSign token "${f}"`);
      } else {
        assert.ok(!f.test(src), `${rel} must not read a DocuSign env var (${f})`);
      }
    }
  }
});

test("no DocuSign cron is registered in vercel.json", () => {
  const vercel = JSON.parse(readFileSync(join(ROOT, "vercel.json"), "utf8"));
  const paths: string[] = (vercel.crons ?? []).map((c: { path: string }) => c.path);
  assert.ok(!paths.some((p) => /docusign|esign-envelope-reconcile|signed-contract-refetch/.test(p)), "no DocuSign/e-sign-reconcile cron should remain");
});
