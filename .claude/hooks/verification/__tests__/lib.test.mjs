import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  isMaterialFile,
  requiredChecks,
  matchCommands,
  classifyOutcome,
  hasVerdict,
  claimsCompletion,
  evaluate,
} from '../lib.mjs';
import { applyEvent } from '../track.mjs';
import { canPersist, writeState, readState, finalAssistantMessage } from '../state.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = '/repo';

/* ---------------------------------------------------------- materiality --- */

test('material files are frontend code, not config or docs', () => {
  assert.equal(isMaterialFile('/repo/frontend/lib/services/offer/offer.service.ts', ROOT), true);
  assert.equal(isMaterialFile('/repo/frontend/app/api/webhooks/route.ts', ROOT), true);
  assert.equal(isMaterialFile('/repo/frontend/prisma/schema.prisma', ROOT), true);

  assert.equal(isMaterialFile('/repo/CLAUDE.md', ROOT), false);
  assert.equal(isMaterialFile('/repo/.claude/hooks/verification/lib.mjs', ROOT), false);
  assert.equal(isMaterialFile('/repo/frontend/node_modules/x/index.js', ROOT), false);
  assert.equal(isMaterialFile('/repo/docs/architecture.md', ROOT), false);
  assert.equal(isMaterialFile('', ROOT), false);
  assert.equal(isMaterialFile(undefined, ROOT), false);
});

test('backend python is out of gate scope (pnpm checks cannot verify it)', () => {
  assert.equal(isMaterialFile('/repo/backend/server.py', ROOT), false);
});

/* ------------------------------------------------------- required checks --- */

test('every material change requires typecheck, lint, coverage-check and the full matrix', () => {
  const ids = requiredChecks(['frontend/lib/services/deal/deal.service.ts']).map((c) => c.id);
  assert.deepEqual(ids, ['typecheck', 'lint', 'test:coverage-check', 'test:all']);
});

test('the gate requires test:all, not the per-domain suites it already chains', () => {
  // `test:all` runs all 18 unit suites, so requiring test:webhooks/test:payments
  // alongside it would duplicate the repo's gate instead of extending it.
  const ids = requiredChecks([
    'frontend/app/api/webhooks/stripe/route.ts',
    'frontend/lib/payments/deposit.ts',
  ]).map((c) => c.id);
  assert.ok(ids.includes('test:all'));
  assert.ok(!ids.includes('test:webhooks'));
  assert.ok(!ids.includes('test:payments'));
});


test('a public component change requires the visual suite', () => {
  const ids = requiredChecks(['frontend/components/marketing/Hero.tsx']).map((c) => c.id);
  assert.ok(ids.includes('test:visual'));
});

test('a schema change requires the build', () => {
  const ids = requiredChecks(['frontend/prisma/schema.prisma']).map((c) => c.id);
  assert.ok(ids.includes('build'));
});

/* ------------------------------------------------------ command matching --- */

test('a suite command is not mistaken for the bare core suite', () => {
  assert.deepEqual(matchCommands('pnpm test:payments'), ['test:payments']);
  assert.deepEqual(matchCommands('pnpm test'), ['test']);
});

test('chained commands are all captured', () => {
  const ids = matchCommands('cd frontend && pnpm typecheck && pnpm lint && pnpm test:security');
  assert.deepEqual(ids.sort(), ['lint', 'test:security', 'typecheck']);
});

test('merely mentioning a check never counts as running it', () => {
  // Second-review finding: a substring search let these satisfy the gate,
  // which is exactly the unverified-work path the gate exists to close.
  assert.deepEqual(matchCommands('git commit -m "ran pnpm test and pnpm lint"'), []);
  assert.deepEqual(matchCommands('echo "next: pnpm typecheck"'), []);
  assert.deepEqual(matchCommands('grep -r "pnpm test" docs/'), []);
  // Regression: the segment splitter was not quote-aware, so separators inside
  // a quoted argument tore it into bare command segments and satisfied the gate.
  assert.deepEqual(
    matchCommands("git commit -m 'ran pnpm typecheck && pnpm lint && pnpm test && pnpm test:payments'"),
    [],
  );
  assert.deepEqual(matchCommands('echo "pnpm lint; pnpm test"'), []);
  // Regression: heredoc bodies are data, not commands.
  assert.deepEqual(matchCommands('cat > notes.md <<EOF\npnpm build\npnpm test\nEOF'), []);
});

test('a real invocation alongside a quoted mention is still detected', () => {
  assert.deepEqual(
    matchCommands("git commit -m 'mentions pnpm build' && pnpm test"),
    ['test'],
  );
});

test('run-style and env-prefixed invocations count', () => {
  // Second-review finding: `pnpm run test` is a real run and was being missed.
  assert.deepEqual(matchCommands('pnpm run test'), ['test']);
  assert.deepEqual(matchCommands('npm run test:security'), ['test:security']);
  assert.deepEqual(matchCommands('CI=1 pnpm typecheck'), ['typecheck']);
  assert.deepEqual(matchCommands('cd frontend; pnpm lint'), ['lint']);
});

test('direct tool invocations count', () => {
  assert.deepEqual(matchCommands('npx tsc --noEmit'), ['typecheck']);
  assert.deepEqual(matchCommands('npx eslint .'), ['lint']);
  assert.deepEqual(matchCommands('git status'), []);
  assert.deepEqual(matchCommands(''), []);
});

/* ---------------------------------------------------------- classification --- */

test('node:test summary decides pass or fail', () => {
  assert.equal(classifyOutcome('test', '# pass 12\n# fail 0\n'), 'pass');
  assert.equal(classifyOutcome('test', '# pass 10\n# fail 2\n'), 'fail');
});

test('typecheck and lint failures are detected', () => {
  assert.equal(classifyOutcome('typecheck', "app/x.ts(3,1): error TS2345: bad"), 'fail');
  assert.equal(classifyOutcome('lint', '✖ 3 problems (3 errors, 0 warnings)'), 'fail');
  assert.equal(classifyOutcome('lint', '✖ 2 problems (0 errors, 2 warnings)'), 'pass');
});

test('build and visual outcomes are detected', () => {
  assert.equal(classifyOutcome('build', 'Failed to compile'), 'fail');
  assert.equal(classifyOutcome('build', 'Compiled successfully'), 'pass');
  assert.equal(classifyOutcome('test:visual', '3 failed\n1 passed'), 'fail');
  assert.equal(classifyOutcome('test:visual', '9 passed'), 'pass');
});

test('silence is never a pass', () => {
  assert.equal(classifyOutcome('typecheck', ''), 'unknown');
  assert.equal(classifyOutcome('test', 'some unrelated chatter'), 'unknown');
});

/* ------------------------------------------------------- verdict language --- */

test('verdict detection', () => {
  assert.equal(hasVerdict('Verdict: PASS WITH CONDITIONS'), true);
  assert.equal(hasVerdict('DocuSign creds absent — NOT VERIFIED'), true);
  assert.equal(hasVerdict('All good, shipped it.'), false);
});

test('completion overclaim detection', () => {
  assert.equal(claimsCompletion('Everything is working now.'), true);
  assert.equal(claimsCompletion('This is production ready.'), true);
  assert.equal(claimsCompletion('I changed the ranking function.'), false);
});

/* -------------------------------------------------------------- evaluate --- */

const S = (over = {}) => ({ materialFiles: [], checks: {}, blockCount: 0, ...over });
const green = {
  typecheck: { outcome: 'pass' },
  lint: { outcome: 'pass' },
  'test:coverage-check': { outcome: 'pass' },
  'test:all': { outcome: 'pass' },
};

test('running only the fast subset does not satisfy the gate', () => {
  const r = evaluate(
    S({
      materialFiles: ['frontend/lib/x.ts'],
      checks: { typecheck: { outcome: 'pass' }, lint: { outcome: 'pass' }, test: { outcome: 'pass' } },
    }),
    { finalMessage: 'Verdict: PASS' },
  );
  assert.equal(r.block, true);
  assert.match(r.reason, /pnpm test:all/);
});

test('a session with no material change is never blocked', () => {
  assert.equal(evaluate(S(), { finalMessage: 'done' }).block, false);
});

test('material change with no checks is blocked and names the commands', () => {
  const r = evaluate(S({ materialFiles: ['frontend/lib/x.ts'] }), { finalMessage: 'Done!' });
  assert.equal(r.block, true);
  assert.match(r.reason, /pnpm typecheck/);
  assert.match(r.reason, /pnpm lint/);
  assert.match(r.reason, /frontend\/lib\/x\.ts/);
});

test('a red check blocks even when every check has been run', () => {
  const r = evaluate(
    S({ materialFiles: ['frontend/lib/x.ts'], checks: { ...green, 'test:all': { outcome: 'fail' } } }),
    { finalMessage: 'Verdict: PASS' },
  );
  assert.equal(r.block, true);
  assert.match(r.reason, /FAILED/);
});

test('green checks without a verdict still block', () => {
  const r = evaluate(S({ materialFiles: ['frontend/lib/x.ts'], checks: green }),
    { finalMessage: 'All finished.' });
  assert.equal(r.block, true);
  assert.match(r.reason, /No verdict/);
});

test('green checks plus a verdict pass the gate', () => {
  const r = evaluate(S({ materialFiles: ['frontend/lib/x.ts'], checks: green }),
    { finalMessage: 'Verdict: PASS' });
  assert.equal(r.block, false);
});

test('unknown-outcome runs satisfy the gate — only explicit failure blocks', () => {
  const unknown = Object.fromEntries(
    Object.keys(green).map((k) => [k, { outcome: 'unknown' }]),
  );
  const r = evaluate(S({ materialFiles: ['frontend/lib/x.ts'], checks: unknown }),
    { finalMessage: 'Verdict: PASS WITH CONDITIONS' });
  assert.equal(r.block, false);
});

test('overclaiming completion with missing checks is called out', () => {
  const r = evaluate(S({ materialFiles: ['frontend/lib/x.ts'] }),
    { finalMessage: 'Everything is working. PASS' });
  assert.equal(r.block, true);
  assert.match(r.reason, /Remove the claim or produce the evidence/);
});

/* ------------------------------------------------------------ loop safety --- */

test('stop_hook_active always allows the stop', () => {
  const r = evaluate(S({ materialFiles: ['frontend/lib/x.ts'] }),
    { stopHookActive: true, finalMessage: '' });
  assert.equal(r.block, false);
});

test('the gate gives up after maxBlocks so a turn can never be trapped', () => {
  const st = S({ materialFiles: ['frontend/lib/x.ts'], blockCount: 2 });
  assert.equal(evaluate(st, { finalMessage: '', maxBlocks: 2 }).block, false);
});

/* ------------------------------------------------------------- applyEvent --- */

test('edits record material files once, ignoring config', () => {
  let st = S();
  st = applyEvent(st, { tool_name: 'Edit', tool_input: { file_path: '/repo/frontend/lib/a.ts' } }, ROOT);
  st = applyEvent(st, { tool_name: 'Write', tool_input: { file_path: '/repo/frontend/lib/a.ts' } }, ROOT);
  st = applyEvent(st, { tool_name: 'Edit', tool_input: { file_path: '/repo/CLAUDE.md' } }, ROOT);
  assert.deepEqual(st.materialFiles, ['frontend/lib/a.ts']);
});

test('bash runs record an outcome from tool output', () => {
  const st = applyEvent(S(), {
    tool_name: 'Bash',
    tool_input: { command: 'cd frontend && pnpm test' },
    tool_response: { stdout: '# pass 5\n# fail 0\n' },
  }, ROOT);
  assert.equal(st.checks.test.outcome, 'pass');
});

test('an interrupted run is a failure, not a pass', () => {
  const st = applyEvent(S(), {
    tool_name: 'Bash',
    tool_input: { command: 'pnpm test' },
    tool_response: { stdout: '', interrupted: true },
  }, ROOT);
  assert.equal(st.checks.test.outcome, 'fail');
});

test('a later green run supersedes an earlier red one', () => {
  let st = applyEvent(S(), {
    tool_name: 'Bash', tool_input: { command: 'pnpm test' },
    tool_response: { stdout: '# fail 1\n' },
  }, ROOT);
  assert.equal(st.checks.test.outcome, 'fail');
  st = applyEvent(st, {
    tool_name: 'Bash', tool_input: { command: 'pnpm test' },
    tool_response: { stdout: '# fail 0\n' },
  }, ROOT);
  assert.equal(st.checks.test.outcome, 'pass');
  assert.equal(st.checks.test.prior, 'fail');
});

test('unrelated tools leave state untouched', () => {
  const st = applyEvent(S(), { tool_name: 'Read', tool_input: { file_path: '/repo/frontend/x.ts' } }, ROOT);
  assert.deepEqual(st.materialFiles, []);
  assert.deepEqual(st.checks, {});
});

/* ------------------------------------------------------------ persistence --- */

test('persistence is skipped when .claude/ is absent — regression: mkdirSync ' +
     'with {recursive:true} can hang forever on a missing ancestor, stalling the turn', () => {
  assert.equal(canPersist('/proc/nonexistent'), false);
  const started = Date.now();
  assert.equal(writeState('sess', S(), '/proc/nonexistent'), false);
  assert.ok(Date.now() - started < 1000, 'writeState must fail fast, never block');
});

test('state round-trips through a real project dir', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'autolenis-verif-'));
  fs.mkdirSync(path.join(root, '.claude'), { recursive: true });
  try {
    assert.equal(canPersist(root), true);
    const st = S({ materialFiles: ['frontend/lib/a.ts'], checks: { test: { outcome: 'pass' } } });
    assert.equal(writeState('sess-1', st, root), true);
    assert.deepEqual(readState('sess-1', root), st);
    // Unknown session and corrupt file both degrade to empty, never throw.
    assert.deepEqual(readState('missing', root).materialFiles, []);
    fs.writeFileSync(path.join(root, '.claude', '.verification-state', 'bad.json'), '{ oops');
    assert.deepEqual(readState('bad', root).materialFiles, []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('session ids cannot escape the state directory', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'autolenis-verif-'));
  fs.mkdirSync(path.join(root, '.claude'), { recursive: true });
  try {
    writeState('../../etc/pwned', S({ materialFiles: ['x'] }), root);
    const dir = path.join(root, '.claude', '.verification-state');
    const written = fs.readdirSync(dir);
    assert.equal(written.length, 1);
    // Every path separator and dot is flattened, so the write cannot escape.
    assert.equal(written[0], '______etc_pwned.json');
    assert.equal(fs.existsSync(path.join(root, 'etc')), false);
    assert.equal(fs.existsSync('/etc/pwned'), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('the final assistant message is read from a JSONL transcript', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'autolenis-verif-'));
  const tp = path.join(root, 't.jsonl');
  try {
    fs.writeFileSync(tp, [
      JSON.stringify({ type: 'user', message: { role: 'user', content: 'go' } }),
      JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'Verdict: PASS' }] } }),
    ].join('\n'));
    assert.equal(finalAssistantMessage(tp), 'Verdict: PASS');
    assert.equal(finalAssistantMessage(path.join(root, 'nope.jsonl')), '');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
