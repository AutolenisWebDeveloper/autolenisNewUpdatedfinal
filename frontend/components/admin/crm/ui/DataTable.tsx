'use client';

import * as React from 'react';
import { ArrowUpDown, ChevronDown, ChevronUp, Rows2, Rows3 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { density as densityTokens, type Density } from './tokens';
import { SkeletonRows } from './Skeleton';

export interface Column<T> {
  id: string;
  header: React.ReactNode;
  cell: (row: T) => React.ReactNode;
  /** Enables header sort control + supplies the comparable value. */
  sortable?: boolean;
  sortValue?: (row: T) => string | number | null | undefined;
  align?: 'left' | 'right' | 'center';
  /** Tailwind width class, e.g. `w-10`. */
  widthClass?: string;
  className?: string;
  headerClassName?: string;
}

export interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  getRowId: (row: T) => string;
  loading?: boolean;
  /** Renders in place of the table body when set. */
  error?: React.ReactNode;
  /** Renders when not loading and rows is empty. */
  empty?: React.ReactNode;
  /** Inline filter toolbar rendered above the table. */
  toolbar?: React.ReactNode;
  /** Row click handler (whole row becomes interactive). */
  onSelect?: (row: T) => void;
  /** Optional leading cell per row (e.g. a checkbox). */
  leading?: (row: T) => React.ReactNode;
  leadingHeader?: React.ReactNode;
  /** Density. Uncontrolled by default; pass `density` + `onDensityChange` to control. */
  density?: Density;
  defaultDensity?: Density;
  onDensityChange?: (d: Density) => void;
  showDensityToggle?: boolean;
  /** Highlight a row as active (e.g. open in SlideOver). */
  activeRowId?: string | null;
  className?: string;
  'data-testid'?: string;
}

type SortState = { colId: string; dir: 'asc' | 'desc' } | null;

export function DataTable<T>({
  columns,
  rows,
  getRowId,
  loading = false,
  error,
  empty,
  toolbar,
  onSelect,
  leading,
  leadingHeader,
  density,
  defaultDensity = 'comfortable',
  onDensityChange,
  showDensityToggle = true,
  activeRowId,
  className,
  'data-testid': testId,
}: DataTableProps<T>) {
  const [internalDensity, setInternalDensity] = React.useState<Density>(defaultDensity);
  const activeDensity = density ?? internalDensity;
  const d = densityTokens[activeDensity];

  const [sort, setSort] = React.useState<SortState>(null);

  function setDensity(next: Density) {
    if (onDensityChange) onDensityChange(next);
    else setInternalDensity(next);
  }

  function toggleSort(colId: string) {
    setSort((prev) => {
      if (!prev || prev.colId !== colId) return { colId, dir: 'asc' };
      if (prev.dir === 'asc') return { colId, dir: 'desc' };
      return null;
    });
  }

  const sortedRows = React.useMemo(() => {
    if (!sort) return rows;
    const col = columns.find((c) => c.id === sort.colId);
    if (!col?.sortValue) return rows;
    const factor = sort.dir === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      const av = col.sortValue!(a);
      const bv = col.sortValue!(b);
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * factor;
      return String(av).localeCompare(String(bv)) * factor;
    });
  }, [rows, sort, columns]);

  const colSpan = columns.length + (leading ? 1 : 0);

  return (
    <div className={cn('flex flex-col gap-2', className)} data-testid={testId}>
      {(toolbar || showDensityToggle) && (
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">{toolbar}</div>
          {showDensityToggle && (
            <div
              className="flex items-center rounded-[var(--crm-radius-sm)] border border-[var(--crm-border)] crm-hairline"
              role="group"
              aria-label="Row density"
            >
              {(['comfortable', 'compact'] as Density[]).map((opt) => {
                const Icon = opt === 'comfortable' ? Rows2 : Rows3;
                const on = activeDensity === opt;
                return (
                  <button
                    key={opt}
                    type="button"
                    aria-pressed={on}
                    title={opt === 'comfortable' ? 'Comfortable rows' : 'Compact rows'}
                    data-testid={testId ? `${testId}-density-${opt}` : undefined}
                    onClick={() => setDensity(opt)}
                    className={cn(
                      'flex h-8 w-8 items-center justify-center outline-none focus-visible:ring-2 focus-visible:ring-[var(--crm-ring)]',
                      on
                        ? 'bg-[var(--crm-primary-subtle)] text-[var(--crm-primary)]'
                        : 'text-[var(--crm-text-tertiary)] hover:text-[var(--crm-text-secondary)]',
                    )}
                  >
                    <Icon className="h-4 w-4" />
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      <div className="overflow-hidden rounded-[var(--crm-radius-md)] border border-[var(--crm-border)] crm-hairline bg-[var(--crm-bg-primary)]">
        <div className="max-h-[calc(100vh-220px)] overflow-auto">
          <table className={cn('w-full border-collapse', d.text)}>
            <thead className="sticky top-0 z-10">
              <tr className="bg-[var(--crm-bg-secondary)]">
                {leading && (
                  <th className={cn('px-3 text-left', d.rowPy)}>{leadingHeader}</th>
                )}
                {columns.map((col) => {
                  const isSorted = sort?.colId === col.id;
                  return (
                    <th
                      key={col.id}
                      className={cn(
                        'border-b border-[var(--crm-border)] crm-hairline text-[11px] font-medium uppercase tracking-wide text-[var(--crm-text-tertiary)]',
                        d.cellPx,
                        d.rowPy,
                        col.align === 'right' ? 'text-right' : col.align === 'center' ? 'text-center' : 'text-left',
                        col.widthClass,
                        col.headerClassName,
                      )}
                    >
                      {col.sortable ? (
                        <button
                          type="button"
                          onClick={() => toggleSort(col.id)}
                          data-testid={testId ? `${testId}-sort-${col.id}` : undefined}
                          className="inline-flex items-center gap-1 text-[var(--crm-text-tertiary)] outline-none hover:text-[var(--crm-text-secondary)] focus-visible:text-[var(--crm-primary)]"
                        >
                          {col.header}
                          {!isSorted && <ArrowUpDown className="h-3 w-3 opacity-60" />}
                          {isSorted && sort?.dir === 'asc' && <ChevronUp className="h-3 w-3" />}
                          {isSorted && sort?.dir === 'desc' && <ChevronDown className="h-3 w-3" />}
                        </button>
                      ) : (
                        col.header
                      )}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={colSpan} className="p-4">
                    <SkeletonRows rows={6} data-testid={testId ? `${testId}-skeleton` : undefined} />
                  </td>
                </tr>
              ) : error ? (
                <tr>
                  <td colSpan={colSpan} data-testid={testId ? `${testId}-error` : undefined}>
                    {error}
                  </td>
                </tr>
              ) : sortedRows.length === 0 ? (
                <tr>
                  <td colSpan={colSpan} data-testid={testId ? `${testId}-empty` : undefined}>
                    {empty}
                  </td>
                </tr>
              ) : (
                sortedRows.map((row) => {
                  const id = getRowId(row);
                  const active = activeRowId === id;
                  return (
                    // A SELECTABLE ROW IS OPERABLE BY KEYBOARD.
                    //
                    // Selectable rows were <tr onClick> with no tabIndex and no
                    // key handler, so opening a detail panel required a mouse —
                    // in every CRM table in the admin. That is a WCAG 2.1.1
                    // failure, and it also meant focus had nowhere to return to
                    // when the panel closed.
                    //
                    // tabIndex + Enter/Space keeps <tr> semantics intact (a
                    // role="button" here would stop it being announced as a row)
                    // and makes the row reachable. Rows without onSelect are
                    // untouched: no tab stop is added to a table you cannot
                    // click into.
                    <tr
                      key={id}
                      data-testid={testId ? `${testId}-row` : undefined}
                      data-row-id={id}
                      onClick={onSelect ? () => onSelect(row) : undefined}
                      tabIndex={onSelect ? 0 : undefined}
                      onKeyDown={
                        onSelect
                          ? (e) => {
                              if (e.key !== 'Enter' && e.key !== ' ') return;
                              // Space scrolls the page by default; a row that
                              // both opens and jumps is worse than either.
                              e.preventDefault();
                              onSelect(row);
                            }
                          : undefined
                      }
                      className={cn(
                        'border-b border-[var(--crm-border)] crm-hairline last:border-b-0 transition-colors',
                        onSelect &&
                          'cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--crm-ring)]',
                        active
                          ? 'bg-[var(--crm-primary-subtle)]'
                          : 'hover:bg-[var(--crm-bg-secondary)]',
                      )}
                    >
                      {leading && (
                        <td className={cn('px-3', d.rowPy)} onClick={(e) => e.stopPropagation()}>
                          {leading(row)}
                        </td>
                      )}
                      {columns.map((col) => (
                        <td
                          key={col.id}
                          className={cn(
                            'text-[var(--crm-text-secondary)] align-middle',
                            d.cellPx,
                            d.rowPy,
                            col.align === 'right' ? 'text-right' : col.align === 'center' ? 'text-center' : 'text-left',
                            col.className,
                          )}
                        >
                          {col.cell(row)}
                        </td>
                      ))}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
