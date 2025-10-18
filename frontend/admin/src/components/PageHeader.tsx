import { Group, Title, Breadcrumbs, Anchor } from '@mantine/core';
import type { ReactNode } from 'react';

export default function PageHeader({
  title,
  crumbs,
  right,
}: {
  title: string;
  crumbs?: { label: string; href?: string }[];
  right?: ReactNode;
}) {
  return (
    <Group justify="space-between" mb="md">
      <div>
        {crumbs && crumbs.length > 0 && (
          <Breadcrumbs mb={6}>
            {crumbs.map((c, i) =>
              c.href ? (
                <Anchor key={i} href={c.href} size="sm">
                  {c.label}
                </Anchor>
              ) : (
                <span key={i}>{c.label}</span>
              )
            )}
          </Breadcrumbs>
        )}
        <Title order={3}>{title}</Title>
      </div>
      {right}
    </Group>
  );
}