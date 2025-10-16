import PageHeader from '../../components/PageHeader';
import { Card, Grid, Group, Paper, Text, Title } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { listDecks } from '../../api/admin';
import { mock } from '../../api/mock';

export default function Dashboard() {
  const { data: decks = [] } = useQuery({ queryKey: ['decks'], queryFn: listDecks });

  const totalDecks = decks.length;
  const totalCards = decks.reduce((sum, d) => sum + mock.listCards(d.id).length, 0);

  return (
    <>
      <PageHeader title="Dashboard" />
      <Grid>
        <Grid.Col span={{ base: 12, sm: 6, md: 3 }}>
          <Stat title="Decks" value={totalDecks} />
        </Grid.Col>
        <Grid.Col span={{ base: 12, sm: 6, md: 3 }}>
          <Stat title="Cards" value={totalCards} />
        </Grid.Col>
        <Grid.Col span={{ base: 12, sm: 6, md: 3 }}>
          <Stat title="Published" value={decks.reduce((s, d) => s + mock.listPublishes(d.id).length, 0)} />
        </Grid.Col>
      </Grid>

      <Paper withBorder p="md" mt="md">
        <Title order={5} mb="sm">Recent decks</Title>
        {decks.slice(0,5).map(d => (
          <Group key={d.id} justify="space-between">
            <Text fw={500}>{d.title}</Text>
            <Text size="sm" c="dimmed">{d.slug}</Text>
          </Group>
        ))}
        {decks.length === 0 && <Text c="dimmed">No decks yet. Create one from the Decks page.</Text>}
      </Paper>
    </>
  );
}

function Stat({ title, value }: { title: string; value: number }) {
  return (
    <Card withBorder>
      <Text c="dimmed" size="sm">{title}</Text>
      <Text fz={28} fw={700}>{value}</Text>
    </Card>
  );
}