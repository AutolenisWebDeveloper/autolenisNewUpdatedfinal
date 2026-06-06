// Unit tests for the prequal provider-error taxonomy (P0-2).
// Run with:  npx tsx --test lib/services/prequal/__tests__/prequal-errors.test.ts
//
// reasonToErrorMeta is the single discriminator the persistence layer uses to
// decide whether to write queryable error metadata + a PrequalAttemptError row.
// It must return null for success / true manual review / business declines, and
// structured metadata only for genuine provider failures.

import test from "node:test";
import assert from "node:assert/strict";
import { reasonToErrorMeta, isProviderErrorReason } from "../errors";

test("non-provider reasons map to null (no error metadata)", () => {
  assert.equal(reasonToErrorMeta(undefined), null); // success / true manual review
  assert.equal(reasonToErrorMeta(null), null);
  assert.equal(reasonToErrorMeta(""), null);
  // INCOME_BELOW_MINIMUM is a business DECLINE, not a provider error.
  assert.equal(reasonToErrorMeta("INCOME_BELOW_MINIMUM"), null);
});

test("isProviderErrorReason matches the provider-failure set + HTTP_*", () => {
  assert.equal(isProviderErrorReason("TIMEOUT"), true);
  assert.equal(isProviderErrorReason("HTTP_503"), true);
  assert.equal(isProviderErrorReason("INCOME_BELOW_MINIMUM"), false);
  assert.equal(isProviderErrorReason(undefined), false);
});

test("HTTP 5xx → stage HTTP_CALL, code HTTP_5XX, parsed httpStatus", () => {
  const meta = reasonToErrorMeta("HTTP_503");
  assert.ok(meta);
  assert.equal(meta!.stage, "HTTP_CALL");
  assert.equal(meta!.code, "HTTP_5XX");
  assert.equal(meta!.httpStatus, 503);
});

test("HTTP 4xx → code HTTP_4XX with parsed httpStatus", () => {
  const meta = reasonToErrorMeta("HTTP_404");
  assert.equal(meta!.code, "HTTP_4XX");
  assert.equal(meta!.httpStatus, 404);
});

test("TIMEOUT → REQUEST_TIMEOUT on HTTP_CALL stage", () => {
  const meta = reasonToErrorMeta("TIMEOUT");
  assert.equal(meta!.stage, "HTTP_CALL");
  assert.equal(meta!.code, "REQUEST_TIMEOUT");
});

test("OAUTH_FAILED → OAUTH stage / OAUTH_TOKEN_FAILED", () => {
  const meta = reasonToErrorMeta("OAUTH_FAILED");
  assert.equal(meta!.stage, "OAUTH");
  assert.equal(meta!.code, "OAUTH_TOKEN_FAILED");
});

test("IPREDICT_ERROR → provider error status during response parse", () => {
  const meta = reasonToErrorMeta("IPREDICT_ERROR");
  assert.equal(meta!.stage, "RESPONSE_PARSE");
  assert.equal(meta!.code, "PROVIDER_ERROR_STATUS");
});

test("config reasons map to the CONFIG stage", () => {
  assert.equal(reasonToErrorMeta("CONFIG_ERROR")!.stage, "CONFIG");
  assert.equal(reasonToErrorMeta("CONFIG_ERROR")!.code, "MISSING_CREDENTIALS");
  assert.equal(reasonToErrorMeta("CONFIG_MISMATCH")!.code, "CONFIG_MISMATCH");
  assert.equal(reasonToErrorMeta("URL_NOT_CONFIGURED")!.code, "MISSING_BASE_URL");
});

test("every provider-error meta carries a human-readable message", () => {
  for (const r of [
    "TIMEOUT",
    "NETWORK_ERROR",
    "OAUTH_FAILED",
    "IPREDICT_ERROR",
    "CONFIG_ERROR",
    "HTTP_500",
  ]) {
    const meta = reasonToErrorMeta(r);
    assert.ok(meta, `${r} should produce metadata`);
    assert.equal(typeof meta!.message, "string");
    assert.ok(meta!.message.length > 0);
  }
});
