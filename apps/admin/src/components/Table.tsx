import { Table as MTable, Paper } from '@mantine/core';
import type { ReactNode } from 'react';

export type Column<T> = {
  header: ReactNode;
  cell: (row: T) => ReactNode;
  width?: string | number;
};

export default function Table<T>({ data, columns }: { data: T[]; columns: Column<T>[] }) {
  return (
    <Paper withBorder>
      <MTable highlightOnHover verticalSpacing="sm">
        <MTable.Thead>
          <MTable.Tr>
            {columns.map((c, i) => (
              <MTable.Th key={i} style={c.width ? { width: c.width } : undefined}>
                {c.header}
              </MTable.Th>
            ))}
          </MTable.Tr>
        </MTable.Thead>
        <MTable.Tbody>
          {data.map((row, ri) => (
            <MTable.Tr key={ri}>
              {columns.map((c, ci) => (
                <MTable.Td key={ci}>{c.cell(row)}</MTable.Td>
              ))}
            </MTable.Tr>
          ))}
        </MTable.Tbody>
      </MTable>
    </Paper>
  );
}