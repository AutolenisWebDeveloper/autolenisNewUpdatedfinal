// lib/testing/source-scan.ts
//
// Shared machinery for the repository's build-failing rules — the tests that read
// source text and fail when a forbidden construct appears. Four of them land in
// Phase 2 (§8.2 Part A), and every one needs the same three things: walk a set of
// roots, turn a match offset into a `file:line`, and refuse to pass on an empty
// scan.
//
// THE NON-VACUITY FLOOR IS THE POINT. A scanner that finds no files passes, and a
// passing guard that enforces nothing is worse than no guard — it reads as
// evidence. `assertScanned` makes an empty or unexpectedly small scan a failure.
// The pattern is already proven in this repository at
// `lib/security/__tests__/no-ssn-intake.test.ts:147-149` and
// `lib/services/auction/__tests__/no-inhouse-financing-on-auction-spine.test.ts:58-60`;
// this is that idea, factored so the four new rules cannot each get it subtly wrong.

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";

const DEFAULT_SKIP = new Set(["node_modules", ".next", ".git", "__tests__", "__baseline__", "coverage"]);

export interface ScanOptions {
  /** Directory names skipped anywhere in the tree. Defaults exclude tests and build output. */
  skip?: Set<string>;
  /** File extensions to collect. Defaults to .ts and .tsx, excluding .d.ts. */
  extensions?: readonly string[];
  /** Include `__tests__` directories. Off by default — a guard should not police itself. */
  includeTests?: boolean;
}

/**
 * Every source file under `roots` (repo-relative), sorted, so a scan is
 * deterministic and a failure message lists offenders in a stable order.
 */
export function sourceFiles(repoRoot: string, roots: readonly string[], opts: ScanOptions = {}): string[] {
  const skip = new Set(opts.skip ?? DEFAULT_SKIP);
  if (opts.includeTests) skip.delete("__tests__");
  const exts = opts.extensions ?? [".ts", ".tsx"];
  const out: string[] = [];

  const walk = (dir: string): void => {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (skip.has(entry)) continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (exts.some((e) => entry.endsWith(e)) && !entry.endsWith(".d.ts")) out.push(relative(repoRoot, full));
    }
  };

  for (const root of roots) {
    const full = join(repoRoot, root);
    if (existsSync(full)) walk(full);
  }
  return out.sort();
}

/** Read a repo-relative path. */
export function read(repoRoot: string, relPath: string): string {
  return readFileSync(join(repoRoot, relPath), "utf8");
}

/** 1-indexed line number of a character offset. */
export function lineAt(src: string, index: number): number {
  return src.slice(0, index).split("\n").length;
}

export interface Hit {
  file: string;
  line: number;
  text: string;
}

/**
 * Every match of `pattern` across `files`, as `file:line` hits. `pattern` must be
 * global; it is re-created per file so `lastIndex` cannot leak between them.
 */
export function findAll(repoRoot: string, files: readonly string[], pattern: RegExp): Hit[] {
  const hits: Hit[] = [];
  for (const file of files) {
    const src = read(repoRoot, file);
    const re = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : pattern.flags + "g");
    for (const m of src.matchAll(re)) {
      hits.push({ file, line: lineAt(src, m.index ?? 0), text: (m[0] ?? "").slice(0, 160).replace(/\s+/g, " ") });
    }
  }
  return hits;
}

/**
 * Fail when a scan covered fewer files than it must have. A guard that scans
 * nothing passes vacuously; this turns that into a red test naming the roots.
 */
export function assertScanned(files: readonly string[], minimum: number, what: string): void {
  if (files.length < minimum) {
    throw new Error(
      `${what}: scanned only ${files.length} files, expected at least ${minimum}. ` +
        `The roots are wrong or the walk failed — a guard that scans nothing passes without enforcing anything.`
    );
  }
}

/** `file:line` strings, for an assertion message. */
export function format(hits: readonly Hit[]): string[] {
  return hits.map((h) => `${h.file}:${h.line}`);
}
