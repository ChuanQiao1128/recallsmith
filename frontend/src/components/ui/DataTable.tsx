import type { ReactNode } from 'react';
import { LoadingState } from './LoadingState';
import { EmptyState, type EmptyStateProps } from './EmptyState';

export interface DataTableColumn<T> {
  key: string;
  label: string;
  width?: string;
  align?: 'left' | 'center' | 'right';
  cell?: (row: T) => ReactNode;
}

export interface DataTableProps<T> {
  columns: DataTableColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string | number;
  onRowClick?: (row: T) => void;
  loading?: boolean;
  error?: string | null;
  emptyState?: EmptyStateProps;
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  onRowClick,
  loading = false,
  error = null,
  emptyState,
}: DataTableProps<T>) {
  if (loading) {
    return (
      <div className="border border-slate-200 dark:border-slate-700 rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900">
                {columns.map((col) => (
                  <th
                    key={col.key}
                    className={`text-left text-sm font-semibold text-slate-900 dark:text-slate-50 px-4 py-3 ${col.width || ''}`}
                  >
                    {col.label}
                  </th>
                ))}
              </tr>
            </thead>
          </table>
        </div>
        <div className="p-4">
          {[1, 2, 3].map((i) => (
            <LoadingState key={i} variant="skeleton" />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="w-full bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded-lg p-4 text-center">
        <p className="text-sm text-red-800 dark:text-red-200">{error}</p>
      </div>
    );
  }

  if (rows.length === 0) {
    if (emptyState) {
      return <EmptyState {...emptyState} />;
    }
    return (
      <div className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg p-8 text-center">
        <p className="text-sm text-slate-600 dark:text-slate-400">No rows found.</p>
      </div>
    );
  }

  return (
    <div className="border border-slate-200 dark:border-slate-700 rounded-lg overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 sticky top-0">
              {columns.map((col) => (
                <th
                  key={col.key}
                  className={`text-sm font-semibold text-slate-900 dark:text-slate-50 px-4 py-3 text-${col.align || 'left'} ${col.width || ''}`}
                >
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={rowKey(row)}
                onClick={() => onRowClick?.(row)}
                className={`border-b border-slate-100 dark:border-slate-800 transition-colors duration-150 ${
                  onRowClick ? 'cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-900' : ''
                }`}
                role={onRowClick ? 'button' : undefined}
                tabIndex={onRowClick ? 0 : undefined}
                onKeyDown={(e) => {
                  if (onRowClick && (e.key === 'Enter' || e.key === ' ')) {
                    e.preventDefault();
                    onRowClick(row);
                  }
                }}
              >
                {columns.map((col) => {
                  const rowRecord = row as Record<string, unknown>;
                  return (
                    <td
                      key={col.key}
                      className={`text-sm text-slate-700 dark:text-slate-300 px-4 py-3 text-${col.align || 'left'} ${col.width || ''}`}
                    >
                      {col.cell ? col.cell(row) : String(rowRecord[col.key] || '')}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
