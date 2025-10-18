import { Modal, Button, Group, Stack, TextInput, Textarea, TagsInput, Select, Grid, Paper, Title, Text, ActionIcon, CopyButton, Tooltip, Divider } from '@mantine/core';
import { useForm } from '@mantine/form';
import { z } from 'zod';
import { useEffect, useMemo } from 'react';
import MarkdownPreview from '../../components/MarkdownPreview';
import { createDraftCard } from '../../api/admin';
import { notifications } from '@mantine/notifications';
import type { Card as CardType } from '../../types';
import { IconCheck, IconCopy } from '@tabler/icons-react';

// ---------------- helpers ----------------
function slugify(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}
function buildBaseUid(deckSlug: string | undefined, frontMd: string, version = 'v1') {
  const base = slugify(frontMd.split(/\s+/).slice(0, 6).join(' ')) || 'item';
  const head = deckSlug ? `${slugify(deckSlug)}.${base}` : base;
  return `${head}.${version}`;
}
function ensureUnique(base: string, taken: Set<string>) {
  if (!taken.has(base)) return base;
  let i = 2;
  while (taken.has(`${base}-${i}`)) i++;
  return `${base}-${i}`;
}

// ---------------- schema ----------------
const schema = z.object({
  stableUid: z.string().min(3),
  keyPoint: z.string().min(1).max(200),
  tags: z.array(z.string()).default([]),
  difficulty: z.enum(['beginner', 'intermediate', 'advanced']).optional(),
  frontMd: z.string().min(1),
  backMd: z.string().min(1),
});

export default function CardEditorDrawer({
  deckId,
  deckSlug,
  opened,
  onClose,
  onSaved,
  editing,
  existingUids = [],
}: {
  deckId: string;
  deckSlug?: string;
  opened: boolean;
  onClose: () => void;
  onSaved: () => void;
  editing?: CardType;
  /** 当前 deck 已存在的 stableUid 列表，用于去重 */
  existingUids?: string[];
}) {
  const form = useForm({
    initialValues: {
      stableUid: editing?.stableUid ?? '',
      keyPoint: editing?.keyPoint ?? '',
      tags: editing?.tags ?? [],
      difficulty: editing?.difficulty ?? 'intermediate',
      frontMd: editing?.frontMd ?? '',
      backMd: editing?.backMd ?? '',
    },
  });

  const taken = useMemo(() => new Set(existingUids.filter(Boolean)), [existingUids]);

  // 自动生成且唯一（新建时生效；编辑时保持原值）
  useEffect(() => {
    if (editing) return; // 编辑不改 UID
    const base = buildBaseUid(deckSlug, form.values.frontMd, 'v1');
    if (!form.values.frontMd) {
      form.setFieldValue('stableUid', '');
      return;
    }
    const unique = ensureUnique(base, taken);
    form.setFieldValue('stableUid', unique);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deckSlug, form.values.frontMd, taken, editing]);

  async function handleSubmit(v: typeof form.values) {
    const result = schema.safeParse(v);
    if (!result.success) {
      notifications.show({ 
        color: 'red', 
        title: 'Validation Error', 
        message: result.error.issues[0]?.message ?? 'Invalid form data' 
      });
      return;
    }
    
    await createDraftCard(deckId, {
      stableUid: result.data.stableUid,
      keyPoint: result.data.keyPoint,
      tags: result.data.tags,
      difficulty: result.data.difficulty,
      frontMd: result.data.frontMd,
      backMd: result.data.backMd,
    });
    notifications.show({ title: editing ? 'Card saved' : 'Card created', message: result.data.stableUid });
    onSaved();
    onClose();
  }

  const keyPointLen = form.values.keyPoint.length;

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={<Title order={4}>{editing ? 'Edit card' : 'New card'}</Title>}
      size="90%"
      centered
      closeOnClickOutside={false}
      withCloseButton
    >
      <form onSubmit={form.onSubmit(handleSubmit)}>
        <Stack gap="md">
          <Paper withBorder p="md">
            <Grid gutter="md" align="end">
              <Grid.Col span={{ base: 12, md: 6 }}>
                <Group align="end">
                  <TextInput
                    label="Stable UID"
                    placeholder="auto-generated"
                    {...form.getInputProps('stableUid')}
                    readOnly
                    disabled
                    style={{ flex: 1 }}
                  />
                  <CopyButton value={form.values.stableUid} timeout={1200}>
                    {({ copied, copy }) => (
                      <Tooltip label={copied ? 'Copied' : 'Copy UID'}>
                        <ActionIcon variant="light" onClick={copy} aria-label="copy uid">
                          {copied ? <IconCheck size={16} /> : <IconCopy size={16} />}
                        </ActionIcon>
                      </Tooltip>
                    )}
                  </CopyButton>
                </Group>
              </Grid.Col>

              <Grid.Col span={{ base: 12, md: 3 }}>
                <Select
                  label="Difficulty"
                  data={['beginner', 'intermediate', 'advanced']}
                  value={form.values.difficulty ?? null}
                  onChange={(v) => form.setFieldValue('difficulty', (v ?? 'intermediate') as 'beginner' | 'intermediate' | 'advanced')}
                  allowDeselect={false}
                />
              </Grid.Col>

              <Grid.Col span={{ base: 12, md: 3 }}>
                <div>
                  <TextInput
                    label={
                      <Group justify="space-between">
                        <Text>Key Point</Text>
                        <Text size="xs" c={keyPointLen > 200 ? 'red' : 'dimmed'}>
                          {keyPointLen}/200
                        </Text>
                      </Group>
                    }
                    placeholder="One-sentence takeaway"
                    {...form.getInputProps('keyPoint')}
                  />
                </div>
              </Grid.Col>

              <Grid.Col span={12}>
                <TagsInput
                  label="Tags"
                  placeholder="Add tag and press Enter"
                  value={form.values.tags}
                  onChange={(v) => form.setFieldValue('tags', v)}
                />
              </Grid.Col>
            </Grid>
          </Paper>

          <Grid gutter="md" align="stretch">
            <Grid.Col span={{ base: 12, md: 6 }}>
              <Paper withBorder p="md" mb="sm">
                <Title order={6} mb="xs">Front (Question, Markdown)</Title>
                <Textarea
                  autosize
                  minRows={10}
                  placeholder="Write the question in Markdown..."
                  {...form.getInputProps('frontMd')}
                />
              </Paper>
              <Paper withBorder p="md">
                <Title order={6} mb="xs">Front Preview</Title>
                <MarkdownPreview value={form.values.frontMd} />
              </Paper>
            </Grid.Col>

            <Grid.Col span={{ base: 12, md: 6 }}>
              <Paper withBorder p="md" mb="sm">
                <Title order={6} mb="xs">Back (Explanation & Code, Markdown)</Title>
                <Textarea
                  autosize
                  minRows={10}
                  placeholder="Explain the answer with code snippets..."
                  {...form.getInputProps('backMd')}
                />
              </Paper>
              <Paper withBorder p="md">
                <Title order={6} mb="xs">Back Preview</Title>
                <MarkdownPreview value={form.values.backMd} splitCode title="Back Preview" />
              </Paper>
            </Grid.Col>
          </Grid>

          <Divider />

          <Group justify="end">
            <Button variant="default" onClick={onClose}>Cancel</Button>
            <Button type="submit">{editing ? 'Save' : 'Create'}</Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}