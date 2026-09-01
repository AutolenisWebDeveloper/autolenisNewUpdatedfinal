// lib/admin/__tests__/content-capability-preservation.test.ts
//
// The Content-workspace acceptance gate, as an executable control.
//
// The owner's condition for reorganising /admin/content was that no working
// capability may become unreachable. That is not a claim you can make by
// inspection across four surfaces and ~60 controls, so it is asserted here.
//
// Every control that existed at baseline 73223c3 is listed below with the
// data-testid it was reachable by. Each entry either KEEPS that id, or records
// the id that replaced it — a move must be written down, and a control that
// simply vanishes fails the suite. Prose in a PR cannot do this job; a list
// that a refactor has to keep satisfying can.
//
// Run with:  npx tsx --test lib/admin/__tests__/content-capability-preservation.test.ts

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();

/** Every source file that can render part of the Content workspace. */
function walk(dir: string, acc: string[] = []): string[] {
  if (!existsSync(dir)) return acc;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, acc);
    else if (/\.tsx?$/.test(entry) && !full.includes("__tests__")) acc.push(full);
  }
  return acc;
}

const SOURCES = [
  ...walk(join(ROOT, "app", "admin", "content")),
  ...walk(join(ROOT, "components", "admin", "content")),
];

const CORPUS = SOURCES.map((f) => readFileSync(f, "utf8")).join("\n");

/** A testid is "present" if any Content surface renders it. */
function renders(testid: string): boolean {
  // Matches both the literal attribute and a template-interpolated row id.
  return (
    CORPUS.includes(`data-testid="${testid}"`) ||
    CORPUS.includes(`data-testid={\`${testid}`) ||
    CORPUS.includes(`"${testid}"`)
  );
}

interface Capability {
  /** What an operator can do. */
  what: string;
  /** The id it was reachable by at baseline. */
  was: string;
  /**
   * The id it is reachable by now. Omit when unchanged. A value here is a
   * RECORDED MOVE — it documents where a control went, and the test still
   * proves the destination exists.
   */
  now?: string;
  /**
   * Set only when a control's behaviour is now supplied by a shared primitive
   * that owns its own markup, so the old id cannot survive. The replacement
   * must still be named, and the note must say what provides the behaviour.
   */
  viaPrimitive?: string;
  /**
   * For an id the primitive BUILDS from a prop rather than writing literally.
   * Both halves are then proved: the Content surface passes `anchor`, and the
   * named primitive file really appends `suffix` to it. Without this the test
   * would have to take a template-generated id on trust.
   */
  derivedFrom?: { anchor: string; suffix: string; file: string };
}

// ── /admin/content — the Content Engine dashboard ───────────────────────────
const DASHBOARD: Capability[] = [
  { what: "The Content Engine page itself", was: "admin-content-page" },
  { what: "Link to the review queue (was 'Bulk Articles')", was: "admin-content-bulk-link" },
  { what: "Link to attribution", was: "admin-content-attribution-link" },
  { what: "Pipeline totals by status", was: "content-kpis" },
  { what: "Wave 1 coverage and published words", was: "content-coverage" },
  { what: "Breakdown by cluster", was: "content-cluster-table" },
  { what: "Breakdown by metro", was: "content-metro-table" },
  { what: "The article list", was: "content-article-list" },
  { what: "Each row's link to its article", was: "content-row-" },
  { what: "Empty state when filters match nothing", was: "content-list-empty" },
  { what: "Pagination", was: "content-pagination" },
  { what: "Clear all filters", was: "content-filter-clear" },
  // Merged into the one worktable toolbar; the filter controls themselves are
  // asserted under the worktable block below.
  { what: "Filter bar", was: "content-filters" },
  { what: "Search articles", was: "content-search", now: "search-input" },
  { what: "Filter by cluster", was: "content-filter-cluster", now: "filter-cluster" },
  { what: "Filter by status", was: "content-filter-status", now: "filter-status" },
  { what: "Filter by metro", was: "content-filter-metro", now: "filter-metro" },
];

// ── /admin/content/bulk — every control the old worktable offered ───────────
const WORKTABLE: Capability[] = [
  { what: "The review-queue page", was: "bulk-article-page" },
  // These three were missing from the first draft of this fixture, and the
  // suite passed anyway while the banner had in fact been dropped. A
  // preservation list only preserves what it actually names.
  { what: "Review-needed shortcut banner", was: "review-banner" },
  { what: "Publish everything awaiting review", was: "banner-publish-all" },
  { what: "Jump to the review queue", was: "banner-review-first" },
  { what: "Status counters that filter the list", was: "stat-strip" },
  { what: "The article worktable", was: "article-table" },
  { what: "Each article row", was: "article-row-" },
  { what: "Each row's checkbox", was: "row-check-" },
  { what: "Each row's quality flags", was: "row-flags-" },
  { what: "Preview a row", was: "row-preview-" },
  { what: "Publish a row", was: "row-publish-" },
  { what: "Archive a row", was: "row-retire-" },
  { what: "Each status counter", was: "stat-card-" },
  { what: "Select every row on the page", was: "select-page" },
  { what: "Select every row matching the filters", was: "select-all-matching" },
  { what: "Clear the selection", was: "clear-selection" },
  { what: "How many rows are selected", was: "selected-count" },
  { what: "Bulk publish", was: "bulk-publish" },
  { what: "Bulk archive (was 'Retire All')", was: "bulk-retire" },
  { what: "Search", was: "search-input" },
  { what: "Filter by status", was: "filter-status" },
  { what: "Filter by cluster", was: "filter-cluster" },
  { what: "Filter by metro", was: "filter-metro" },
  { what: "Filter by quality band", was: "filter-quality" },
  { what: "Sort", was: "filter-sort" },
  { what: "Loading state", was: "table-loading" },
  { what: "Empty state", was: "table-empty" },
  { what: "Toolbar", was: "toolbar" },
  { what: "Pagination readout", was: "pagination" },
  { what: "Previous page", was: "page-prev" },
  { what: "Next page", was: "page-next" },
  { what: "Result toast", was: "toast" },
  { what: "Preview drawer", was: "preview-drawer" },
  { what: "Preview body", was: "drawer-body" },
  { what: "Preview quality flags", was: "drawer-flags" },
  { what: "Preview FAQ", was: "drawer-faqs" },
  { what: "Publish from the preview", was: "drawer-publish" },
  { what: "Archive from the preview", was: "drawer-retire" },
  { what: "Preview load error", was: "drawer-error" },
  { what: "Retry a failed preview", was: "drawer-retry" },
  { what: "Bulk confirmation breakdown", was: "confirm-breakdown" },
  {
    what: "Cancel a bulk action",
    was: "confirm-cancel",
    viaPrimitive: "the kit ConfirmDialog derives its button ids from data-testid='confirm'",
    derivedFrom: {
      anchor: "confirm",
      suffix: "-cancel",
      file: "components/admin/crm/ui/ConfirmDialog.tsx",
    },
  },
  {
    what: "Confirm a bulk action",
    was: "confirm-run",
    now: "confirm-confirm",
    viaPrimitive: "the kit ConfirmDialog derives its button ids from data-testid='confirm'",
    derivedFrom: {
      anchor: "confirm",
      suffix: "-confirm",
      file: "components/admin/crm/ui/ConfirmDialog.tsx",
    },
  },
  {
    what: "The bulk confirmation dialog",
    was: "confirm-modal",
    now: "confirm",
    viaPrimitive: "the kit ConfirmDialog owns the dialog element",
  },
  {
    what: "Dismiss the confirmation by clicking outside",
    was: "confirm-backdrop",
    now: "confirm",
    viaPrimitive:
      "Radix DialogOverlay handles outside-click dismissal, plus Escape, focus trap and focus return",
  },
  {
    what: "Close the preview drawer",
    was: "drawer-close",
    now: "preview-drawer",
    viaPrimitive: "Radix DialogContent renders its own labelled close button, and Escape closes",
  },
  {
    what: "Close the preview drawer with the X",
    was: "drawer-close-x",
    now: "preview-drawer",
    viaPrimitive: "Radix DialogContent renders its own labelled close button",
  },
  {
    what: "Dismiss the preview by clicking outside",
    was: "drawer-backdrop",
    now: "preview-drawer",
    viaPrimitive: "Radix DialogOverlay handles outside-click dismissal",
  },
];

// ── /admin/content/[id] — the review page ───────────────────────────────────
const DETAIL: Capability[] = [
  { what: "The article review page", was: "admin-content-detail-page" },
  { what: "Status controls", was: "content-detail-actions" },
  { what: "Status action buttons", was: "article-status-actions" },
  { what: "Each status transition button", was: "article-action-" },
  { what: "Status change error", was: "article-action-error" },
  { what: "Article body preview", was: "content-detail-body" },
  { what: "FAQ block", was: "content-detail-faqs" },
  { what: "Quality score", was: "content-detail-quality" },
  { what: "Failed rubric checks", was: "content-detail-flags" },
  { what: "Article metadata", was: "content-detail-meta" },
  { what: "SEO title and meta description", was: "content-detail-seo" },
];

// ── /admin/content/attribution — untouched by this batch ────────────────────
const ATTRIBUTION: Capability[] = [
  { what: "The attribution page", was: "content-attribution-page" },
  { what: "Export attribution CSV", was: "attribution-export-csv" },
  { what: "30-day trend", was: "attribution-trend" },
  { what: "By cluster", was: "attribution-by-cluster" },
  { what: "By metro", was: "attribution-by-metro" },
  { what: "By state", was: "attribution-by-state" },
  { what: "By city", was: "attribution-by-city" },
  { what: "Top articles", was: "attribution-top-articles" },
  { what: "Attribution KPI cards", was: "kpi-" },
];

const ALL: Array<[string, Capability[]]> = [
  ["/admin/content", DASHBOARD],
  ["/admin/content/bulk", WORKTABLE],
  ["/admin/content/[id]", DETAIL],
  ["/admin/content/attribution", ATTRIBUTION],
];

describe("content capability preservation — nothing that worked has gone missing", () => {
  for (const [surface, capabilities] of ALL) {
    for (const cap of capabilities) {
      const target = cap.now ?? cap.was;
      test(`${surface}: ${cap.what}`, () => {
        if (cap.derivedFrom) {
          const { anchor, suffix, file } = cap.derivedFrom;
          assert.ok(
            renders(anchor),
            `"${cap.what}" is built from data-testid="${anchor}", which the Content workspace no longer passes`,
          );
          const primitive = readFileSync(join(ROOT, file), "utf8");
          assert.ok(
            primitive.includes(`\${testId}${suffix}`),
            `${file} no longer derives "${suffix}" from its testid prop, so ${target} does not exist`,
          );
          return;
        }
        assert.ok(
          renders(target),
          cap.now
            ? `"${cap.what}" moved from ${cap.was} to ${target}, but ${target} is not rendered ` +
                `anywhere in the Content workspace${cap.viaPrimitive ? ` (${cap.viaPrimitive})` : ""}`
            : `"${cap.what}" was reachable at baseline via ${cap.was} and is no longer rendered`,
        );
      });
    }
  }
});

describe("newly reachable — capability that existed only on the server", () => {
  // These endpoints were built, audit-logged and capability-gated with no UI
  // consumer anywhere in app/** or components/**. Job retry in particular was
  // the only recovery path for a half-failed generation batch.
  const NEW: Array<[string, string]> = [
    ["Open generation and jobs", "content-jobs-trigger"],
    ["Start a generation batch", "content-generate-submit"],
    ["Choose the cluster to generate", "content-generate-cluster"],
    ["Regenerate existing articles", "content-generate-regenerate"],
    ["Send generated articles to review", "content-generate-review-only"],
    ["See generation jobs and their progress", "content-jobs-list"],
    ["Refresh the job list", "content-jobs-refresh"],
    ["Empty state when no batch has run", "content-jobs-empty"],
    ["Bulk move to draft", "bulk-draft"],
    ["Open the full review from the preview", "drawer-open-detail"],
    ["See why a publish was blocked", "content-detail-publish-failure"],
    ["See a pending scheduled publish", "content-detail-scheduled"],
    ["Return to the Content Engine from attribution", "attribution-parent-link"],
    ["Know the export contains buyer email before downloading", "attribution-export-pii-notice"],
    ["Read the 30-day trend as a table, not only as bars", "attribution-trend-table"],
  ];

  for (const [what, testid] of NEW) {
    test(what, () => {
      assert.ok(renders(testid), `${what} should now be reachable via ${testid}`);
    });
  }

  test("job controls exist for every job action the server accepts", () => {
    // retry / cancel / pause / resume are the four the route accepts; the row
    // ids are interpolated, so assert the template rather than a literal.
    assert.ok(
      CORPUS.includes("content-job-${action}-${job.id}") ||
        CORPUS.includes("`content-job-${action}-${job.id}`"),
      "the job control buttons must be individually addressable",
    );
    for (const action of ["retry", "cancel", "pause", "resume"]) {
      assert.ok(CORPUS.includes(`"${action}"`), `job action ${action} must be offered`);
    }
  });
});

describe("states that must survive the reorganisation", () => {
  test("a streaming fallback exists for the dynamic dashboard", () => {
    assert.ok(existsSync(join(ROOT, "app", "admin", "content", "loading.tsx")));
  });

  test("an error boundary scopes failures to this subtree", () => {
    assert.ok(existsSync(join(ROOT, "app", "admin", "content", "error.tsx")));
  });

  test("the no-content and no-match empty states are distinct", () => {
    // One message for both cases told a first-run operator to adjust filters
    // that did not exist, instead of telling them to generate content.
    assert.ok(renders("content-list-empty"), "no-match state");
    assert.ok(renders("content-list-empty-no-content"), "no-content-at-all state");
  });

  test("the list has its own error state with a retry", () => {
    assert.ok(renders("table-error"));
    assert.ok(renders("table-retry"));
  });
});

describe("one vocabulary for one database state", () => {
  test("ARCHIVED is never shown as 'Retired'", () => {
    // The same enum value was shown as "Archived", "Archive", "Retired" and
    // "reject" across four surfaces. The label now comes from cluster-meta.
    const offenders = SOURCES.filter((f) => /["'>]\s*Retire[d]?\b/.test(readFileSync(f, "utf8")));
    assert.deepEqual(
      offenders.map((f) => f.replace(`${ROOT}/`, "")),
      [],
      "user-facing copy must say Archived, matching the database value and the detail page",
    );
  });

  test("no surface re-implements the status or cluster label maps", () => {
    // Local restatements are how the vocabulary drifted in the first place.
    for (const file of SOURCES) {
      const src = readFileSync(file, "utf8");
      const rel = file.replace(`${ROOT}/`, "");
      assert.ok(
        !src.includes("const CLUSTER_LABELS"),
        `${rel} restates CLUSTER_LABELS — import it from lib/content/cluster-meta`,
      );
      assert.ok(
        !src.includes("const STATUS_DISPLAY"),
        `${rel} restates the status labels — import statusMeta from lib/content/cluster-meta`,
      );
    }
  });
});

// ── Completeness ────────────────────────────────────────────────────────────
//
// Everything above is a hand-written allow-list, and an allow-list reports on
// what it enumerates while staying silent on what it omits. That is not
// theoretical: the first draft of this file passed 90/90 while the review
// banner and both of its actions had in fact been dropped, because the fixture
// had never named them. A green run meant "nothing on the list was lost", and
// was read as "nothing was lost".
//
// So the baseline is derived from the artifact rather than from memory. The
// list below is every data-testid present in the Content workspace at the base
// commit 73223c3, extracted mechanically:
//
//   git show 73223c3:<each content source> \
//     | grep -oE 'data-testid=\{?`?"?[a-z0-9-]+' | sed -E 's/.*"?//' | sort -u
//
// A baseline id the fixture does not mention fails the suite. To retire one,
// name it in WAIVED with a reason — a deliberate, reviewable act.
const BASELINE_TESTIDS = [
  "admin-content-attribution-link", "admin-content-bulk-link", "admin-content-detail-page",
  "admin-content-page", "article-action-", "article-action-error", "article-row-",
  "article-status-actions", "article-table", "attribution-export-csv", "attribution-trend",
  "banner-publish-all", "banner-review-first", "bulk-article-page", "bulk-publish",
  "bulk-retire", "clear-selection", "confirm-backdrop", "confirm-breakdown", "confirm-cancel",
  "confirm-modal", "confirm-run", "content-article-list", "content-attribution-page",
  "content-coverage", "content-detail-actions", "content-detail-body", "content-detail-faqs",
  "content-detail-flags", "content-detail-meta", "content-detail-quality", "content-detail-seo",
  "content-filter-clear", "content-filter-cluster", "content-filter-metro",
  "content-filter-status", "content-filters", "content-kpis", "content-list-empty",
  "content-pagination", "content-row-", "content-search", "drawer-backdrop", "drawer-body",
  "drawer-close", "drawer-close-x", "drawer-error", "drawer-faqs", "drawer-flags",
  "drawer-publish", "drawer-retire", "drawer-retry", "kpi-", "page-next", "page-prev",
  "pagination", "preview-drawer", "review-banner", "row-check-", "row-flags-", "row-preview-",
  "row-publish-", "row-retire-", "search-input", "select-all-matching", "select-page",
  "selected-count", "stat-card-", "stat-strip", "table-empty", "table-loading", "toast",
  "toolbar",
] as const;

/** Baseline ids deliberately not treated as capabilities, each with a reason. */
const WAIVED: Record<string, string> = {
  // Artifacts of `data-testid={testId}` prop plumbing, not ids in their own
  // right; the controls they render are named individually above.
  test: "attribute-name artifact of the extraction, not a rendered id",
  testid: "attribute-name artifact of the extraction, not a rendered id",
};

describe("the preservation fixture is complete, not merely self-consistent", () => {
  const named = new Set(ALL.flatMap(([, caps]) => caps.map((c) => c.was)));

  test("every control present at baseline 73223c3 is accounted for", () => {
    const unaccounted = BASELINE_TESTIDS.filter((id) => !named.has(id) && !(id in WAIVED));
    assert.deepEqual(
      unaccounted,
      [],
      `these controls existed at baseline and this fixture never mentions them, so the ` +
        `suite would pass while they were quietly dropped:\n  ${unaccounted.join("\n  ")}`,
    );
  });

  test("the fixture does not claim controls the baseline never had", () => {
    // Guards the other direction: a fixture padded with ids that never existed
    // inflates the count without proving anything. Ids introduced BY this batch
    // belong in the "newly reachable" block, not in the preservation list.
    const INTRODUCED_BY_THIS_BATCH = new Set([
      "content-cluster-table", "content-metro-table", "filter-status", "filter-cluster",
      "filter-metro", "filter-quality", "filter-sort", "attribution-by-cluster",
      "attribution-by-metro", "attribution-by-state", "attribution-by-city",
      "attribution-top-articles",
    ]);
    const baseline = new Set<string>(BASELINE_TESTIDS);
    const invented = [...named].filter(
      (id) => !baseline.has(id) && !INTRODUCED_BY_THIS_BATCH.has(id),
    );
    assert.deepEqual(invented, [], `fixture names ids absent from the baseline: ${invented}`);
  });
});
