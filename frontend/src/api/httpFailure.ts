// src/api/httpFailure.ts
//
// One shared converter from a thrown error into an ApiResult failure. When the
// server sent its envelope (success:false with an error.code), that envelope's
// code, message and traceId are preserved so callers can act on them — the
// card editor's VERSION_CONFLICT recovery, the importer's re-run hint, and the
// trace id on failure screens all depend on this. When there is no envelope,
// the failure is classified (HTTP_<status>, TIMEOUT, CANCELLED, NETWORK_ERROR)
// and the HTTP status is recorded when the failure carried a response.
import axios from 'axios';
import type { ApiError, ApiResult } from '../types/api';

/** The old hand-built client-side failure, moved here so both api modules share it. */
export function failResult<T>(message: string, code = 'NETWORK_ERROR'): ApiResult<T> {
  return {
    success: false,
    data: null,
    error: { code, message },
    traceId: '',
  };
}

/** True when `value` looks like a server failure envelope with a usable error code. */
export function isApiEnvelope(value: unknown): value is ApiResult<unknown> {
  if (!value || typeof value !== 'object') return false;
  const v = value as { success?: unknown; error?: unknown };
  if (v.success !== false) return false;
  if (!v.error || typeof v.error !== 'object') return false;
  const code = (v.error as { code?: unknown }).code;
  return typeof code === 'string' && code.length > 0;
}

export function apiResultFromError<T>(err: unknown): ApiResult<T> {
  if (axios.isAxiosError(err) && err.response) {
    const status = err.response.status;
    const data: unknown = err.response.data;

    if (isApiEnvelope(data)) {
      // Read fields off the raw envelope rather than the narrowed ApiResult
      // type: they arrived over the wire, so message/traceId/details may be
      // absent even though the interface marks them required.
      const env = data as {
        error: { code: string; message?: string; details?: string | null };
        traceId?: string;
      };
      const message = env.error.message ?? `Request failed (HTTP ${status})`;
      const traceId = typeof env.traceId === 'string' ? env.traceId : '';
      const error: ApiError = { code: env.error.code, message, httpStatus: status };
      if (typeof env.error.details === 'string') {
        error.details = env.error.details;
      }
      return { success: false, data: null, error, traceId };
    }

    return {
      success: false,
      data: null,
      error: { code: `HTTP_${status}`, message: `Request failed (HTTP ${status})`, httpStatus: status },
      traceId: '',
    };
  }

  if (axios.isAxiosError(err)) {
    if (err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT') {
      return failResult<T>('The request timed out.', 'TIMEOUT');
    }
    if (err.code === 'ERR_CANCELED') {
      return failResult<T>('The request was cancelled.', 'CANCELLED');
    }
    return failResult<T>(err.message || 'Network error.', 'NETWORK_ERROR');
  }

  if (err instanceof Error) {
    return failResult<T>(err.message || 'Network error.', 'NETWORK_ERROR');
  }

  return failResult<T>('Network error.', 'NETWORK_ERROR');
}
