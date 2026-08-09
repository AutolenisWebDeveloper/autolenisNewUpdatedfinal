#!/usr/bin/env node
/**
 * Skill-system validator for the AutoLenis Claude Code configuration.
 *
 *   node .claude/validate-skills.mjs
 *
 * Checks that are cheap, deterministic, and would otherwise rot silently:
 *
 *   1. STRUCTURE  — every skill directory has a SKILL.md with valid frontmatter,
 *                   `name` matching the directory, and a description within the
 *                   length Claude Code will load.
 *   2. ROUTING    — every skill referenced in CLAUDE.md exists on disk, and every
 *                   `autolenis-*` skill on disk is routed from CLAUDE.md. An
 *                   unrouted skill is a skill that will rarely trigger.
 *   3. LINKS      — every `autolenis-*` skill named in a "Cross-skill links"
 *                   section resolves to a real skill.
 *   4. OVERLAP    — pairwise description similarity, to surface two skills
 *                   competing for the same trigger.
 *   5. TRIGGERS   — representative task scenarios score the intended skill top-3
 *                   on description keyword match.
 *
 * This validates the *configuration*, not the quality of the guidance. It is a
 * guard against drift, not a substitute for reading the skills.
 */

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const CLAUDE_DIR = dirname(fileURLToPath(import.meta.url));
const REPO = join(CLAUDE_DIR, "..");
const SKILLS_DIR = join(CLAUDE_DIR, "skills");

const problems = [];
const warnings = [];
const fail = (m) => problems.push(m);
const warn = (m) => warnings.push(m);

// ---------------------------------------------------------------- 1. STRUCTURE
const dirs = readdirSync(SKILLS_DIR)
  .filter((d) => statSync(join(SKILLS_DIR, d)).isDirectory())
  .sort();

const skills = [];
for (const d of dirs) {
  const p = join(SKILLS_DIR, d, "SKILL.md");
  if (!existsSync(p)) {
    fail(`[structure] ${d}: no SKILL.md`);
    continue;
  }
  const text = readFileSync(p, "utf8");
  if (!text.startsWith("---")) {
    fail(`[structure] ${d}: missing YAML frontmatter`);
    continue;
  }
  const end = text.indexOf("\n---", 3);
  if (end === -1) {
    fail(`[structure] ${d}: unterminated frontmatter`);
    continue;
  }
  const fm = text.slice(3, end);
  const name = (/^name:\s*(.+)$/m.exec(fm) || [])[1]?.trim();
  if (!name) fail(`[structure] ${d}: no name`);
  else if (name !== d) fail(`[structure] ${d}: name "${name}" != directory`);

  const descRaw = fm.split(/^description:/m)[1];
  if (!descRaw) {
    fail(`[structure] ${d}: no description`);
    continue;
  }
  // Description runs until the next top-level frontmatter key.
  const desc = descRaw
    .split("\n")
    .filter((l, i) => i === 0 || /^\s/.test(l) || l.trim() === "")
    .join(" ")
    .replace(/^\s*>-?\s*/, "")
    .replace(/\s+/g, " ")
    .trim();
  if (desc.length < 60) fail(`[structure] ${d}: description too short (${desc.length})`);
  if (desc.length > 1024) fail(`[structure] ${d}: description too long (${desc.length} > 1024)`);

  skills.push({ name: d, desc, body: text.slice(end) });
}

const skillNames = new Set(skills.map((s) => s.name));

// ------------------------------------------------------------------ 2. ROUTING
const claudeMd = readFileSync(join(REPO, "CLAUDE.md"), "utf8");
const routed = new Set(claudeMd.match(/autolenis-[a-z0-9-]+/g) || []);

for (const r of routed) {
  if (!skillNames.has(r)) fail(`[routing] CLAUDE.md references "${r}" — no such skill directory`);
}
for (const s of skillNames) {
  if (s.startsWith("autolenis-") && !routed.has(s)) {
    fail(`[routing] skill "${s}" exists but is not routed from CLAUDE.md`);
  }
}

// -------------------------------------------------------------------- 3. LINKS
// Only scan the "Cross-skill links" section. Elsewhere an `autolenis-*` string
// is often a real identifier (a JWT issuer, a package name), not a skill ref.
for (const s of skills) {
  // Heading may be numbered ("## 9. Cross-skill links") in some skills.
  const section = /##\s*(?:\d+\.\s*)?Cross-skill links\s*\n([\s\S]*?)(?=\n##\s|\s*$)/.exec(s.body);
  if (!section) {
    warn(`[links] ${s.name}: no "Cross-skill links" section`);
    continue;
  }
  for (const ref of new Set(section[1].match(/autolenis-[a-z0-9-]+/g) || [])) {
    if (!skillNames.has(ref)) {
      fail(`[links] ${s.name} cross-links unknown skill "${ref}"`);
    }
  }
}

// ------------------------------------------------------------------ 4. OVERLAP
const STOP = new Set(
  ("the this that these those when where which what with without from into onto about "
    + "skill skills claude use uses used using touching touches mention mentions mentioned "
    + "task tasks work works working change changes changed anything something "
    + "frontend autolenis").split(/\s+/),
);
const tokens = (t) =>
  new Set((t.toLowerCase().match(/[a-z][a-z0-9._/-]{4,}/g) || []).filter((w) => !STOP.has(w)));

const tokenized = skills.map((s) => ({ name: s.name, t: tokens(s.desc) }));
const OVERLAP_LIMIT = 0.35;
for (let i = 0; i < tokenized.length; i++) {
  for (let j = i + 1; j < tokenized.length; j++) {
    const a = tokenized[i].t;
    const b = tokenized[j].t;
    let inter = 0;
    for (const x of a) if (b.has(x)) inter++;
    const jaccard = inter / (a.size + b.size - inter);
    if (jaccard > OVERLAP_LIMIT) {
      warn(
        `[overlap] ${tokenized[i].name} ~ ${tokenized[j].name} (${jaccard.toFixed(2)}) — `
          + `descriptions may compete for the same trigger`,
      );
    }
  }
}

// ----------------------------------------------------------------- 5. TRIGGERS
// Each scenario names the skill that MUST be reachable in the top 3 by
// description keyword match. These mirror the audit's evaluation scenarios.
const SCENARIOS = [
  ["Build a new acquisition workflow for sourcing vehicles from a new listing feed", "autolenis-inventory-intelligence"],
  ["Fix an RLS vulnerability letting one buyer read another buyer's row", "autolenis-auth-security-privacy"],
  ["Debug a dealer offer that was submitted but never appeared in the auction", "autolenis-debugging"],
  ["Redesign the buyer dashboard cards and update the brand colors and design tokens", "autolenis-ui-design-system"],
  ["Add MarketCheck as an external inventory provider adapter with retries and timeouts", "autolenis-integrations"],
  ["Fix a race condition in the auction close cron causing duplicate winners", "autolenis-auction-engine"],
  ["Review a Prisma migration that adds a column and an index before we ship it", "autolenis-supabase-postgres"],
  ["Is this feature production ready and can we ship it today", "autolenis-production-readiness"],
  ["The deal is stuck in CONTRACT_APPROVED and never reaches signing", "autolenis-deal-lifecycle"],
  ["Stripe deposit webhook charged the buyer twice on replay", "autolenis-payments-and-ledger"],
];

const score = (scenario, skill) => {
  const q = tokens(scenario);
  let hits = 0;
  for (const w of q) if (skill.t.has(w)) hits++;
  return hits;
};

for (const [scenario, expected] of SCENARIOS) {
  const ranked = tokenized
    .map((s) => ({ name: s.name, score: score(scenario, s) }))
    .sort((a, b) => b.score - a.score);
  const rank = ranked.findIndex((r) => r.name === expected) + 1;
  if (rank === 0 || rank > 3) {
    fail(
      `[trigger] "${scenario.slice(0, 55)}…" → expected ${expected} in top 3, `
        + `got rank ${rank || "unranked"} (top: ${ranked.slice(0, 3).map((r) => r.name).join(", ")})`,
    );
  }
}

// ------------------------------------------------------------------- 6. REPORT
console.log(`skills validated:      ${skills.length}`);
console.log(`routed from CLAUDE.md: ${[...routed].filter((r) => skillNames.has(r)).length}`);
console.log(`trigger scenarios:     ${SCENARIOS.length}`);

if (warnings.length) {
  console.log("\nWARNINGS:");
  for (const w of warnings) console.log(`  ! ${w}`);
}
if (problems.length) {
  console.error("\nFAILURES:");
  for (const p of problems) console.error(`  ✗ ${p}`);
  process.exit(1);
}
console.log("\nOK — skill system structurally valid, fully routed, no broken links.");
