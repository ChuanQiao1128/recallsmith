import { AppShell as MAppShell, Burger, Group, ScrollArea, NavLink, Title, Box, Text } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { IconLayoutDashboard, IconStack2 } from '@tabler/icons-react';
import { useEffect } from 'react';

export default function AppShell() {
  const [opened, { toggle, close }] = useDisclosure();
  const navigate = useNavigate();
  const loc = useLocation();

  useEffect(() => { close(); }, [loc.pathname, close]);

  return (
    <MAppShell
      header={{ height: 56 }}
      navbar={{ width: 240, breakpoint: 'sm', collapsed: { mobile: !opened } }}
      padding="md"
    >
      <MAppShell.Header>
        <Group h="100%" px="md" justify="space-between">
          <Group>
            <Burger opened={opened} onClick={toggle} hiddenFrom="sm" size="sm" />
            <Title order={4}>RecallSmith Admin</Title>
          </Group>
          <Text c="dimmed" size="sm">v0.1</Text>
        </Group>
      </MAppShell.Header>

      <MAppShell.Navbar p="xs">
        <MAppShell.Section grow component={ScrollArea}>
          <NavLink
            label="Dashboard"
            leftSection={<IconLayoutDashboard size={18} />}
            active={loc.pathname.startsWith('/dashboard')}
            onClick={() => navigate('/dashboard')}
          />
          <NavLink
            label="Decks"
            leftSection={<IconStack2 size={18} />}
            active={loc.pathname.startsWith('/decks')}
            onClick={() => navigate('/decks')}
          />
        </MAppShell.Section>
        <MAppShell.Section>
          <Box p="xs">
            <Text size="xs" c="dimmed">© RecallSmith</Text>
          </Box>
        </MAppShell.Section>
      </MAppShell.Navbar>

      <MAppShell.Main>
        <Outlet />
      </MAppShell.Main>
    </MAppShell>
  );
}