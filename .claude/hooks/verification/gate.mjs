#!/usr/bin/env node
/**
 * AutoLenis verification gate — Stop entry point.
 *
 * Blocks the end of a turn when material code changed but the
 * `autolenis-code-verification` loop is incomplete: required checks unrun or
 * red, or no evidence-based verdict in the closing message.
 *
 * Safety rails (a gate that traps the agent is worse than no gate):
 *   • never blocks when `stop_hook_active` is set
 *   • never blocks more than AUTOLENIS_VERIFICATION_MAX_BLOCKS times (default 2)
 *   • disabled entirely with AUTOLENIS_VERIFICATION_HOOK=off
 *   • any internal error exits 0 (allow)
 */

import { evaluate } from './lib.mjs';
import { readState, writeState, finalAssistantMessage } from './state.mjs';

async function readStdin() {
  if (process.stdin.isTTY) return '';
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf-8');
}

async function main() {
  if (process.env.AUTOLENIS_VERIFICATION_HOOK === 'off') process.exit(0);

  let event = {};
  try { event = JSON.parse((await readStdin()) || '{}'); } catch { process.exit(0); }

  const projectDir = process.env.CLAUDE_PROJECT_DIR || event?.cwd || process.cwd();
  const sessionId = event?.session_id || 'default';
  const maxBlocks = Number(process.env.AUTOLENIS_VERIFICATION_MAX_BLOCKS) || 2;

  const state = readState(sessionId, projectDir);
  const finalMessage = event?.transcript_path ? finalAssistantMessage(event.transcript_path) : '';

  const { block, reason } = evaluate(state, {
    stopHookActive: event?.stop_hook_active === true,
    finalMessage,
    maxBlocks,
  });

  if (!block) process.exit(0);

  writeState(sessionId, { ...state, blockCount: (state.blockCount || 0) + 1 }, projectDir);
  process.stdout.write(JSON.stringify({ decision: 'block', reason }));
  process.exit(0);
}

main().catch((err) => {
  if (process.env.AUTOLENIS_VERIFICATION_DEBUG) {
    process.stderr.write(`[autolenis-verification/gate] ${err}\n`);
  }
  process.exit(0);
});
