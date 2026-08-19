// A2 — getPreferredMakes read-only accessor. Runs under base `test`
// (--experimental-test-module-mocks). Mocks @/lib/prisma so no DB is touched.
//   npx tsx --test --experimental-test-module-mocks \
//     lib/services/auction/__tests__/auction-capacity.test.ts

import test, { mock } from "node:test";
import assert from "node:assert/strict";

let configRow: { preferredMakes: string[] } | null = null;
mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      dealerCapacityConfig: {
        findUnique: async () => configRow,
      },
    },
  },
});

async function loadGetPreferredMakes() {
  const mod = await import("../auction-capacity.service");
  return mod.getPreferredMakes;
}

test("getPreferredMakes returns the config's preferredMakes", async () => {
  configRow = { preferredMakes: ["Toyota", "Lexus"] };
  const getPreferredMakes = await loadGetPreferredMakes();
  assert.deepEqual(await getPreferredMakes("d1"), ["Toyota", "Lexus"]);
});

test("getPreferredMakes returns [] when no config exists", async () => {
  configRow = null;
  const getPreferredMakes = await loadGetPreferredMakes();
  assert.deepEqual(await getPreferredMakes("d1"), []);
});
