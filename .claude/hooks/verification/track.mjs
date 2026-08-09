#!/usr/bin/env node
/**
 * AutoLenis verification tracker — PostToolUse entry point.
 *
 * Records two things per session:
 *   • material files touched by Edit / Write / MultiEdit
 *   • verification commands run via Bash, with a pass/fail/unknown outcome
 *
 * The Stop gate (gate.mjs) reads this state. Contract: never break a turn —
 * always exit 0, never write to stdout.
 */

import { isMaterialFile, matchCommands, classifyOutcome, toRelative } from './lib.mjs';
import { readState, writeState } from './state.mjs';

async function readStdin() {
  if (process.stdin.isTTY) return '';
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf-8');
}

/** Pure state transition, exported for tests. */
export function applyEvent(state, event, projectDir) {
  const next = {
    materialFiles: [...(state.materialFiles || [])],
    checks: { ...(state.checks || {}) },
    blockCount: state.blockCount || 0,
  };
  const tool = event?.tool_name;
  const input = event?.tool_input || {};

  if (tool === 'Edit' || tool === 'Write' || tool === 'MultiEdit' || tool === 'NotebookEdit') {
    const file = input.file_path || input.notebook_path;
    if (isMaterialFile(file, projectDir)) {
      const rel = toRelative(file, projectDir);
      if (!next.materialFiles.includes(rel)) next.materialFiles.push(rel);
    }
    return next;
  }

  if (tool === 'Bash') {
    const ids = matchCommands(input.command);
    if (ids.length === 0) return next;
    const res = event?.tool_response;
    const output = typeof res === 'string'
      ? res
      : [res?.stdout, res?.stderr, res?.output].filter(Boolean).join('\n');
    const interrupted = res?.interrupted === true;
    for (const id of ids) {
      const outcome = interrupted ? 'fail' : classifyOutcome(id, output);
      const prior = next.checks[id];
      // A later clean run supersedes an earlier failure; a failure never
      // silently overwrites itself into a pass without a fresh run.
      next.checks[id] = { outcome, at: new Date().toISOString(), prior: prior?.outcome };
    }
  }

  return next;
}

async function main() {
  if (process.env.AUTOLENIS_VERIFICATION_HOOK === 'off') process.exit(0);

  let event = {};
  try { event = JSON.parse((await readStdin()) || '{}'); } catch { process.exit(0); }

  const projectDir = process.env.CLAUDE_PROJECT_DIR || event?.cwd || process.cwd();
  const sessionId = event?.session_id || 'default';

  const state = readState(sessionId, projectDir);
  const next = applyEvent(state, event, projectDir);
  writeState(sessionId, next, projectDir);

  process.exit(0);
}

// Only run when invoked as a hook, so tests can import applyEvent cleanly.
if (process.argv[1] && process.argv[1].endsWith('track.mjs')) {
  main().catch((err) => {
    if (process.env.AUTOLENIS_VERIFICATION_DEBUG) {
      process.stderr.write(`[autolenis-verification/track] ${err}\n`);
    }
    process.exit(0);
  });
}
