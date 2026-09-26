// src/types/api.ts

export interface ApiError {
  code: string;
  message: string;
  details?: string | null;
  // HTTP status code when the failure came from a response.
  httpStatus?: number;
}

export interface ApiResult<T> {
  success: boolean;
  data: T | null;
  error: ApiError | null;
  traceId: string;
}