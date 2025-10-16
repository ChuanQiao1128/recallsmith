import { useEffect, useState } from 'react';
import { getDeck, updateDeckMeta } from '../../api/admin';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Group, Paper, Select, Stack, Text, TextInput } from '@mantine/core';
import { notifications } from '@mantine/notifications';

export default function Settings({ deckId }: { deckId: string }) {
  const { data: deck } = useQuery({ queryKey: ['deck', deckId], queryFn: () => getDeck(deckId) });
  const qc = useQueryClient();
  const [title, setTitle] = useState('');
  const [slug, setSlug] = useState('');
  const [locale, setLocale] = useState<string | null>('en-US');

  useEffect(() => {
    if (deck) {
      setTitle(deck.title);
      setSlug(deck.slug);
      setLocale(deck.locale ?? null);
    }
  }, [deck]);

  return (
    <Paper withBorder p="md" mt="md">
      <Stack>
        <Text fw={600}>Deck metadata</Text>
        <Group grow>
          <TextInput label="Title" value={title} onChange={(e) => setTitle(e.currentTarget.value)} />
          <TextInput label="Slug" value={slug} onChange={(e) => setSlug(e.currentTarget.value)} />
          <Select label="Locale" allowDeselect data={['en-US', 'zh-CN', 'ja-JP']} value={locale} onChange={setLocale} />
        </Group>
        <Group>
          <Button onClick={async () => {
            await updateDeckMeta(deckId, { title, slug, locale: locale ?? undefined });
            notifications.show({ title: 'Saved', message: 'Deck metadata updated' });
            qc.invalidateQueries({ queryKey: ['deck', deckId] });
          }}>Save</Button>
        </Group>
      </Stack>
    </Paper>
  );
}