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
    expect(submit?.description).toMatch(/nothing is published/);
    await client.close();
  });

  it('reports server name developercards and version 1.8.0', async () => {
    env = makeTestEnv();
    const client = await connect(env.config);
    expect(client.getServerVersion()).toMatchObject({ name: 'developercards', version: '1.8.0' });
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
