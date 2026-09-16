// PICKUP_SAFE_SELECT — the projection that decides what a Pickup row is allowed to say on the wire.
//
// WHY A TEST AND NOT JUST A CONSTANT. `pickups.token_hash` gained its first writer in this change.
// Until now every `include: { pickup: true }` in the repository returned it as `null`, so no
// reader was wrong and no test could have been red — the column was a loaded gun with the safety
// on, and the writer is what takes the safety off. The owner's rule from §13-D32, verbatim:
// "check every reader before the writer exists, not after."
//
// THE PARTITION IS THE POINT. A test that only asserts `tokenHash` is absent would pass on an
// empty object, on a projection that lost `scheduledAt`, and on one that admits the NEXT secret
// column. This asserts the two sets PARTITION the model exactly: every Pickup scalar is either
// published or named as withheld, nothing is in both, and nothing is in neither. Adding a column
// to the model therefore fails this suite until somebody classifies it — which is the only
// mechanism that survives the next person who does not read this comment.
//
// Run with:
//   npx tsx --test --experimental-test-module-mocks \
//     "lib/services/pickup/__tests__/pickup-select.test.ts"

import test from "node:test";
import assert from "node:assert/strict";
import { Prisma } from "@prisma/client";
import { PICKUP_SAFE_SELECT, PICKUP_SECRET_FIELDS } from "../pickup-select";

function pickupScalarFields(): string[] {
  const model = Prisma.dmmf.datamodel.models.find((m) => m.name === "Pickup");
  assert.ok(model, "the Pickup model must exist in the generated client — run `prisma generate`");
  const fields = model.fields
    .filter((f) => f.kind === "scalar" || f.kind === "enum")
    .map((f) => f.name);
  // ANTI-VACUITY. If the DMMF shape ever changes and this filter matches nothing, every
  // assertion below passes over an empty list and reports success while checking nothing. That
  // is the named defect class (§8.1h), and it has already bitten this repository seven times.
  assert.ok(
    fields.length >= 30,
    `read only ${fields.length} Pickup scalars from the DMMF — the reader is broken, not the model`,
  );
  return fields;
}

const published = Object.keys(PICKUP_SAFE_SELECT);
const withheld = [...PICKUP_SECRET_FIELDS];

test("the projection publishes something, and it is not the whole model", () => {
  assert.ok(published.length > 0);
  assert.ok(withheld.length > 0);
});

test("published and withheld PARTITION every Pickup scalar — nothing unclassified", () => {
  const all = pickupScalarFields();
  const classified = new Set([...published, ...withheld]);

  const unclassified = all.filter((f) => !classified.has(f));
  assert.deepEqual(
    unclassified,
    [],
    `these Pickup columns are neither published nor withheld: ${unclassified.join(", ")}. ` +
      "A new column is a decision about whether it may cross a network boundary — make it in " +
      "pickup-select.ts rather than defaulting it to hidden by omission.",
  );

  const phantom = [...classified].filter((f) => !all.includes(f));
  assert.deepEqual(phantom, [], `classified but not on the model: ${phantom.join(", ")}`);
});

test("nothing is both published and withheld", () => {
  const both = published.filter((f) => withheld.includes(f as (typeof PICKUP_SECRET_FIELDS)[number]));
  assert.deepEqual(both, [], `contradictory classification: ${both.join(", ")}`);
});

test("the token HASH is withheld — it is an offline oracle, not a harmless digest", () => {
  // SHA-256 of a 256-bit CSPRNG token is not reversible, so shipping it hands nobody a working
  // credential. It hands them something almost as good: a target they can test guesses against
  // at memory speed, with no request to us, no rate limit and no log line. Hash-at-rest promises
  // a database read cannot recover the credential; a hash on an API response makes the database
  // read unnecessary.
  assert.ok(withheld.includes("tokenHash"));
  assert.equal("tokenHash" in PICKUP_SAFE_SELECT, false);
});

test("the retired plaintext columns are withheld too", () => {
  // Migration 20261201000000 clears `qr_code_data` and `qr_code_image` and no code writes them
  // any more — but "nothing writes it" is a claim about today's code, and this is a claim about
  // the wire. They stay classified until they are dropped.
  for (const f of ["qrCodeData", "qrCodeImage"]) {
    assert.ok(withheld.includes(f as (typeof PICKUP_SECRET_FIELDS)[number]), `${f} must be withheld`);
    assert.equal(f in PICKUP_SAFE_SELECT, false, `${f} must not be published`);
  }
});

test("the token's STATE is published — a screen that cannot say 'expired' is worse than useless", () => {
  // Withholding these would have been the easy over-correction: the buyer's page and the
  // operator's need to say when a code dies, whether it was spent and whether it was cancelled.
  // None of the three is the credential.
  for (const f of ["tokenExpiresAt", "tokenConsumedAt", "tokenRevokedAt"]) {
    assert.equal(f in PICKUP_SAFE_SELECT, true, `${f} must be published`);
  }
});

test("every published entry selects the column rather than excluding it", () => {
  // `{ foo: false }` in a Prisma select is not "hide foo" — a select with a single false entry
  // returns nothing else either. Pinning the values keeps the constant from becoming an
  // accidental exclusion list.
  for (const [k, v] of Object.entries(PICKUP_SAFE_SELECT)) {
    assert.equal(v, true, `${k} must be selected with true`);
  }
});
