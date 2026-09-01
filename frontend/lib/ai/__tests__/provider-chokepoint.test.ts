// Structural proof that the AI kill switch is a CHOKEPOINT, not a discipline.
//
// Phase 1 found the kill switch enforced on 1 of 19 model call paths. A
// code-review rule would regress; a mechanical assertion cannot. These tests
// scan the real source tree: if any module outside `lib/ai/providers/` reaches
// a model endpoint or constructs a provider SDK, the chokepoint is broken and
// this fails — regardless of how careful the author was.
//
//   npx tsx --test lib/ai/__tests__/provider-chokepoint.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const ROOT = process.cwd();

// The ONLY directory permitted to speak a provider's wire protocol.
const PROVIDER_DIR = "lib/ai/providers";

// Scanned trees. `scripts/` is deliberately excluded: those are operator-run
// one-shots outside the request path, never part of a served AI surface.
const SCAN_ROOTS = ["lib", "app", "components"];

const SKIP_DIRS = new Set(["node_modules", ".next", ".git", "dist", "build", "__tests__"]);

const MODEL_ENDPOINT_HOSTS = [
  "api.groq.com",
  "generativelanguage.googleapis.com",
  "api.anthropic.com",
  "api.openai.com",
];

// Provider SDK module specifiers. A constructor cannot appear without one.
const PROVIDER_SDK_IMPORTS = [
  "groq-sdk",
  "@anthropic-ai/sdk",
  "@google/generative-ai",
];

function walk(dir: string, acc: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return acc;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, acc);
    else if (/\.tsx?$/.test(entry)) acc.push(relative(ROOT, full).split(sep).join("/"));
  }
  return acc;
}

function sourceFiles(): string[] {
  return SCAN_ROOTS.flatMap((r) => walk(join(ROOT, r))).sort();
}

function isProviderModule(file: string): boolean {
  return file.startsWith(`${PROVIDER_DIR}/`);
}

test("no module outside lib/ai/providers/ contains a model endpoint host", () => {
  const offenders: string[] = [];
  for (const file of sourceFiles()) {
    if (isProviderModule(file)) continue;
    const src = readFileSync(join(ROOT, file), "utf8");
    for (const host of MODEL_ENDPOINT_HOSTS) {
      if (src.includes(host)) offenders.push(`${file} → ${host}`);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `Model endpoints must be reached only through lib/ai/provider.ts so the kill ` +
      `switch is asserted once. Offenders:\n  ${offenders.join("\n  ")}`,
  );
});

test("no module outside lib/ai/providers/ imports a provider SDK", () => {
  const offenders: string[] = [];
  for (const file of sourceFiles()) {
    if (isProviderModule(file)) continue;
    const src = readFileSync(join(ROOT, file), "utf8");
    for (const spec of PROVIDER_SDK_IMPORTS) {
      const rx = new RegExp(`from\\s+["']${spec.replace(/[/@-]/g, "\\$&")}["']`);
      if (rx.test(src)) offenders.push(`${file} → ${spec}`);
    }
    // `openai` is a bare specifier; match it exactly so "openai/gpt-oss-120b"
    // (a Groq MODEL ID, not an import) never trips this.
    if (/from\s+["']openai["']/.test(src)) offenders.push(`${file} → openai`);
  }
  assert.deepEqual(
    offenders,
    [],
    `Provider SDKs may only be constructed inside lib/ai/providers/. Offenders:\n  ${offenders.join("\n  ")}`,
  );
});

test("no \"use client\" module imports lib/ai/kill-switch", () => {
  // Phase 1 §D.5: `isAiEnabled()` was called from two client modules where
  // `process.env.AI_KILL_SWITCH` is undefined, so it ALWAYS returned true and
  // the admin badge told an operator "Active" while AI was disabled. The fix is
  // structural: the kill switch is server state and never crosses to the client.
  const offenders: string[] = [];
  for (const file of sourceFiles()) {
    const src = readFileSync(join(ROOT, file), "utf8");
    const isClient = /^\s*(["'])use client\1/.test(src);
    if (!isClient) continue;
    if (/from\s+["']@\/lib\/ai\/kill-switch["']/.test(src)) offenders.push(file);
  }
  assert.deepEqual(offenders, [], `"use client" modules importing the kill switch:\n  ${offenders.join("\n  ")}`);
});

test("the provider directory exists and every provider module lives in it", () => {
  const files = sourceFiles().filter(isProviderModule);
  assert.ok(files.length > 0, `${PROVIDER_DIR}/ must contain the provider adapters`);
});
