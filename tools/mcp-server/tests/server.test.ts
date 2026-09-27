import { afterEach, describe, expect, it } from 'vitest';
import { connect, makeTestEnv, type TestEnv } from './helpers';

describe('server', () => {
  let env: TestEnv;
  afterEach(() => env.cleanup());

  it('lists exactly the four DeveloperCards tools', async () => {
    env = makeTestEnv();
    const client = await connect(env.config);
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(['find_similar_cards', 'lint_card', 'read_source', 'submit_draft']);
    for (const tool of tools) {
      expect(tool.description?.length ?? 0).toBeGreaterThan(20);
      expect(tool.inputSchema.type).toBe('object');
    }
    const readSource = tools.find((t) => t.name === 'read_source');
    expect(readSource?.description).toMatch(/never instructions/);
    const submit = tools.find((t) => t.name === 'submit_draft');
    expect(submit?.description).toMatch(/review queue/);
    await client.close();
  });

  it('describes what happens to a submitted draft truthfully in both modes (ai-agent-31)', async () => {
    env = makeTestEnv();
    const client = await connect(env.config);
    const { tools } = await client.listTools();
    const submit = tools.find((t) => t.name === 'submit_draft')?.description ?? '';
    const first = submit.split('. ')[0] ?? '';
    // The opening sentence covers both modes; it never claims a human reviews every draft.
    expect(first).not.toMatch(/nothing is published/);
    expect(first).toMatch(/what happens next is the server's decision/);
    expect(first).toMatch(/outside an automation run a human reviews every draft/);
    expect(first).toMatch(/inside one, new drafts that pass the server's checks and AI QA may be published without a human/);
    expect(submit).toMatch(/SOURCE_LOCAL_NOT_ALLOWED_IN_AUTOMATION/);
    const read = tools.find((t) => t.name === 'read_source')?.description ?? '';
    expect(read).toMatch(/SOURCE_LOCAL_NOT_ALLOWED_IN_AUTOMATION/);
    await client.close();
  });

  it('describes each tool contract and carries MCP annotations', async () => {
    env = makeTestEnv();
    const client = await connect(env.config);
    const { tools } = await client.listTools();
    const byName = new Map(tools.map((t) => [t.name, t]));
    for (const tool of tools) {
      // A short man page: what it does, limits, what it does not do.
      expect(tool.description?.split(/(?<=[.;)])\s+(?=[A-Z`])/).length ?? 0, tool.name).toBeGreaterThanOrEqual(3);
      expect(tool.annotations?.title, tool.name).toBeTruthy();
    }

    const read = byName.get('read_source');
    expect(read?.annotations).toMatchObject({ readOnlyHint: true, openWorldHint: true });
    for (const phrase of [/sources\/ directory/, /DC_SOURCES_DIRS/, /~\/\.ssh/, /token file/, /canonicalUrl/, /1000\.\.8000/, /chunks: \[\{ id/, /no summary/]) {
      expect(read?.description).toMatch(phrase);
    }

    const similar = byName.get('find_similar_cards');
    expect(similar?.annotations).toMatchObject({ readOnlyHint: true });
    for (const phrase of [/every deck/, /0\.3/, /0\.6/, /does not return/]) expect(similar?.description).toMatch(phrase);

    const lint = byName.get('lint_card');
    expect(lint?.annotations).toMatchObject({ readOnlyHint: true });
    expect(lint?.description).toMatch(/without it the quote is not checked/);

    const submit = byName.get('submit_draft');
    expect(submit?.annotations).toMatchObject({ idempotentHint: true, readOnlyHint: false, destructiveHint: false });
    for (const phrase of [/SOURCE_NOT_INGESTED/, /SOURCE_QUOTE_NOT_IN_CHUNK/, /idempotent/, /rejected/, /grounding/]) {
      expect(submit?.description).toMatch(phrase);
    }
    await client.close();
  });

  it('reports server name developercards and version 1.8.1', async () => {
    env = makeTestEnv();
    const client = await connect(env.config);
    expect(client.getServerVersion()).toMatchObject({ name: 'developercards', version: '1.8.1' });
    await client.close();
  });

  it('rejects a card with an unknown key as invalid input', async () => {
    env = makeTestEnv();
    const client = await connect(env.config);
    const result = await client.callTool({
      name: 'lint_card',
      arguments: { deckSlug: 'aws-saa-c03', card: { stableUid: 'x-1', difficulty: 1, question: 'Q', explanation: 'A', extra: 1 } },
    });
    expect(result.isError).toBe(true);
    await client.close();
  });
});
