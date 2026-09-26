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
});
