import PageHeader from '../../components/PageHeader';
import Toolbar from '../../components/Toolbar';

import Table from '../../components/Table';
import type { Column } from '../../components/Table';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createDeck, listDecks } from '../../api/admin';
import type { Deck } from '../../types';
import { useNavigate } from 'react-router-dom';
import { Group, TextInput, Modal, Stack, Select } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { useState } from 'react';
import { notifications } from '@mantine/notifications';
import { z } from 'zod';

const schema = z.object({
  slug: z.string().regex(/^[a-z0-9-]{3,32}$/i, '3-32 chars, letters/digits/dash'),
  title: z.string().min(1).max(100),
  locale: z.string().optional(),
});

export default function AllDecks() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: decks = [] } = useQuery({ queryKey: ['decks'], queryFn: listDecks });

  const [open, { open: openModal, close: closeModal }] = useDisclosure(false);
  const [form, setForm] = useState<{ slug: string; title: string; locale?: string }>({ slug: '', title: '', locale: 'en-US' });
  const [byId, setById] = useState('');

  const m = useMutation({
    mutationFn: createDeck,
    onSuccess: (res) => {
      notifications.show({ title: 'Created deck', message: res.deckId });
      qc.invalidateQueries({ queryKey: ['decks'] });
      closeModal();
      navigate(`/decks/${res.deckId}`);
    },
    onError: (e: Error) => notifications.show({ color: 'red', title: 'Error', message: String(e?.message ?? e) }),
  });

  const cols: Column<Deck>[] = [
    { header: 'Title', cell: (r) => <span>{r.title}</span> },
    { header: 'Slug', cell: (r) => <span>{r.slug}</span> },
    { header: 'Locale', cell: (r) => <span>{r.locale ?? '-'}</span>, width: 120 },
    { header: 'Created', cell: (r) => new Date(r.createdAt).toLocaleString(), width: 220 },
    {
      header: '',
      width: 120,
      cell: (r) => <button onClick={() => navigate(`/decks/${r.id}`)} className="btn btn-primary">Open</button>,
    },
  ];

  return (
    <>
      <PageHeader title="Decks" right={
        <Group>
          <TextInput placeholder="Open by ID…" value={byId} onChange={(e) => setById(e.currentTarget.value)} />
          <button onClick={() => byId && navigate(`/decks/${byId}`)} className="btn">Open</button>
          <button onClick={openModal} className="btn btn-primary">New Deck</button>
        </Group>
      }/>

      <Toolbar>
        <div />
      </Toolbar>

      <Table data={decks} columns={cols} />

      <Modal opened={open} onClose={closeModal} title="Create deck" centered>
        <Stack>
          <TextInput label="Slug" placeholder="js-core" value={form.slug}
            onChange={(e) => setForm({ ...form, slug: e.currentTarget.value })} />
          <TextInput label="Title" placeholder="JavaScript Core" value={form.title}
            onChange={(e) => setForm({ ...form, title: e.currentTarget.value })} />
          <Select label="Locale" allowDeselect data={['en-US', 'zh-CN', 'ja-JP']}
            value={form.locale} onChange={(v) => setForm({ ...form, locale: v ?? undefined })} />
          <button
            onClick={() => {
              const v = schema.safeParse(form);
              if (!v.success) {
                notifications.show({ color: 'red', title: 'Invalid', message: v.error.issues[0]?.message ?? 'Invalid' });
                return;
              }
              m.mutate(v.data);
            }}
            className="btn btn-primary"
          >
            Create
          </button>
        </Stack>
      </Modal>
    </>
  );
}