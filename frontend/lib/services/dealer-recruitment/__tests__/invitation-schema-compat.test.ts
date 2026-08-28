// The dealer_invitations physical-schema probe.
//
// Production does NOT have token_hash / consumed_at (migration
// 20260828000000 is unapplied) and `token` is still NOT NULL. Prisma selects
// every model scalar by default, so an unqualified query on the model fails
// there with P2022 and takes the whole invite path down. These tests pin the
// probe's mapping and, critically, its FAIL-SAFE DIRECTION: a broken probe must
// report legacy, because legacy queries are valid against both schemas while
// modern queries against the legacy schema are a hard failure.
//
// Run with:
//   npx tsx --test --experimental-test-module-mocks \
//     lib/services/dealer-recruitment/__tests__/invitation-schema-compat.test.ts

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

// Controllable $queryRaw, swapped per test.
let queryRaw: () => Promise<unknown> = async () => [];
mock.module("@/lib/prisma", {
  namedExports: { prisma: { $queryRaw: (..._a: unknown[]) => queryRaw() } },
});
const warnings: string[] = [];
mock.module("@/lib/logger", {
  namedExports: {
    logger: {
      warn: (msg: string) => warnings.push(String(msg)),
      error: () => {},
      info: () => {},
      debug: () => {},
    },
  },
});

// Imported AFTER the mocks are registered, and lazily — top-level await is not
// supported under the CJS transform tsx uses here (same pattern as
// dealer-email-send-gate.test.ts).
function loadCompat() {
  return import("@/lib/services/dealer-recruitment/invitation-schema-compat");
}

// The exact rows information_schema returns for each schema generation.
const PRODUCTION_TODAY = [{ column_name: "token", is_nullable: "NO" }];
const AFTER_MIGRATION = [
  { column_name: "token", is_nullable: "YES" },
  { column_name: "token_hash", is_nullable: "YES" },
  { column_name: "consumed_at", is_nullable: "YES" },
];
const AFTER_TOKEN_DROP = [
  { column_name: "token_hash", is_nullable: "YES" },
  { column_name: "consumed_at", is_nullable: "YES" },
];

beforeEach(async () => {
  const { __setInvitationSchemaCapabilities } = await loadCompat();
  __setInvitationSchemaCapabilities(null);
  warnings.length = 0;
  queryRaw = async () => [];
});

test("production today (token NOT NULL, no hash columns) maps to the legacy shape", async () => {
  const { capabilitiesFromColumns, LEGACY_CAPABILITIES } = await loadCompat();
  assert.deepEqual(capabilitiesFromColumns(PRODUCTION_TODAY), { ...LEGACY_CAPABILITIES });
});

test("after the migration, the modern shape is reported", async () => {
  const { capabilitiesFromColumns, MODERN_CAPABILITIES } = await loadCompat();
  assert.deepEqual(capabilitiesFromColumns(AFTER_MIGRATION), { ...MODERN_CAPABILITIES });
});

test("after the follow-up token drop, `token` is simply absent", async () => {
  const { capabilitiesFromColumns } = await loadCompat();
  const caps = capabilitiesFromColumns(AFTER_TOKEN_DROP);
  assert.equal(caps.hasToken, false);
  assert.equal(caps.tokenRequired, false, "an absent column can never be required");
  assert.equal(caps.hasTokenHash, true);
});

test("a partially applied migration (hash added, token still NOT NULL) is detected", async () => {
  const { capabilitiesFromColumns } = await loadCompat();
  const caps = capabilitiesFromColumns([
    { column_name: "token", is_nullable: "NO" },
    { column_name: "token_hash", is_nullable: "YES" },
  ]);
  assert.equal(caps.hasTokenHash, true);
  assert.equal(caps.tokenRequired, true, "inserts must still supply token");
  assert.equal(caps.hasConsumedAt, false);
});

test("the probe reads the live columns and caches one result per process", async () => {
  const { getInvitationSchemaCapabilities, MODERN_CAPABILITIES } = await loadCompat();
  let calls = 0;
  queryRaw = async () => { calls += 1; return AFTER_MIGRATION; };
  assert.deepEqual(await getInvitationSchemaCapabilities(), { ...MODERN_CAPABILITIES });
  assert.deepEqual(await getInvitationSchemaCapabilities(), { ...MODERN_CAPABILITIES });
  assert.equal(calls, 1, "the probe must not run on every invitation query");
});

test("a legacy database is reported AND warned about exactly once", async () => {
  const { getInvitationSchemaCapabilities } = await loadCompat();
  queryRaw = async () => PRODUCTION_TODAY;
  await getInvitationSchemaCapabilities();
  await getInvitationSchemaCapabilities();
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /token_hash is missing/);
});

test("a failed probe fails SAFE to legacy — never to a shape the database cannot answer", async () => {
  const { getInvitationSchemaCapabilities, LEGACY_CAPABILITIES } = await loadCompat();
  queryRaw = async () => { throw new Error("permission denied for information_schema"); };
  assert.deepEqual(await getInvitationSchemaCapabilities(), { ...LEGACY_CAPABILITIES });
});

test("a failed probe does not poison the cache — the next call re-probes", async () => {
  const { getInvitationSchemaCapabilities } = await loadCompat();
  queryRaw = async () => { throw new Error("transient"); };
  assert.equal((await getInvitationSchemaCapabilities()).hasTokenHash, false);
  queryRaw = async () => AFTER_MIGRATION;
  assert.equal(
    (await getInvitationSchemaCapabilities()).hasTokenHash,
    true,
    "a transient failure must not pin the process to the legacy path for its lifetime",
  );
});
