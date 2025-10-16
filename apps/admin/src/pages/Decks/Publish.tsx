import { useState } from 'react';
import { publishDeck, listCards, listPublishes } from '../../api/admin';
import { useQuery } from '@tanstack/react-query';
import { Button, Group, Paper, Stack, Text, TextInput, Textarea, Timeline } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { z } from 'zod';

const schema = z.object({
  version: z.string().regex(/^\d+\.\d+\.\d+$/, 'SemVer: x.y.z'),
  changelog: z.string().optional(),
});

export default function Publish({ deckId }: { deckId: string }) {
  const { data: cards = [] } = useQuery({ queryKey: ['cards', deckId], queryFn: () => listCards(deckId) });
  const { data: publishes = [] , refetch } = useQuery({ queryKey: ['publishes', deckId], queryFn: () => listPublishes(deckId) });

  const [ver, setVer] = useState('1.0.0');
  const [log, setLog] = useState('');

  return (
    <Group align="start" mt="md" grow>
      <Paper withBorder p="md">
        <Stack>
          <Text fw={600}>Publish new version</Text>
          <TextInput label="Version (x.y.z)" value={ver} onChange={(e) => setVer(e.currentTarget.value)} />
          <Textarea label="Changelog" minRows={4} value={log} onChange={(e) => setLog(e.currentTarget.value)} />
          <Text size="sm" c="dimmed">Cards to publish: {cards.length}</Text>
          <Group>
            <Button onClick={async () => {
              const v = schema.safeParse({ version: ver, changelog: log });
              if (!v.success) {
                notifications.show({ color: 'red', title: 'Invalid', message: v.error.issues[0]?.message ?? 'Invalid' });
                return;
              }
              const res = await publishDeck(deckId, v.data);
              notifications.show({ title: `Published ${res.version}`, message: `Cards: ${res.totalCards}` });
              refetch();
            }}>Publish</Button>
          </Group>
        </Stack>
      </Paper>

      <Paper withBorder p="md">
        <Text fw={600} mb="sm">History</Text>
        {publishes.length === 0 && <Text c="dimmed">No publish history.</Text>}
        {publishes.length > 0 && (
          <Timeline active={publishes.length - 1}>
            {publishes.map(p => (
              <Timeline.Item key={p.version} title={`v${p.version}`}>
                <Text size="sm" c="dimmed">{new Date(p.publishedAt).toLocaleString()}</Text>
                <Text size="sm">Total cards: {p.totalCards}</Text>
              </Timeline.Item>
            ))}
          </Timeline>
        )}
      </Paper>
    </Group>
  );
}