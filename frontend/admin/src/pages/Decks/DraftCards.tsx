import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { listCards, deleteCard } from '../../api/admin';
import type { Card as CardType } from '../../types';
import { ActionIcon, Group, Paper, Text } from '@mantine/core';
import { IconPlus, IconTrash, IconPencil } from '@tabler/icons-react';
import { Button } from '@mantine/core';
import CardEditorDrawer from './CardEditorDrawer';
import { useDisclosure } from '@mantine/hooks';
import { useMemo, useState } from 'react';
import MarkdownPreview from '../../components/MarkdownPreview';
import { notifications } from '@mantine/notifications';
import './DraftCards.css';

export default function DraftCards({ deckId, deckSlug }: { deckId: string; deckSlug?: string }) {
  const qc = useQueryClient();
  const { data: cards = [] } = useQuery({ queryKey: ['cards', deckId], queryFn: () => listCards(deckId) });

  const [opened, { open, close }] = useDisclosure(false);
  const [editing, setEditing] = useState<CardType | null>(null);

  const mDel = useMutation({
    mutationFn: async (cardId: string) => deleteCard(deckId, cardId),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['cards', deckId] }); },
  });

  const existingUids = useMemo(() => cards.map(c => c.stableUid), [cards]);

  return (
    <>
      <Group justify="space-between" mt="md" mb="sm">
        <Text fw={600}>Draft cards ({cards.length})</Text>
        <Button leftSection={<IconPlus size={16} />} onClick={() => { setEditing(null); open(); }}>
          New Card
        </Button>
      </Group>

      <div className="cards-grid">
        {cards.map((c) => (
          <Paper key={c.id} withBorder p="sm">
            <Group justify="space-between" align="flex-start">
              <div className="card-content">
                <Text fw={600} mb={6}>{c.keyPoint}</Text>
                <Text size="xs" c="dimmed" mb={6}>uid: {c.stableUid} • tags: {c.tags.join(', ') || '-'}</Text>
                <Group grow align="flex-start">
                  <div className="card-section">
                    <Text size="sm" c="dimmed" mb={4}>Front (Question)</Text>
                    <MarkdownPreview value={c.frontMd} />
                  </div>
                  <div className="card-section">
                    <Text size="sm" c="dimmed" mb={4}>Back (Explanation & Code)</Text>
                    <MarkdownPreview value={c.backMd} />
                  </div>
                </Group>
              </div>
              <Group align="flex-start">
                <ActionIcon variant="light" onClick={() => { setEditing(c); open(); }}>
                  <IconPencil size={16} />
                </ActionIcon>
                <ActionIcon color="red" variant="light" onClick={() => {
                  mDel.mutate(c.id);
                  notifications.show({ title: 'Deleted', message: c.stableUid });
                }}>
                  <IconTrash size={16} />
                </ActionIcon>
              </Group>
            </Group>
          </Paper>
        ))}
        {cards.length === 0 && <Text c="dimmed">No draft cards yet.</Text>}
      </div>

      {opened && (
        <CardEditorDrawer
          deckId={deckId}
          deckSlug={deckSlug}
          opened={opened}
          onClose={() => { close(); setEditing(null); }}
          editing={editing ?? undefined}
          onSaved={() => qc.invalidateQueries({ queryKey: ['cards', deckId] })}
          existingUids={existingUids}
        />
      )}
    </>
  );
}