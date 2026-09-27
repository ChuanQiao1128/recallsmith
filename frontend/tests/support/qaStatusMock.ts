// tests/support/qaStatusMock.ts
//
// The deck list's publish dialog previews GET …/qa/status (contract §7.10)
// through a dynamic import of src/api/qa. A deck-list test that clicks Publish
// but is not about the preview mocks that module with this factory, so the
// dialog opens without a network request and with its plain body:
//
//   vi.mock('../src/api/qa', async importOriginal =>
//     (await import('./support/qaStatusMock')).withCleanQaStatus(importOriginal));
//   await import('../src/api/qa'); // warm the module cache (fake timers)
//
// Not collected as a test: the runner's include globs only match *.test.ts and
// *.test.tsx.

import type { QaStatus } from '../../src/api/qa';
import type { ApiResult } from '../../src/types/api';

export const CLEAN_QA_STATUS: QaStatus = {
  enabled: true,
  required: false,
  changedCards: 0,
  reviewedCurrent: 0,
  missing: [],
  openBlockers: [],
  wouldBlock: false,
  maxCards: null,
  dailyUsdCap: null,
  spentTodayUsd: null,
};

export async function withCleanQaStatus(
  importOriginal: <T>() => Promise<T>,
): Promise<typeof import('../../src/api/qa')> {
  const actual = await importOriginal<typeof import('../../src/api/qa')>();
  return {
    ...actual,
    fetchQaStatus: async (): Promise<ApiResult<QaStatus>> => ({
      success: true,
      data: CLEAN_QA_STATUS,
      error: null,
      traceId: 'trace-qa-status',
    }),
  };
}
