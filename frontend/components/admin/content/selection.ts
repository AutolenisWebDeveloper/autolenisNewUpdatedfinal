// Selection state for the Content worktable — pure, so it can be tested
// without a DOM (see __tests__/selection.test.ts).
//
// Two modes, because "select all matching" genuinely is a different thing from
// "these rows": the match can span pages the client has never loaded, so it is
// sent to the server as a FILTER, not as an id list.
//
//   ids          — an explicit set the operator ticked.
//   all-matching — every row matching the current filter, MINUS an exclusion
//                  set. The exclusion set is what makes un-ticking one row in
//                  this mode mean "take this one out of the batch" instead of
//                  "throw the batch away and keep this one".

export type SelectionState =
  | { readonly mode: "ids"; readonly ids: ReadonlySet<string> }
  | { readonly mode: "all-matching"; readonly excluded: ReadonlySet<string> };

export const EMPTY_SELECTION: SelectionState = { mode: "ids", ids: new Set() };

export function clearSelection(): SelectionState {
  return { mode: "ids", ids: new Set() };
}

/** Promote to "every row matching the filter". Any narrower pick is discarded. */
export function selectAllMatching(_state: SelectionState): SelectionState {
  return { mode: "all-matching", excluded: new Set() };
}

export function isRowSelected(state: SelectionState, id: string): boolean {
  return state.mode === "ids" ? state.ids.has(id) : !state.excluded.has(id);
}

/**
 * How many rows the pending action would touch.
 *
 * `totalMatching` is refetched asynchronously, so it can lag the exclusion set;
 * clamp at zero rather than render a negative count in confirmation copy.
 */
export function selectedCount(state: SelectionState, totalMatching: number): number {
  if (state.mode === "ids") return state.ids.size;
  return Math.max(0, totalMatching - state.excluded.size);
}

export function hasSelection(state: SelectionState, totalMatching: number): boolean {
  return selectedCount(state, totalMatching) > 0;
}

/** Flip one row. In all-matching mode this adds/removes an EXCLUSION. */
export function toggleRow(state: SelectionState, id: string): SelectionState {
  if (state.mode === "ids") {
    const ids = new Set(state.ids);
    if (ids.has(id)) ids.delete(id);
    else ids.add(id);
    return { mode: "ids", ids };
  }
  const excluded = new Set(state.excluded);
  if (excluded.has(id)) excluded.delete(id);
  else excluded.add(id);
  return { mode: "all-matching", excluded };
}

export function isPageFullySelected(state: SelectionState, pageIds: readonly string[]): boolean {
  if (pageIds.length === 0) return false;
  return pageIds.every((id) => isRowSelected(state, id));
}

/** Select or deselect every row on the current page, in whichever mode holds. */
export function togglePage(state: SelectionState, pageIds: readonly string[]): SelectionState {
  const allOn = isPageFullySelected(state, pageIds);

  if (state.mode === "ids") {
    const ids = new Set(state.ids);
    for (const id of pageIds) {
      if (allOn) ids.delete(id);
      else ids.add(id);
    }
    return { mode: "ids", ids };
  }

  const excluded = new Set(state.excluded);
  for (const id of pageIds) {
    // allOn ⇒ none of these are excluded yet, so exclude them; else re-include.
    if (allOn) excluded.add(id);
    else excluded.delete(id);
  }
  return { mode: "all-matching", excluded };
}

export type BulkTarget =
  | { ids: string[] }
  | { filter: Record<string, string | number>; excludeIds?: string[] };

/**
 * The payload for POST /api/admin/content/articles/bulk.
 *
 * Returns null when nothing is selected. That guard matters: the endpoint reads
 * a filter with no ids as "every matching row", so an emptied selection must
 * never be allowed to fall through to it.
 */
export function toBulkTarget(
  state: SelectionState,
  filter: Record<string, string | number>,
  totalMatching?: number,
): BulkTarget | null {
  if (state.mode === "ids") {
    if (state.ids.size === 0) return null;
    return { ids: [...state.ids] };
  }
  if (totalMatching !== undefined && selectedCount(state, totalMatching) === 0) return null;
  if (state.excluded.size === 0) return { filter };
  return { filter, excludeIds: [...state.excluded] };
}
