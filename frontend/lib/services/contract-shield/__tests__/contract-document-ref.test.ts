// The contract documentUrl validator.
//
// Regression target: the contract-attach routes validated documentUrl with
// `z.string().url()`, which is INVERTED for this field. Contracts live in the
// PRIVATE Supabase bucket "dealer-contracts" and are persisted as a BARE STORAGE
// PATH (app/api/dealer/contracts/upload-file/route.ts returns `documentUrl: path`;
// see lib/services/contract-shield/extract-text.ts). So `.url()`:
//
//   • REJECTED the only format the system actually produces, and
//   • ACCEPTED absolute URLs, which loadContractPdfBytes then fetches server-side
//     with no host restriction — an SSRF into link-local metadata, loopback
//     services and file:// .
//
// The fix accepts stored paths and rejects every absolute URL on input. Reading
// still tolerates legacy http(s) rows (extract-text is unchanged); nothing new
// may be attached by URL, so there is no allow-list to maintain and no fetch of
// an attacker-chosen host.
//
// Run with:
//   npx tsx --test --experimental-test-module-mocks \
//     "lib/services/contract-shield/__tests__/contract-document-ref.test.ts"

import test from "node:test";
import assert from "node:assert/strict";
import { contractDocumentPathSchema, isStoredContractPath } from "@/lib/services/contract-shield/contract-document-ref";

// Exactly what upload-file produces: `${ownerId}/${dealId}/${uuid}.pdf`.
const ACCEPTED = [
  "8f14e45f-ceea-467a-9f1f-9a1b2c3d4e5f/deal_1/3c9a1e77-0b2d-4a6e-8f10-a1b2c3d4e5f6.pdf",
  "admin/deal_1/3c9a1e77-0b2d-4a6e-8f10-a1b2c3d4e5f6.pdf",
  "dealer_1/deal_1/contract.PDF",
];

// Every one of these was ACCEPTED by z.string().url().
const SSRF_AND_MALFORMED = [
  "http://169.254.169.254/latest/meta-data/iam/security-credentials/", // cloud metadata
  "http://[::ffff:169.254.169.254]/latest/meta-data/",                 // IPv6-mapped metadata
  "http://localhost:5433/",                                            // loopback service
  "http://127.0.0.1:3000/api/admin/deals",                             // loopback, own API
  "https://attacker.example.com/evil.pdf",                             // arbitrary egress
  "file:///etc/passwd",                                                // local file read
  "ftp://internal.example.com/contract.pdf",
  "http://169.254.169.254/latest/meta-data/.pdf",                      // .pdf suffix is not a pass
];

const OTHER_REJECTED = [
  "",                                        // empty
  "   ",                                     // whitespace only
  "/etc/passwd",                             // absolute filesystem path
  "../../../secrets/contract.pdf",           // traversal
  "dealer_1/../../other/contract.pdf",       // traversal mid-path
  "dealer_1//deal_1/contract.pdf",           // empty segment
  "dealer_1/deal_1/contract.exe",            // not a PDF
  "dealer_1/deal_1/contract",                // no extension
  "dealer_1\\deal_1\\contract.pdf",          // backslash separators
  "dealer_1/deal_1/cont\nract.pdf",          // control character
];

test("ACCEPTS the bare storage path format the system actually writes", () => {
  for (const path of ACCEPTED) {
    assert.equal(isStoredContractPath(path), true, `must accept the real upload-file format: ${path}`);
    assert.equal(contractDocumentPathSchema.safeParse(path).success, true, `schema must accept: ${path}`);
  }
});

test("REJECTS every absolute-URL SSRF payload z.string().url() used to accept", () => {
  for (const payload of SSRF_AND_MALFORMED) {
    assert.equal(isStoredContractPath(payload), false, `must reject SSRF payload: ${payload}`);
    assert.equal(
      contractDocumentPathSchema.safeParse(payload).success,
      false,
      `schema must reject SSRF payload — loadContractPdfBytes would fetch it server-side: ${payload}`,
    );
  }
});

test("REJECTS traversal, empty segments, non-PDF and malformed paths", () => {
  for (const bad of OTHER_REJECTED) {
    assert.equal(isStoredContractPath(bad), false, `must reject: ${JSON.stringify(bad)}`);
    assert.equal(contractDocumentPathSchema.safeParse(bad).success, false, `schema must reject: ${JSON.stringify(bad)}`);
  }
});

test("a rejection message names the expected format rather than saying 'invalid url'", () => {
  const result = contractDocumentPathSchema.safeParse("https://attacker.example.com/evil.pdf");
  assert.equal(result.success, false);
  const message = result.success ? "" : (result.error.issues[0]?.message ?? "");
  assert.match(message, /storage path/i, "the operator must be told what shape is expected");
  assert.doesNotMatch(message, /invalid url/i, "the old .url() message describes the inverted rule");
});
