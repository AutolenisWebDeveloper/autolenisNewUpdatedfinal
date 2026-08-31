// Guard: `.env.example` must never describe a REQUIRED_EMAIL_ENV_VAR as optional.
//
// Why this test exists. `dealer-email-send.sendDealerEmail` refuses to dispatch when
// any REQUIRED_EMAIL_ENV_VARS entry is unset, and that check is the FIRST gate in the
// function — it returns `not_configured` before the prospect is loaded and before the
// DealerOutreachLog row is written. So an operator who follows the template and leaves
// a "# optional" var blank disables dealer outreach completely, and the failure leaves
// no durable trace anywhere: zero log rows, which reads as "never attempted" rather
// than "attempted and blocked".
//
// That is exactly what happened — the template called two required vars optional. The
// drift is silent by construction (nothing imports the template), so it needs a test.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { REQUIRED_EMAIL_ENV_VARS } from "../email-channel-config";

// Tests run with cwd = frontend/ (see the test:* scripts in package.json).
const TEMPLATE_PATH = join(process.cwd(), ".env.example");
const TEMPLATE = readFileSync(TEMPLATE_PATH, "utf8");

/** The template line declaring `key`, or null when the key is absent entirely. */
function declarationLine(key: string): string | null {
  const prefix = `${key}=`;
  return TEMPLATE.split("\n").find((line) => line.startsWith(prefix)) ?? null;
}

/** The trailing `# ...` comment on a declaration line, lowercased. "" when none. */
function annotation(line: string): string {
  const hash = line.indexOf("#");
  return hash === -1 ? "" : line.slice(hash + 1).trim().toLowerCase();
}

test("every REQUIRED_EMAIL_ENV_VAR is present in .env.example", () => {
  for (const key of REQUIRED_EMAIL_ENV_VARS) {
    assert.notEqual(
      declarationLine(key),
      null,
      `${key} gates every dealer send but is missing from .env.example — an operator ` +
        `provisioning from the template has no way to know it is needed`,
    );
  }
});

test("no REQUIRED_EMAIL_ENV_VAR is annotated 'optional' in .env.example", () => {
  for (const key of REQUIRED_EMAIL_ENV_VARS) {
    const line = declarationLine(key);
    if (line === null) continue; // covered by the presence test above
    assert.doesNotMatch(
      annotation(line),
      /\boptional\b/,
      `.env.example calls ${key} optional, but REQUIRED_EMAIL_ENV_VARS makes it a hard ` +
        `precondition of sendDealerEmail. Leaving it unset silently disables all dealer ` +
        `outreach at the first gate, before any DealerOutreachLog row is written.`,
    );
  }
});

test("the required set is non-empty, so the guard above cannot pass vacuously", () => {
  assert.ok(
    REQUIRED_EMAIL_ENV_VARS.length > 0,
    "an empty REQUIRED_EMAIL_ENV_VARS would make both assertions above no-ops",
  );
});
