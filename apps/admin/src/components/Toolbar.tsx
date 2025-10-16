import { Group } from '@mantine/core';
import type { ReactNode } from 'react';

export default function Toolbar({ children }: { children: ReactNode }) {
  return (
    <Group justify="space-between" mb="sm">
      {children}
    </Group>
  );
}