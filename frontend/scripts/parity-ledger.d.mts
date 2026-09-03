// Types for the parity-ledger generator (scripts/parity-ledger.mjs).
// The generator is plain ESM JavaScript so it can run with bare `node` in CI and in a git hook
// without a TypeScript loader; this declaration keeps its consumers type-checked.

export declare const REPO_ROOT: string;
export declare const PARITY_DIR: string;
export declare const DOC_PATH: string;

export declare const COLUMNS: readonly string[];
export declare const STATUSES: readonly string[];
export declare const DISPOSITIONS: readonly string[];
export declare const PHASES: readonly string[];
export declare const BEGIN: string;
export declare const END: string;

export interface LedgerRow {
  ref: string;
  document_section: string;
  requirement: string;
  current_implementation: string;
  status: string;
  stronger_safeguard: string;
  required_change: string;
  phase: string;
  test_level: string;
  acceptance_evidence: string;
  owner_gated: string;
  legacy_path: string;
  disposition: string;
  area: string;
  key: string;
  line: string;
  status_class: string;
  disposition_class: string;
  phase_class: string;
}

export interface RowCensus {
  headers: number;
  separators: number;
  prose_pipe_lines: number;
  pipe_lines_total: number;
}

/** The document-level census: how the pipe lines partition. Distinct from the per-file RowCensus. */
export interface RowTreatment {
  header_rows_excluded: number;
  separator_rows_excluded: number;
  prose_pipe_lines_excluded: number;
  pipe_lines_total: number;
  ledger_columns: number;
}

export interface AreaTotals {
  rows: number;
  by_status: Record<string, number>;
  by_disposition: Record<string, number>;
  by_phase: Record<string, number>;
}

export interface Ledger {
  source_files: string[];
  source_file_count: number;
  row_treatment: RowTreatment;
  source_ledger_rows: number;
  embedded_ledger_rows: number;
  embedded_matches_source: boolean;
  rows_missing_from_embedded: string[];
  rows_only_in_embedded: number;
  unique_requirement_keys: number;
  duplicate_key_count: number;
  duplicate_keys: string[];
  missing_key_count: number;
  missing_keys: string[];
  bare_refs_reused_across_areas: number;
  by_status: Record<string, number>;
  by_disposition: Record<string, number>;
  by_phase: Record<string, number>;
  per_area: Record<string, AreaTotals>;
}

export declare function sourceFiles(): string[];
export declare function areaOf(file: string): string;
export declare function splitCells(line: string): string[];
export declare function parseRows(text: string, area: string): { rows: LedgerRow[]; census: RowCensus };
export declare function calculateLedger(): Ledger;
export declare function renderLedgerSection(ledger: Ledger): string;
export declare function applyToDocument(docText: string, ledger: Ledger): string;
export declare function readDisplayedLedger(docText: string): {
  source_ledger_rows: number;
  embedded_ledger_rows: number;
  unique_requirement_keys: number;
  duplicate_key_count: number;
  missing_key_count: number;
  by_status: Record<string, number>;
  by_disposition: Record<string, number>;
  by_phase: Record<string, number>;
};
export declare function readDisplayedTablePairs(docText: string): Array<[string, number]>;
