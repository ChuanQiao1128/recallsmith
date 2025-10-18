import { modals } from '@mantine/modals';
import { Text } from '@mantine/core';

export function confirm(opts: { title: string; message: string; onConfirm: () => void }) {
  modals.openConfirmModal({
    title: opts.title,
    children: <Text size="sm">{opts.message}</Text>,
    labels: { confirm: 'Confirm', cancel: 'Cancel' },
    onConfirm: opts.onConfirm,
  });
}