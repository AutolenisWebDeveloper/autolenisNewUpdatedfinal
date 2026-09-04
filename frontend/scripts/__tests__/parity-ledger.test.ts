// Drift guard for the parity ledger.
//
// The parity map exists twice (thirteen source tables, and section 10 of the workflow document)
// and its totals are displayed in a third place. Earlier revisions maintained those totals by
// hand and they drifted: four different row counts were quoted for the same ledger, and a
// regeneration silently reverted hand-corrections. These tests fail the build if any displayed
// number differs from the number the generator calculates, or if the two copies of the rows
// diverge by a single byte.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import {
  calculateLedger,
  readDisplayedLedger,
  readDisplayedTablePairs,
  applyToDocument,
  sourceFiles,
  parseRows,
  splitCells,
  COLUMNS,
  STATUSES,
  DISPOSITIONS,
  PHASES,
  DOC_PATH,
  REPO_ROOT,
  calculateDecisionTriage,
  parseDecisions,
  applyTriageToDocument,
  TRIAGE_CATEGORIES,
} from "../parity-ledger.mjs";

const doc = () => readFileSync(DOC_PATH, "utf8");

describe("parity ledger — the document displays only what the generator calculated", () => {
  test("every scalar the document displays equals the calculated value", () => {
    const calculated = calculateLedger();
    const displayed = readDisplayedLedger(doc());

    assert.equal(displayed.source_ledger_rows, calculated.source_ledger_rows);
    assert.equal(displayed.embedded_ledger_rows, calculated.embedded_ledger_rows);
    assert.equal(displayed.unique_requirement_keys, calculated.unique_requirement_keys);
    assert.equal(displayed.duplicate_key_count, calculated.duplicate_key_count);
    assert.equal(displayed.missing_key_count, calculated.missing_key_count);
  });

  test("every status, disposition and phase total equals the calculated total", () => {
    const calculated = calculateLedger();
    const displayed = readDisplayedLedger(doc());
    for (const s of STATUSES) assert.equal(displayed.by_status[s], calculated.by_status[s], `status ${s}`);
    for (const d of DISPOSITIONS) assert.equal(displayed.by_disposition[d], calculated.by_disposition[d], `disposition ${d}`);
    for (const p of PHASES) assert.equal(displayed.by_phase[p], calculated.by_phase[p], `phase ${p}`);
  });

  test("the rendered tables agree with the JSON payload — one source, not two", () => {
    const displayed = readDisplayedLedger(doc());
    const pairs = new Map(readDisplayedTablePairs(doc()));
    assert.equal(pairs.get("Source ledger rows"), displayed.source_ledger_rows);
    assert.equal(pairs.get("Embedded ledger rows (section 10)"), displayed.embedded_ledger_rows);
    for (const s of STATUSES) assert.equal(pairs.get(s), displayed.by_status[s], `status table row ${s}`);
    for (const d of DISPOSITIONS) assert.equal(pairs.get(d), displayed.by_disposition[d], `disposition table row ${d}`);
  });

  test("each tally sums to the row count — a partition, not a sample", () => {
    const c = calculateLedger();
    const sum = (o: Record<string, number>) => Object.values(o).reduce((a, b) => a + b, 0);
    assert.equal(sum(c.by_status), c.source_ledger_rows, "status tally");
    assert.equal(sum(c.by_disposition), c.source_ledger_rows, "disposition tally");
    assert.equal(sum(c.by_phase), c.source_ledger_rows, "phase tally");
    assert.equal(
      Object.values(c.per_area).reduce((a: number, x: { rows: number }) => a + x.rows, 0),
      c.source_ledger_rows,
      "per-area tally",
    );
  });

  test("nothing is UNCLASSIFIED — every cell matched a declared vocabulary", () => {
    const c = calculateLedger();
    assert.ok(!("UNCLASSIFIED" in c.by_status), `unclassified status cells: ${JSON.stringify(c.by_status)}`);
    assert.ok(!("UNCLASSIFIED" in c.by_disposition), `unclassified disposition cells: ${JSON.stringify(c.by_disposition)}`);
    assert.ok(!("UNCLASSIFIED" in c.by_phase), `rows with no phase in 1..11: ${JSON.stringify(c.by_phase)}`);
  });
});

describe("parity ledger — the two copies of the rows cannot diverge", () => {
  test("section 10 is byte-identical to the source tables, row for row", () => {
    const c = calculateLedger();
    assert.deepEqual(c.rows_missing_from_embedded, [], "source rows absent from section 10");
    assert.equal(c.rows_only_in_embedded, 0, "rows in section 10 that no source table has");
    assert.equal(c.embedded_ledger_rows, c.source_ledger_rows);
    assert.equal(c.embedded_matches_source, true);
  });

  test("requirement keys are area-qualified and unique", () => {
    const c = calculateLedger();
    assert.equal(c.duplicate_key_count, 0, `duplicate keys: ${c.duplicate_keys.join(", ")}`);
    assert.equal(c.missing_key_count, 0, `rows with no ref: ${c.missing_keys.join(", ")}`);
    assert.equal(c.unique_requirement_keys, c.source_ledger_rows);
    assert.ok(c.bare_refs_reused_across_areas > 0, "bare refs are reused across areas — keys must stay qualified");
  });

  test("regenerating from a clean state reproduces the committed document exactly", () => {
    const before = doc();
    const after = applyToDocument(before, calculateLedger());
    assert.equal(after, before, "the committed document differs from what the generator produces");
  });
});

describe("parity ledger — the counting rules are the ones the document states", () => {
  test("sources are exactly the thirteen area tables", () => {
    const files = sourceFiles();
    assert.equal(files.length, 13);
    assert.ok(files.every((f: string) => f.endsWith(".table.md")));
    // The prose maps and critic rounds must contribute nothing.
    assert.ok(!files.some((f: string) => f.endsWith("critic-round-1.md") || f.endsWith("marketcheck.md")));
  });

  test("header, separator and non-13-cell pipe lines are excluded and counted", () => {
    const c = calculateLedger();
    const t = c.row_treatment;
    assert.equal(t.ledger_columns, COLUMNS.length);
    assert.equal(
      t.pipe_lines_total,
      c.source_ledger_rows + t.header_rows_excluded + t.separator_rows_excluded + t.prose_pipe_lines_excluded,
      "pipe lines must partition into rows + headers + separators + prose",
    );
    assert.ok(t.header_rows_excluded >= 13, "at least one header per area table");
  });

  test("an escaped pipe inside a cell does not split it", () => {
    const cells = splitCells("| A | b \\| c | d |");
    assert.deepEqual(cells, ["A", "b \\| c", "d"]);
  });

  test("a status cell that narrates its history is classified by its leading token", () => {
    const { rows } = parseRows(
      ["| X | MD | req | impl | PARTIAL (corrected from ALREADY CORRECT) | safe | change | 3 | unit | ev | none | none | TO EXTEND |"].join("\n"),
      "probe",
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].status_class, "PARTIAL");
    assert.equal(rows[0].disposition_class, "TO EXTEND");
    assert.equal(rows[0].phase_class, "3");
  });
});

describe("parity ledger — the guard actually fails on drift", () => {
  test("--check exits non-zero when a displayed total is edited", () => {
    const original = doc();
    const tampered = original.replace(
      /\| Source ledger rows \| \*\*(\d+)\*\* \|/,
      (_m, n) => `| Source ledger rows | **${Number(n) + 1}** |`,
    );
    assert.notEqual(tampered, original, "tamper pattern did not match — the guard would be vacuous");

    // Run the checker against a tampered copy via a temporary document swap.
    const fs = require("node:fs") as typeof import("node:fs");
    const backup = `${DOC_PATH}.drift-test-backup`;
    fs.copyFileSync(DOC_PATH, backup);
    try {
      fs.writeFileSync(DOC_PATH, tampered);
      let exitCode = 0;
      try {
        execFileSync(process.execPath, [join(REPO_ROOT, "frontend", "scripts", "parity-ledger.mjs"), "--check"], {
          stdio: "pipe",
        });
      } catch (err: unknown) {
        exitCode = (err as { status?: number }).status ?? -1;
      }
      assert.equal(exitCode, 1, "the checker must exit 1 when a displayed total is wrong");
    } finally {
      fs.copyFileSync(backup, DOC_PATH);
      fs.rmSync(backup);
    }
    assert.equal(doc(), original, "the drift test must leave the document exactly as it found it");
  });
});

describe("decision triage — every decision in exactly one category, counted by machine", () => {
  test("the three categories partition the decisions and sum to the total", () => {
    const t = calculateDecisionTriage(doc());
    assert.equal(t.categories_sum, t.decision_count, "categories must sum to the decision count");
    assert.deepEqual(t.unclassified, [], `decisions with no category: ${t.unclassified.join(", ")}`);
    assert.equal(Object.keys(t.by_category).length, TRIAGE_CATEGORIES.length, "no category invented");
    assert.ok(t.decision_count > 0, "the §13 table must have decisions");
  });

  test("every decision row carries exactly one category from the declared vocabulary", () => {
    for (const d of parseDecisions(doc())) {
      const matches = TRIAGE_CATEGORIES.filter((c: string) => d.triage_raw.startsWith(c));
      assert.equal(matches.length, 1, `${d.id} matched ${matches.length} categories: ${d.triage_raw}`);
      assert.equal(d.category, matches[0]);
    }
  });

  test("no later-phase decision is allowed to block Phase 1", () => {
    for (const d of parseDecisions(doc())) {
      if (d.category !== "BLOCKING PHASE 1") continue;
      const laterPhase = d.needed_before.match(/Phase (\d+)/);
      if (laterPhase && Number(laterPhase[1]) > 1) {
        assert.fail(`${d.id} is tagged BLOCKING PHASE 1 but is needed before ${d.needed_before}`);
      }
    }
  });

  test("the displayed totals equal the calculated totals", () => {
    const t = calculateDecisionTriage(doc());
    const text = doc();
    for (const c of TRIAGE_CATEGORIES) {
      const m = text.match(new RegExp(`\\| ${c} \\| \\*\\*(\\d+)\\*\\* \\|`));
      assert.ok(m, `category ${c} is not displayed`);
      assert.equal(Number(m![1]), t.by_category[c], `displayed total for ${c}`);
    }
    const total = text.match(/\| \*\*Total\*\* \| \*\*(\d+)\*\* \|/);
    assert.ok(total, "the total row is not displayed");
    assert.equal(Number(total![1]), t.decision_count);
  });

  test("every BLOCKING PHASE 1 decision is listed by name, and nothing else is", () => {
    const t = calculateDecisionTriage(doc());
    const text = doc();
    const start = text.indexOf("**BLOCKING PHASE 1 —");
    const listed = [...text.slice(start, start + 2000).matchAll(/^- \*\*(D\d+)\*\*/gm)].map((m) => m[1]);
    assert.deepEqual(listed, t.blocking_phase_1, "the listed blockers must be exactly the calculated ones");
  });

  test("regenerating the triage block reproduces the committed document exactly", () => {
    const before = doc();
    assert.equal(applyTriageToDocument(before, calculateDecisionTriage(before)), before);
  });
});
