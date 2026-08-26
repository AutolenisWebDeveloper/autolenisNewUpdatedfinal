// §14 — DocuSign (and any external e-sign provider SDK) is NOT part of the runtime
// architecture. Signing is fully in-house. This guards against a regression that
// re-introduces a provider dependency or a runtime provider call.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";

const ESIGN_DIR = join(process.cwd(), "lib", "services", "esign");

test("no esign source imports or requires a DocuSign / external e-sign SDK", () => {
  const files = readdirSync(ESIGN_DIR).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));
  const offenders: string[] = [];
  for (const f of files) {
    const src = readFileSync(join(ESIGN_DIR, f), "utf8");
    // Any import/require of a docusign package is forbidden. (Comments referencing
    // the legacy docusign_envelope_id column for historical records are fine.)
    const importRe = /(import[^\n;]*['"][^'"]*docusign[^'"]*['"])|(require\(\s*['"][^'"]*docusign[^'"]*['"]\s*\))/i;
    if (importRe.test(src)) offenders.push(f);
  }
  assert.deepEqual(offenders, [], `esign source must not import a DocuSign SDK: ${offenders.join(", ")}`);
});

test("no DocuSign / external e-sign SDK is declared as an app dependency", () => {
  const pkg = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  const all = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
  const providers = Object.keys(all).filter((name) => /docusign|hellosign|dropbox-sign|adobe-sign|pandadoc/i.test(name));
  assert.deepEqual(providers, [], `no external e-sign provider SDK may be a dependency: ${providers.join(", ")}`);
});
