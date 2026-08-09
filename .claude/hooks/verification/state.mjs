/**
 * Per-session verification state — read/write helpers.
 *
 * State lives under `.claude/.verification-state/<session>.json` (gitignored).
 * Every operation is best-effort: a corrupt or unwritable state file must never
 * break the agent's turn, it only means the gate cannot enforce this session.
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const EMPTY = { materialFiles: [], checks: {}, blockCount: 0 };

export function projectRoot(projectDir) {
  return projectDir || process.env.CLAUDE_PROJECT_DIR || process.cwd();
}

export function stateDir(projectDir) {
  return path.join(projectRoot(projectDir), '.claude', '.verification-state');
}

/**
 * True when `<root>/.claude` already exists.
 *
 * Guards `mkdirSync(..., {recursive:true})`, which can block indefinitely when
 * an ancestor is missing on some filesystems (observed hanging on a `/proc`
 * path) — a synchronous hang in a PostToolUse hook stalls the whole turn, and
 * no watchdog timer can interrupt it because the event loop is blocked. If
 * `.claude/` is absent we are not in an AutoLenis checkout, so there is nothing
 * to enforce and skipping is correct as well as safe.
 */
export function canPersist(projectDir) {
  try {
    return fs.existsSync(path.join(projectRoot(projectDir), '.claude'));
  } catch {
    return false;
  }
}

export function statePath(sessionId, projectDir) {
  const safe = String(sessionId || 'default').replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 120);
  return path.join(stateDir(projectDir), `${safe}.json`);
}

export function readState(sessionId, projectDir) {
  try {
    const raw = fs.readFileSync(statePath(sessionId, projectDir), 'utf-8');
    const parsed = JSON.parse(raw);
    return {
      materialFiles: Array.isArray(parsed.materialFiles) ? parsed.materialFiles : [],
      checks: parsed.checks && typeof parsed.checks === 'object' ? parsed.checks : {},
      blockCount: Number(parsed.blockCount) || 0,
    };
  } catch {
    return { ...EMPTY, materialFiles: [], checks: {} };
  }
}

export function writeState(sessionId, state, projectDir) {
  if (!canPersist(projectDir)) return false;
  const target = statePath(sessionId, projectDir);
  try {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    // Write-then-rename so a crashed write can never leave a half-parsed file.
    const tmp = path.join(os.tmpdir(), `autolenis-verif-${process.pid}-${Date.now()}.json`);
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf-8');
    fs.renameSync(tmp, target);
    return true;
  } catch {
    try {
      fs.writeFileSync(target, JSON.stringify(state, null, 2), 'utf-8');
      return true;
    } catch {
      return false;
    }
  }
}

/** Last assistant text block from a Claude Code JSONL transcript. */
export function finalAssistantMessage(transcriptPath) {
  try {
    const lines = fs.readFileSync(transcriptPath, 'utf-8').split('\n').filter(Boolean);
    for (let i = lines.length - 1; i >= 0; i--) {
      let entry;
      try { entry = JSON.parse(lines[i]); } catch { continue; }
      const msg = entry?.message ?? entry;
      if ((entry?.type ?? msg?.role) !== 'assistant' && msg?.role !== 'assistant') continue;
      const content = msg?.content;
      if (typeof content === 'string' && content.trim()) return content;
      if (Array.isArray(content)) {
        const text = content
          .filter((b) => b?.type === 'text' && typeof b.text === 'string')
          .map((b) => b.text)
          .join('\n')
          .trim();
        if (text) return text;
      }
    }
  } catch { /* no transcript → treat as no verdict text */ }
  return '';
}
