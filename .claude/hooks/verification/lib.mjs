/**
 * AutoLenis verification gate — pure logic.
 *
 * Enforces the `autolenis-code-verification` loop mechanically: material code
 * changes in a session must be accompanied by the executable checks that the
 * loop requires, and the turn must end with an explicit verdict.
 *
 * Everything here is pure and dependency-free so it can be unit-tested without
 * spawning a hook subprocess. The stdin/stdout adapters live in track.mjs
 * (PostToolUse) and gate.mjs (Stop).
 */

import path from 'node:path';

/** File extensions whose edits carry behavioral risk. */
const MATERIAL_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.prisma', '.sql', '.css',
]);

/** Paths that never require verification even with a material extension. */
const EXEMPT_PATTERNS = [
  /(^|\/)\.claude\//,
  /(^|\/)node_modules\//,
  /(^|\/)\.next\//,
  /(^|\/)dist\//,
  /(^|\/)coverage\//,
];

/**
 * Checks, in report order. `cmd` is what the agent must actually run;
 * `when` decides whether a given changed file demands it.
 */
const CHECKS = [
  { id: 'typecheck', cmd: 'pnpm typecheck', when: () => true, why: 'types' },
  { id: 'lint', cmd: 'pnpm lint', when: () => true, why: 'lint' },
  { id: 'test', cmd: 'pnpm test', when: () => true, why: 'core service suite' },
  {
    id: 'test:webhooks', cmd: 'pnpm test:webhooks', why: 'webhook signature + replay',
    when: (f) => f.includes('app/api/webhooks/'),
  },
  {
    id: 'test:payments', cmd: 'pnpm test:payments', why: 'money paths',
    when: (f) => /lib\/payments\/|lib\/services\/(payment|deposit)\/|lib\/stripe/.test(f),
  },
  {
    id: 'test:security', cmd: 'pnpm test:security', why: 'authz / PII / rate limits',
    when: (f) => /lib\/security\/|lib\/auth\/|lib\/(admin|dealer)-auth|proxy\.ts$/.test(f),
  },
  {
    id: 'test:buyer-journey', cmd: 'pnpm test:buyer-journey', why: 'buyer stage machine',
    when: (f) => f.includes('lib/services/buyer/'),
  },
  {
    id: 'test:content', cmd: 'pnpm test:content', why: 'content pipeline',
    when: (f) => /lib\/content\/|lib\/services\/content\//.test(f),
  },
  {
    id: 'test:seo', cmd: 'pnpm test:seo', why: 'metadata / JSON-LD / sitemap',
    when: (f) => /lib\/seo\/|app\/sitemap|app\/robots/.test(f),
  },
  {
    id: 'test:crm', cmd: 'pnpm test:crm', why: 'CRM surfaces',
    when: (f) => /lib\/crm\/|components\/admin\/crm\//.test(f),
  },
  {
    id: 'test:visual', cmd: 'pnpm test:visual', why: 'public UI visual regression',
    when: (f) => /app\/\(public\)\/|components\/.*\.tsx$/.test(f),
  },
  {
    id: 'build', cmd: 'pnpm build', why: 'prisma generate + next build',
    when: (f) => /prisma\/schema\.prisma$|next\.config|tailwind\.config/.test(f),
  },
];

/** Normalize a possibly-absolute path to a repo-relative POSIX path. */
export function toRelative(filePath, projectDir) {
  if (!filePath) return '';
  let p = String(filePath).split(path.sep).join('/');
  if (projectDir) {
    const root = String(projectDir).split(path.sep).join('/').replace(/\/$/, '');
    if (p.startsWith(root + '/')) p = p.slice(root.length + 1);
  }
  return p.replace(/^\.\//, '');
}

/** True when editing this file obliges the session to verify before stopping. */
export function isMaterialFile(filePath, projectDir) {
  const rel = toRelative(filePath, projectDir);
  if (!rel) return false;
  if (EXEMPT_PATTERNS.some((re) => re.test(rel))) return false;
  if (!MATERIAL_EXTENSIONS.has(path.extname(rel))) return false;
  // Scoped to `frontend/` — the production app, and the only tree the required
  // pnpm checks below can actually verify. `backend/` (FastAPI) is out of scope
  // for this gate; verify it manually per autolenis-code-verification.
  return rel.startsWith('frontend/');
}

/** Which checks the given changed files require, in report order. */
export function requiredChecks(files) {
  const required = [];
  for (const check of CHECKS) {
    if (files.some((f) => check.when(f))) required.push(check);
  }
  return required;
}

/**
 * Extract every verification check *invoked* by a shell command.
 *
 * Matching is anchored to command position — the start of the whole command or
 * of an `&&` / `||` / `;` / `|` segment — rather than searched anywhere in the
 * string. Two failure modes make that necessary:
 *
 *   • false positives let unverified work through the gate, which is precisely
 *     what it exists to stop. `git commit -m "ran pnpm test"` and
 *     `echo "run pnpm typecheck"` merely *mention* a check.
 *   • `pnpm run test` and env-prefixed invocations are real runs and must count.
 *
 * The `test:<suite>` alternative is listed first so `pnpm test:payments` never
 * degrades into a bare `test` match.
 */
const RUNNER_RE = /^(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)*(?:npx\s+)?(?:pnpm|npm|yarn)(?:\s+run)?\s+(test:[a-z-]+|typecheck|lint|build|test)\b/;
const TSC_RE = /^(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)*(?:npx\s+)?tsc\b.*--noEmit/;
const ESLINT_RE = /^(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)*(?:npx\s+)?eslint\b/;

/** Drop heredoc bodies — their contents are data, never commands. */
function stripHeredocs(command) {
  return command.replace(/<<-?\s*(['"]?)([A-Za-z_]\w*)\1[\s\S]*?^\s*\2\s*$/gm, '<<HEREDOC');
}

/**
 * Split a command into segments on *unquoted* separators only.
 *
 * A naive `.split(/&&|;|\|/)` tears quoted strings apart, so
 * `git commit -m 'ran pnpm lint && pnpm test'` yields bare `pnpm lint` and
 * `pnpm test` segments and falsely satisfies the gate.
 */
function splitSegments(command) {
  const segments = [];
  let current = '';
  let quote = null;
  for (let i = 0; i < command.length; i++) {
    const ch = command[i];
    if (quote) {
      if (ch === quote && command[i - 1] !== '\\') quote = null;
      current += ch;
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; current += ch; continue; }
    if ((ch === '&' && command[i + 1] === '&') || (ch === '|' && command[i + 1] === '|')) {
      segments.push(current); current = ''; i++; continue;
    }
    if (ch === ';' || ch === '|' || ch === '\n') { segments.push(current); current = ''; continue; }
    current += ch;
  }
  segments.push(current);
  return segments;
}

export function matchCommands(command) {
  if (!command) return [];
  const found = new Set();
  for (let segment of splitSegments(stripHeredocs(String(command)))) {
    // Subshell/group wrappers can leave a leading `(` or `{` on the segment.
    segment = segment.trim().replace(/^[({]+\s*/, '');
    if (!segment) continue;
    const m = segment.match(RUNNER_RE);
    if (m) found.add(m[1]);
    if (TSC_RE.test(segment)) found.add('typecheck');
    if (ESLINT_RE.test(segment)) found.add('lint');
  }
  return [...found];
}

/**
 * Classify a check's output as pass / fail / unknown. Conservative by design:
 * only an explicit failure signal marks a run failed, but a failed run can
 * never be laundered into a pass.
 */
export function classifyOutcome(checkId, output) {
  const text = String(output || '');
  if (!text.trim()) return 'unknown';

  // node:test summary line — authoritative for every `test*` script.
  const nodeFail = text.match(/^# fail (\d+)$/m);
  if (nodeFail) return Number(nodeFail[1]) > 0 ? 'fail' : 'pass';

  if (checkId === 'typecheck') {
    return /error TS\d+/.test(text) ? 'fail' : 'unknown';
  }
  if (checkId === 'lint') {
    const problems = text.match(/(\d+)\s+errors?\b/);
    if (problems) return Number(problems[1]) > 0 ? 'fail' : 'pass';
    return /\bERROR\b|✖/.test(text) ? 'fail' : 'unknown';
  }
  if (checkId === 'build') {
    if (/Failed to compile|Build error occurred/i.test(text)) return 'fail';
    if (/Compiled successfully|✓ Generating static pages/i.test(text)) return 'pass';
    return 'unknown';
  }
  if (checkId === 'test:visual') {
    const failed = text.match(/(\d+)\s+failed/);
    if (failed) return Number(failed[1]) > 0 ? 'fail' : 'pass';
    if (/\d+\s+passed/.test(text)) return 'pass';
    return 'unknown';
  }
  return 'unknown';
}

/** A turn-ending verdict, as required by loop step 9. */
export function hasVerdict(finalMessage) {
  return /\b(PASS WITH CONDITIONS|BLOCKED|NOT VERIFIED|PASS)\b/.test(String(finalMessage || ''));
}

/** Completion language that the loop forbids without evidence. */
export function claimsCompletion(finalMessage) {
  return /\b(production[- ]ready|everything (?:is )?works?|everything is working|all (?:tests? )?pass(?:ing|ed)?|it works now|fully working|done and working)\b/i
    .test(String(finalMessage || ''));
}

/**
 * Decide whether the Stop event may proceed.
 *
 * @param {object} state   accumulated session state (see track.mjs)
 * @param {object} opts    { stopHookActive, finalMessage, maxBlocks }
 * @returns {{block: boolean, reason?: string}}
 */
export function evaluate(state, opts = {}) {
  const { stopHookActive = false, finalMessage = '', maxBlocks = 2 } = opts;

  // Never trap the agent in a stop loop.
  if (stopHookActive) return { block: false };
  if ((state.blockCount || 0) >= maxBlocks) return { block: false };

  const files = state.materialFiles || [];
  if (files.length === 0) return { block: false };

  const ran = state.checks || {};
  const required = requiredChecks(files);
  const missing = required.filter((c) => !ran[c.id]);
  const failed = required.filter((c) => ran[c.id]?.outcome === 'fail');
  const needsVerdict = !hasVerdict(finalMessage);
  const overclaims = claimsCompletion(finalMessage) && (missing.length > 0 || failed.length > 0);

  if (missing.length === 0 && failed.length === 0 && !needsVerdict) return { block: false };

  const lines = [
    'BLOCKED by autolenis-code-verification: this session changed ' +
      `${files.length} material file(s) but the verification loop is incomplete.`,
    '',
  ];

  if (failed.length > 0) {
    lines.push('Checks that FAILED and were not brought green (loop step 4 — fix the root cause,');
    lines.push('never weaken the test):');
    for (const c of failed) lines.push(`  ✗ ${c.cmd}   (${c.why})`);
    lines.push('');
  }
  if (missing.length > 0) {
    lines.push('Required checks NOT RUN (loop step 3 — run from frontend/):');
    for (const c of missing) lines.push(`  • ${c.cmd}   (${c.why})`);
    lines.push('');
  }
  if (overclaims) {
    lines.push('Your closing message claims the work is complete or passing while the checks');
    lines.push('above are missing or red. Remove the claim or produce the evidence.');
    lines.push('');
  }
  if (needsVerdict) {
    lines.push('No verdict found in your final message (loop step 9). End with one of:');
    lines.push('  PASS · PASS WITH CONDITIONS · BLOCKED — and label anything you could not');
    lines.push('  execute here as NOT VERIFIED, naming what it needs.');
    lines.push('');
  }

  lines.push('Changed files driving these requirements:');
  for (const f of files.slice(0, 12)) lines.push(`  - ${f}`);
  if (files.length > 12) lines.push(`  … and ${files.length - 12} more`);
  lines.push('');
  lines.push('Run the checks, fix what they surface, complete the independent second review');
  lines.push('(loop step 6), then close with the evidence report. If a check genuinely cannot');
  lines.push('run in this environment, say so explicitly as NOT VERIFIED and stop again.');

  return { block: true, reason: lines.join('\n') };
}

export const __testing = { CHECKS, MATERIAL_EXTENSIONS, EXEMPT_PATTERNS };
