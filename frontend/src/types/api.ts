// src/types/api.ts

export interface ApiError {
  code: string;
  message: string;
  details?: string | null;
}

export interface ApiResult<T> {
  success: boolean;
  data: T | null;
  error: ApiError | null;
  traceId: string;
}