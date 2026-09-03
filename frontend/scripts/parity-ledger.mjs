#!/usr/bin/env node
// docs/transaction-flow parity ledger — the single source of every displayed count.
//
// WHY THIS EXISTS
// The parity map lives twice: as thirteen source tables under docs/transaction-flow/parity/
// and as section 10 of docs/transaction-flow/IMPLEMENTATION-WORKFLOW.md. Earlier revisions
// maintained the totals by hand, and the two copies drifted: rulings applied to one copy were
// silently reverted by a regeneration of the other, and four different row counts were quoted
// for the same ledger. This module calculates every count from the sources, once, and both the
// document and the test consume that calculation. Nothing displayed is typed by a human.
//
// Modes:
//   node scripts/parity-ledger.mjs            → print the ledger as JSON (calculate only)
//   node scripts/parity-ledger.mjs --write    → rewrite section 10 and section 11 from sources
//   node scripts/parity-ledger.mjs --check    → exit 1 if any displayed total differs
//
// No dependencies. Node >= 18.

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname, basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(HERE, '..', '..');
export const PARITY_DIR = join(REPO_ROOT, 'docs', 'transaction-flow', 'parity');
export const DOC_PATH = join(REPO_ROOT, 'docs', 'transaction-flow', 'IMPLEMENTATION-WORKFLOW.md');

// ---------------------------------------------------------------------------
// Counting rules. Every rule is explicit; nothing is inferred at call sites.
// ---------------------------------------------------------------------------

/** The ledger has exactly these columns, in this order. A row is a ledger row only at this width. */
export const COLUMNS = [
  'ref', 'document_section', 'requirement', 'current_implementation', 'status',
  'stronger_safeguard', 'required_change', 'phase', 'test_level', 'acceptance_evidence',
  'owner_gated', 'legacy_path', 'disposition',
];

/** Status vocabulary. A cell is classified by its LEADING token, not by first mention:
 *  seven cells narrate their own history ("PARTIAL (corrected from ALREADY CORRECT…)") and a
 *  first-mention scan mis-files them. Fallback to first mention only if no leading match. */
export const STATUSES = ['ALREADY CORRECT', 'PARTIAL', 'BROKEN', 'MISSING', 'DUPLICATED', 'UNVERIFIED'];

/** Disposition vocabulary, classified the same way. UNVERIFIED dispositions carry a free-text
 *  reason after an em dash, so only the leading token is significant. */
export const DISPOSITIONS = [
  'TO IMPLEMENT', 'TO EXTEND', 'TO CONSOLIDATE', 'ALREADY PRESENT',
  'PRESERVED STRONGER SAFEGUARD', 'OWNER-GATED', 'UNVERIFIED',
];

/** Phases are 1..11. A phase cell may carry prose; the phase is the first bare 1–11 integer. */
export const PHASES = Array.from({ length: 11 }, (_, i) => String(i + 1));

/** Source files: every *.table.md in the parity directory, sorted. The prose area maps
 *  (<area>.md), the critic rounds and marketcheck.md are NOT ledger sources — they contain no
 *  13-column table and contribute no rows. */
export function sourceFiles() {
  return readdirSync(PARITY_DIR)
    .filter((f) => f.endsWith('.table.md'))
    .sort()
    .map((f) => join(PARITY_DIR, f));
}

export const areaOf = (file) => basename(file).slice(0, -'.table.md'.length);

/** Split a markdown table line into cells, honouring backslash-escaped pipes inside cells. */
export function splitCells(line) {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '')
    .split(/(?<!\\)\|/)
    .map((c) => c.trim());
}

const isSeparator = (cells) => /^[-: ]+$/.test(cells.join(''));
const isHeader = (cells) => cells[0] === 'Ref';

function classify(cell, vocabulary) {
  const upper = cell.toUpperCase().replace(/^[*_\s]+/, '');
  return vocabulary.find((v) => upper.startsWith(v))
    ?? vocabulary.find((v) => upper.includes(v))
    ?? 'UNCLASSIFIED';
}

function phaseOf(cell) {
  const m = cell.match(/\b(1[01]|[1-9])\b/);
  return m ? m[1] : 'UNCLASSIFIED';
}

/**
 * Parse one markdown body into ledger rows plus a census of every non-ledger pipe line.
 * Row/prose treatment is decided here and nowhere else:
 *   - separator rows (only dashes/colons)      → counted as `separators`, never rows
 *   - header rows (first cell exactly "Ref")   → counted as `headers`, never rows
 *   - pipe lines that are not 13 cells wide    → counted as `prose_pipe_lines`, never rows
 *   - everything else                          → a ledger row
 */
export function parseRows(text, area) {
  const rows = [];
  const census = { headers: 0, separators: 0, prose_pipe_lines: 0, pipe_lines_total: 0 };
  for (const line of text.split('\n')) {
    if (!line.startsWith('|')) continue;
    census.pipe_lines_total += 1;
    const cells = splitCells(line);
    if (isSeparator(cells)) { census.separators += 1; continue; }
    if (isHeader(cells)) { census.headers += 1; continue; }
    if (cells.length !== COLUMNS.length) { census.prose_pipe_lines += 1; continue; }
    const row = Object.fromEntries(COLUMNS.map((c, i) => [c, cells[i]]));
    rows.push({
      ...row,
      area,
      key: `${area}/${row.ref}`,
      line,
      status_class: classify(row.status, STATUSES),
      disposition_class: classify(row.disposition, DISPOSITIONS),
      phase_class: phaseOf(row.phase),
    });
  }
  return { rows, census };
}

const tally = (rows, pick, vocabulary) => {
  const out = Object.fromEntries(vocabulary.map((v) => [v, 0]));
  for (const r of rows) out[pick(r)] = (out[pick(r)] ?? 0) + 1;
  return out;
};

/** Calculate the whole ledger. This is the ONLY place counts are produced. */
export function calculateLedger() {
  const files = sourceFiles();
  const perArea = {};
  const rows = [];
  const census = { headers: 0, separators: 0, prose_pipe_lines: 0, pipe_lines_total: 0 };

  for (const file of files) {
    const area = areaOf(file);
    const parsed = parseRows(readFileSync(file, 'utf8'), area);
    perArea[area] = {
      rows: parsed.rows.length,
      by_status: tally(parsed.rows, (r) => r.status_class, STATUSES),
      by_disposition: tally(parsed.rows, (r) => r.disposition_class, DISPOSITIONS),
      by_phase: tally(parsed.rows, (r) => r.phase_class, PHASES),
    };
    rows.push(...parsed.rows);
    for (const k of Object.keys(census)) census[k] += parsed.census[k];
  }

  // Embedded copy: the same rows re-rendered inside section 10 of the document.
  const doc = readFileSync(DOC_PATH, 'utf8');
  const embedded = parseRows(doc, 'embedded');
  const embeddedLines = new Set(embedded.rows.map((r) => r.line));
  const missingFromEmbedded = rows.filter((r) => !embeddedLines.has(r.line)).map((r) => r.key);
  const sourceLines = new Set(rows.map((r) => r.line));
  const extraInEmbedded = embedded.rows.filter((r) => !sourceLines.has(r.line)).length;

  // Requirement keys are area-qualified: bare refs are reused across areas by design.
  const keyCounts = new Map();
  for (const r of rows) keyCounts.set(r.key, (keyCounts.get(r.key) ?? 0) + 1);
  const duplicateKeys = [...keyCounts.entries()].filter(([, n]) => n > 1).map(([k]) => k);
  const missingKeys = rows.filter((r) => r.ref === '').map((r) => `${r.area}/<blank>`);
  const bareRefCounts = new Map();
  for (const r of rows) bareRefCounts.set(r.ref, (bareRefCounts.get(r.ref) ?? 0) + 1);

  return {
    source_files: files.map((f) => `docs/transaction-flow/parity/${basename(f)}`),
    source_file_count: files.length,
    row_treatment: {
      header_rows_excluded: census.headers,
      separator_rows_excluded: census.separators,
      prose_pipe_lines_excluded: census.prose_pipe_lines,
      pipe_lines_total: census.pipe_lines_total,
      ledger_columns: COLUMNS.length,
    },
    source_ledger_rows: rows.length,
    embedded_ledger_rows: embedded.rows.length,
    embedded_matches_source: missingFromEmbedded.length === 0 && extraInEmbedded === 0
      && embedded.rows.length === rows.length,
    rows_missing_from_embedded: missingFromEmbedded,
    rows_only_in_embedded: extraInEmbedded,
    unique_requirement_keys: keyCounts.size,
    duplicate_key_count: duplicateKeys.length,
    duplicate_keys: duplicateKeys,
    missing_key_count: missingKeys.length,
    missing_keys: missingKeys,
    bare_refs_reused_across_areas: [...bareRefCounts.values()].filter((n) => n > 1).length,
    by_status: tally(rows, (r) => r.status_class, STATUSES),
    by_disposition: tally(rows, (r) => r.disposition_class, DISPOSITIONS),
    by_phase: tally(rows, (r) => r.phase_class, PHASES),
    per_area: perArea,
  };
}

// ---------------------------------------------------------------------------
// Rendering. The document displays only what calculateLedger() produced.
// ---------------------------------------------------------------------------

export const BEGIN = '<!-- BEGIN GENERATED: parity-ledger (scripts/parity-ledger.mjs) -->';
export const END = '<!-- END GENERATED: parity-ledger -->';

export function renderLedgerSection(ledger) {
  const L = [];
  L.push(BEGIN);
  L.push('');
  L.push('_Every number in this section is calculated by `frontend/scripts/parity-ledger.mjs` from the');
  L.push('thirteen source tables and written here by that script. None of it is maintained by hand, and');
  L.push('`pnpm test:parity-ledger` fails the build if a displayed number differs from the calculated one._');
  L.push('');
  L.push('**Counting rules, stated so the totals are reproducible.** Sources are the '
    + `${ledger.source_file_count} \`docs/transaction-flow/parity/<area>.table.md\` files and nothing else — the prose`);
  L.push('area maps, the critic rounds and the MarketCheck report contain no 13-column table and contribute');
  L.push(`no rows. A line is a ledger row only when it starts with a pipe and parses to exactly`);
  L.push(`${ledger.row_treatment.ledger_columns} cells (pipes escaped inside a cell do not split it). Excluded and counted separately:`);
  L.push(`${ledger.row_treatment.header_rows_excluded} header rows, ${ledger.row_treatment.separator_rows_excluded} separator rows and`);
  L.push(`${ledger.row_treatment.prose_pipe_lines_excluded} other pipe lines, out of ${ledger.row_treatment.pipe_lines_total} pipe lines in total.`);
  L.push('A requirement key is `area/Ref`, because bare refs are reused across areas');
  L.push(`(${ledger.bare_refs_reused_across_areas} of them are).`);
  L.push('');
  L.push('| Ledger fact | Value |');
  L.push('| --- | --- |');
  L.push(`| Source files | ${ledger.source_file_count} |`);
  L.push(`| Source ledger rows | **${ledger.source_ledger_rows}** |`);
  L.push(`| Embedded ledger rows (section 10) | **${ledger.embedded_ledger_rows}** |`);
  L.push(`| Embedded copy identical to source | ${ledger.embedded_matches_source ? 'yes' : 'NO — see the test failure'} |`);
  L.push(`| Unique requirement keys (\`area/Ref\`) | ${ledger.unique_requirement_keys} |`);
  L.push(`| Duplicate keys | ${ledger.duplicate_key_count} |`);
  L.push(`| Rows with a missing key | ${ledger.missing_key_count} |`);
  L.push(`| Bare refs reused across areas | ${ledger.bare_refs_reused_across_areas} |`);
  L.push('');
  L.push('| Status | Rows |');
  L.push('| --- | --- |');
  for (const s of STATUSES) L.push(`| ${s} | ${ledger.by_status[s]} |`);
  L.push('');
  L.push('| Final disposition | Rows |');
  L.push('| --- | --- |');
  for (const d of DISPOSITIONS) L.push(`| ${d} | ${ledger.by_disposition[d]} |`);
  L.push('');
  L.push('| Phase | Rows |');
  L.push('| --- | --- |');
  for (const p of PHASES) L.push(`| ${p} | ${ledger.by_phase[p]} |`);
  L.push('');
  L.push('| Area | Rows | ' + STATUSES.join(' | ') + ' |');
  L.push('| --- |'.repeat(1) + ' --- |'.repeat(STATUSES.length + 1));
  for (const [area, a] of Object.entries(ledger.per_area)) {
    L.push(`| ${area} | ${a.rows} | ` + STATUSES.map((s) => a.by_status[s]).join(' | ') + ' |');
  }
  L.push('');
  L.push('```json parity-ledger');
  L.push(JSON.stringify({
    source_ledger_rows: ledger.source_ledger_rows,
    embedded_ledger_rows: ledger.embedded_ledger_rows,
    unique_requirement_keys: ledger.unique_requirement_keys,
    duplicate_key_count: ledger.duplicate_key_count,
    missing_key_count: ledger.missing_key_count,
    by_status: ledger.by_status,
    by_disposition: ledger.by_disposition,
    by_phase: ledger.by_phase,
  }, null, 2));
  L.push('```');
  L.push('');
  L.push(END);
  return L.join('\n');
}

/** Replace the generated block in the document. Returns the new document text. */
export function applyToDocument(docText, ledger) {
  const block = renderLedgerSection(ledger);
  const start = docText.indexOf(BEGIN);
  const stop = docText.indexOf(END);
  if (start === -1 || stop === -1) {
    throw new Error(`document is missing the generated-block markers ${BEGIN} / ${END}`);
  }
  return docText.slice(0, start) + block + docText.slice(stop + END.length);
}

/** Extract every JSON payload the document displays, for the drift check. */
export function readDisplayedLedger(docText) {
  const m = docText.match(/```json parity-ledger\n([\s\S]*?)\n```/);
  if (!m) throw new Error('document does not display a `json parity-ledger` block');
  return JSON.parse(m[1]);
}

/** Every "| Label | 123 |" pair inside the generated block, for the table-level drift check. */
export function readDisplayedTablePairs(docText) {
  const start = docText.indexOf(BEGIN);
  const stop = docText.indexOf(END);
  if (start === -1 || stop === -1) throw new Error('generated-block markers not found');
  const pairs = [];
  for (const line of docText.slice(start, stop).split('\n')) {
    const m = line.match(/^\|\s*([^|]+?)\s*\|\s*\*{0,2}(\d+)\*{0,2}\s*\|$/);
    if (m) pairs.push([m[1], Number(m[2])]);
  }
  return pairs;
}

// ---------------------------------------------------------------------------
// Decision triage (§13). Same principle as the ledger: the categories and their totals are
// CALCULATED from the table, never typed beside it. Every decision carries exactly one category,
// and the three categories must partition the complete set — a decision that is silently in none,
// or in two, is the failure this exists to catch.

export const TRIAGE_CATEGORIES = [
  'BLOCKING PHASE 1',
  'BLOCKING A NAMED LATER PHASE',
  'DEFAULT AND PROCEED UNLESS OVERRIDDEN',
];

export const TRIAGE_BEGIN = '<!-- BEGIN GENERATED: decision-triage (scripts/parity-ledger.mjs) -->';
export const TRIAGE_END = '<!-- END GENERATED: decision-triage -->';

/** Parse the §13 decision table: every `| D<n> | … | <triage> |` row inside that section. */
export function parseDecisions(docText) {
  const start = docText.indexOf('## §13 ');
  if (start === -1) throw new Error('document has no §13 section');
  let stop = docText.indexOf('\n## ', start + 1);
  if (stop === -1) stop = docText.length;
  const decisions = [];
  for (const line of docText.slice(start, stop).split('\n')) {
    if (!/^\| D\d+ \|/.test(line)) continue;
    const cells = splitCells(line);
    if (cells.length !== 6) {
      throw new Error(`decision row ${cells[0]} has ${cells.length} cells, expected 6 (the triage column is missing)`);
    }
    const raw = cells[5];
    const category = TRIAGE_CATEGORIES.find((c) => raw.startsWith(c)) ?? 'UNCLASSIFIED';
    decisions.push({ id: cells[0], item: cells[1], kind: cells[2], needed_before: cells[3], triage_raw: raw, category });
  }
  return decisions;
}

export function calculateDecisionTriage(docText) {
  const decisions = parseDecisions(docText);
  const by_category = {};
  for (const c of TRIAGE_CATEGORIES) by_category[c] = 0;
  for (const d of decisions) by_category[d.category] = (by_category[d.category] ?? 0) + 1;
  const numeric = (id) => Number(id.slice(1));
  return {
    decision_count: decisions.length,
    by_category,
    categories_sum: Object.values(by_category).reduce((a, b) => a + b, 0),
    unclassified: decisions.filter((d) => d.category === 'UNCLASSIFIED').map((d) => d.id),
    blocking_phase_1: decisions.filter((d) => d.category === 'BLOCKING PHASE 1').map((d) => d.id).sort((a, b) => numeric(a) - numeric(b)),
    blocking_phase_1_items: decisions
      .filter((d) => d.category === 'BLOCKING PHASE 1')
      .sort((a, b) => numeric(a.id) - numeric(b.id))
      .map((d) => ({ id: d.id, item: d.item })),
  };
}

export function renderTriageSection(triage) {
  const rows = TRIAGE_CATEGORIES.map((c) => `| ${c} | **${triage.by_category[c]}** |`).join('\n');
  const blockers = triage.blocking_phase_1_items
    .map((d) => `- **${d.id}** — ${d.item}`)
    .join('\n');
  return [
    TRIAGE_BEGIN,
    '',
    'Every decision below carries exactly one category, and the categories are calculated from the',
    'table rather than tallied by hand. The three counts must sum to the decision count; a decision in',
    'no category, or in two, fails `pnpm test:parity-ledger`.',
    '',
    '| Category | Decisions |',
    '| --- | --- |',
    rows,
    `| **Total** | **${triage.categories_sum}** |`,
    '',
    `Decisions in the table: **${triage.decision_count}**. Categories sum to **${triage.categories_sum}**. Unclassified: **${triage.unclassified.length}**.`,
    '',
    '**BLOCKING PHASE 1 — these, and only these, must be answered before the Phase 1 wave is authored and deployed:**',
    '',
    blockers,
    '',
    'Everything else is either gated on a later phase it names, or has an evidence-supported default',
    'that proceeds unless the owner overrides it. A later-phase decision never blocks Phase 1.',
    '',
    TRIAGE_END,
  ].join('\n');
}

export function applyTriageToDocument(docText, triage) {
  const block = renderTriageSection(triage);
  const start = docText.indexOf(TRIAGE_BEGIN);
  const stop = docText.indexOf(TRIAGE_END);
  if (start === -1 || stop === -1) {
    throw new Error(`document is missing the markers ${TRIAGE_BEGIN} / ${TRIAGE_END}`);
  }
  return docText.slice(0, start) + block + docText.slice(stop + TRIAGE_END.length);
}

// ---------------------------------------------------------------------------

function main() {
  const argv = process.argv.slice(2);
  const ledger = calculateLedger();

  if (argv.includes('--write')) {
    let doc = applyToDocument(readFileSync(DOC_PATH, 'utf8'), ledger);
    doc = applyTriageToDocument(doc, calculateDecisionTriage(doc));
    writeFileSync(DOC_PATH, doc);
    const triage = calculateDecisionTriage(doc);
    process.stdout.write(
      `wrote generated blocks: ${ledger.source_ledger_rows} ledger rows, ${triage.decision_count} decisions\n`,
    );
    return;
  }

  if (argv.includes('--check')) {
    const doc = readFileSync(DOC_PATH, 'utf8');
    const displayed = readDisplayedLedger(doc);
    const problems = [];
    const cmp = (label, a, b) => { if (a !== b) problems.push(`${label}: displayed ${a}, calculated ${b}`); };
    cmp('source_ledger_rows', displayed.source_ledger_rows, ledger.source_ledger_rows);
    cmp('embedded_ledger_rows', displayed.embedded_ledger_rows, ledger.embedded_ledger_rows);
    cmp('unique_requirement_keys', displayed.unique_requirement_keys, ledger.unique_requirement_keys);
    cmp('duplicate_key_count', displayed.duplicate_key_count, ledger.duplicate_key_count);
    cmp('missing_key_count', displayed.missing_key_count, ledger.missing_key_count);
    for (const s of STATUSES) cmp(`status ${s}`, displayed.by_status[s], ledger.by_status[s]);
    for (const d of DISPOSITIONS) cmp(`disposition ${d}`, displayed.by_disposition[d], ledger.by_disposition[d]);
    for (const p of PHASES) cmp(`phase ${p}`, displayed.by_phase[p], ledger.by_phase[p]);

    // The rendered tables are displayed totals too. Checking only the JSON payload would let a
    // human-readable number drift while the machine-readable one stayed right — which is exactly
    // the failure mode this guard exists to prevent.
    const pairs = new Map(readDisplayedTablePairs(doc));
    cmp('table "Source ledger rows"', pairs.get('Source ledger rows'), ledger.source_ledger_rows);
    cmp('table "Embedded ledger rows (section 10)"', pairs.get('Embedded ledger rows (section 10)'), ledger.embedded_ledger_rows);
    cmp('table "Unique requirement keys (`area/Ref`)"', pairs.get('Unique requirement keys (`area/Ref`)'), ledger.unique_requirement_keys);
    cmp('table "Duplicate keys"', pairs.get('Duplicate keys'), ledger.duplicate_key_count);
    cmp('table "Rows with a missing key"', pairs.get('Rows with a missing key'), ledger.missing_key_count);
    cmp('table "Source files"', pairs.get('Source files'), ledger.source_file_count);
    cmp('table "Bare refs reused across areas"', pairs.get('Bare refs reused across areas'), ledger.bare_refs_reused_across_areas);
    for (const s of STATUSES) cmp(`status table row ${s}`, pairs.get(s), ledger.by_status[s]);
    for (const d of DISPOSITIONS) cmp(`disposition table row ${d}`, pairs.get(d), ledger.by_disposition[d]);
    for (const p of PHASES) cmp(`phase table row ${p}`, pairs.get(p), ledger.by_phase[p]);
    if (!ledger.embedded_matches_source) {
      problems.push(`embedded copy differs from source: ${ledger.rows_missing_from_embedded.length} missing, ${ledger.rows_only_in_embedded} extra`);
    }
    if (problems.length) {
      process.stderr.write('parity ledger DRIFT:\n' + problems.map((p) => `  - ${p}`).join('\n') + '\n');
      process.exit(1);
    }
    process.stdout.write(`parity ledger OK: ${ledger.source_ledger_rows} rows, no drift\n`);
    return;
  }

  process.stdout.write(JSON.stringify(ledger, null, 2) + '\n');
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main();
}
