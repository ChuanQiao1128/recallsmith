// splitStemForOptions — the purely-textual split that lets the MCQ options stage clamp only the
// scenario lead-in while the ask sentence (and its MOST/LEAST qualifier) always stays visible
// (MCORE-02). No layout, no measurement: sentence boundaries and the qualifier index decide the cut.

import { describe, expect, it } from 'vitest';

import { splitStemForOptions } from '../../src/features/gacha/mcq/stemAsk';

describe('splitStemForOptions', () => {
  it('splits the final question sentence from the scenario lead-in', () => {
    const stem = 'A team stores application logs in Amazon S3. Which service queries them in place?';
    expect(splitStemForOptions(stem, null)).toEqual({
      leadIn: 'A team stores application logs in Amazon S3.',
      ask: 'Which service queries them in place?',
    });
  });

  it('pulls the ask back to the sentence that holds the qualifier', () => {
    const stem =
      'An order API runs on Amazon EC2 instances behind an Application Load Balancer. During flash sales the downstream fulfilment service is overwhelmed and orders are lost. The company wants the API to keep accepting orders while fulfilment catches up, with the LEAST operational overhead. Which solution meets these requirements?';
    // Case-insensitive match, so the caller's casing does not matter.
    expect(splitStemForOptions(stem, 'least operational overhead')).toEqual({
      leadIn:
        'An order API runs on Amazon EC2 instances behind an Application Load Balancer. During flash sales the downstream fulfilment service is overwhelmed and orders are lost.',
      ask: 'The company wants the API to keep accepting orders while fulfilment catches up, with the LEAST operational overhead. Which solution meets these requirements?',
    });
  });

  it('keeps a trailing (Choose two.) with the question it belongs to', () => {
    const stem =
      'A company must keep a copy of every object written to an S3 bucket in a second Region and must be able to prove that no copy can be deleted for seven years, even by an account administrator. Which combination of actions meets these requirements? (Choose two.)';
    expect(splitStemForOptions(stem, null)).toEqual({
      leadIn:
        'A company must keep a copy of every object written to an S3 bucket in a second Region and must be able to prove that no copy can be deleted for seven years, even by an account administrator.',
      ask: 'Which combination of actions meets these requirements? (Choose two.)',
    });
  });

  it('returns the whole stem as the ask when there is one sentence', () => {
    const stem = 'Which AWS service provides a fully managed message queue?';
    expect(splitStemForOptions(stem, null)).toEqual({ leadIn: '', ask: stem });
  });

  // Card translations: a zh-CN stem ends its sentences with 。！？ and no space after them.
  describe('a Chinese stem', () => {
    it('splits at Chinese sentence ends that need no space', () => {
      const stem = '一个团队把应用日志存放在 Amazon S3 中。他们希望不搬数据就能查询。哪项服务可以直接查询这些日志？';
      expect(splitStemForOptions(stem, null)).toEqual({
        leadIn: '一个团队把应用日志存放在 Amazon S3 中。他们希望不搬数据就能查询。',
        ask: '哪项服务可以直接查询这些日志？',
      });
    });

    it('keeps a closing quote with its sentence', () => {
      const stem = '控制台显示“访问被拒绝。”管理员该先检查什么？';
      expect(splitStemForOptions(stem, null)).toEqual({
        leadIn: '控制台显示“访问被拒绝。”',
        ask: '管理员该先检查什么？',
      });
    });

    it('pulls the ask back to the sentence that holds the qualifier', () => {
      const stem = '订单 API 运行在负载均衡器后面的 EC2 实例上。公司希望以运维开销最低的方式继续接单。哪种方案满足这些要求？';
      expect(splitStemForOptions(stem, '运维开销最低')).toEqual({
        leadIn: '订单 API 运行在负载均衡器后面的 EC2 实例上。',
        ask: '公司希望以运维开销最低的方式继续接单。哪种方案满足这些要求？',
      });
    });

    it('keeps a trailing （选择两项。） with the question it belongs to', () => {
      const lead = '公司必须在第二个区域保留每个对象的副本，并证明七年内无人能删除。';
      for (const directive of ['（选择两项。）', '（选择三项）', '(选择 2 项。)', '（选两项）']) {
        const stem = `${lead}哪些操作组合能满足这些要求？${directive}`;
        expect(splitStemForOptions(stem, null)).toEqual({
          leadIn: lead,
          ask: `哪些操作组合能满足这些要求？${directive}`,
        });
      }
    });

    it('returns the whole stem as the ask when there is one sentence', () => {
      const stem = '哪项 AWS 服务提供全托管的消息队列？';
      expect(splitStemForOptions(stem, null)).toEqual({ leadIn: '', ask: stem });
    });
  });
});
