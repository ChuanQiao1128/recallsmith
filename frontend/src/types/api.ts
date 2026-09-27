// src/types/api.ts

export interface ApiError {
  code: string;
  message: string;
  details?: string | null;
  // HTTP status code when the failure came from a response.
  httpStatus?: number;
  /**
   * AI_QA_REQUIRED only: the run the publish gate started or reused for the
   * unreviewed cards (automation-17), so the console can link straight to it.
   */
  runId?: string;
  /** AI_QA_REQUIRED only: what became of that chained run (`code`/`message` say why it did not start). */
  qaRun?: { status: string; code: string | null; message: string | null };
}

export interface ApiResult<T> {
  success: boolean;
  data: T | null;
  error: ApiError | null;
  traceId: string;
}