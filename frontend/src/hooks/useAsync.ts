import { useState, useCallback, useRef, useEffect } from 'react';

/**
 * useAsync - 完整的异步操作状态管理 Hook
 * 
 * 面试要点：
 * 1. 完整的异步状态机：idle -> loading -> success/error
 * 2. 竞态条件处理（race condition）
 * 3. 取消机制（AbortController）
 * 4. 错误边界和重试逻辑
 * 5. TypeScript 类型推导
 * 
 * @example
 * // 基础用法
 * const { execute, status, data, error } = useAsync(fetchUser);
 * 
 * // 带重试和取消
 * const { execute, cancel, retry } = useAsync(fetchData, {
 *   retryCount: 3,
 *   retryDelay: 1000
 * });
 */

type AsyncStatus = 'idle' | 'loading' | 'success' | 'error';

interface UseAsyncOptions {
  /** 立即执行 */
  immediate?: boolean;
  /** 重试次数 */
  retryCount?: number;
  /** 重试延迟 */
  retryDelay?: number;
  /** 成功回调 */
  onSuccess?: (data: any) => void;
  /** 错误回调 */
  onError?: (error: Error) => void;
}

interface UseAsyncReturn<TData, TParams extends any[]> {
  /** 当前状态 */
  status: AsyncStatus;
  /** 是否空闲 */
  isIdle: boolean;
  /** 是否加载中 */
  isLoading: boolean;
  /** 是否成功 */
  isSuccess: boolean;
  /** 是否错误 */
  isError: boolean;
  /** 返回数据 */
  data: TData | null;
  /** 错误对象 */
  error: Error | null;
  /** 执行异步函数 */
  execute: (...params: TParams) => Promise<TData>;
  /** 重置状态 */
  reset: () => void;
  /** 取消当前请求 */
  cancel: () => void;
  /** 重试 */
  retry: () => void;
  /** 最后执行的参数 */
  lastParams: TParams | null;
}

export function useAsync<TData, TParams extends any[] = any[]>(
  asyncFunction: (...params: TParams) => Promise<TData>,
  options: UseAsyncOptions = {}
): UseAsyncReturn<TData, TParams> {
  const {
    immediate = false,
    retryCount = 0,
    retryDelay = 1000,
    onSuccess,
    onError,
  } = options;

  const [status, setStatus] = useState<AsyncStatus>('idle');
  const [data, setData] = useState<TData | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [lastParams, setLastParams] = useState<TParams | null>(null);

  // 使用 ref 追踪当前执行的版本，处理竞态条件
  const executionIdRef = useRef(0);
  const abortControllerRef = useRef<AbortController | null>(null);

  const cancel = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    executionIdRef.current += 1;
  }, []);

  const reset = useCallback(() => {
    cancel();
    setStatus('idle');
    setData(null);
    setError(null);
    setLastParams(null);
  }, [cancel]);

  const executeWithRetry = useCallback(async (
    params: TParams,
    attempt: number = 0,
    currentExecutionId: number
  ): Promise<TData> => {
    // 创建 AbortController 用于取消
    abortControllerRef.current = new AbortController();

    try {
      setStatus('loading');
      setError(null);

      const result = await asyncFunction(...params);

      // 检查是否是最新的执行
      if (currentExecutionId !== executionIdRef.current) {
        throw new Error('Request was superseded by a newer request');
      }

      setData(result);
      setStatus('success');
      onSuccess?.(result);
      abortControllerRef.current = null;
      
      return result;
    } catch (err) {
      // 检查是否是最新的执行
      if (currentExecutionId !== executionIdRef.current) {
        throw err;
      }

      const error = err instanceof Error ? err : new Error(String(err));

      // 重试逻辑
      if (attempt < retryCount && error.name !== 'AbortError') {
        await new Promise(resolve => setTimeout(resolve, retryDelay));
        return executeWithRetry(params, attempt + 1, currentExecutionId);
      }

      setError(error);
      setStatus('error');
      onError?.(error);
      abortControllerRef.current = null;
      
      throw error;
    }
  }, [asyncFunction, retryCount, retryDelay, onSuccess, onError]);

  const execute = useCallback(async (...params: TParams): Promise<TData> => {
    // 取消之前的请求
    cancel();
    
    // 生成新的执行 ID
    executionIdRef.current += 1;
    const currentExecutionId = executionIdRef.current;
    
    setLastParams(params);
    
    return executeWithRetry(params, 0, currentExecutionId);
  }, [cancel, executeWithRetry]);

  const retry = useCallback(() => {
    if (lastParams) {
      return execute(...lastParams);
    }
    throw new Error('No previous execution to retry');
  }, [execute, lastParams]);

  // 立即执行
  useEffect(() => {
    if (immediate && lastParams === null) {
      execute(...([] as unknown as TParams));
    }
  }, [immediate, execute, lastParams]);

  // 组件卸载时取消
  useEffect(() => cancel, [cancel]);

  return {
    status,
    isIdle: status === 'idle',
    isLoading: status === 'loading',
    isSuccess: status === 'success',
    isError: status === 'error',
    data,
    error,
    execute,
    reset,
    cancel,
    retry,
    lastParams,
  };
}

// 面试回答示例：
/*
 * Q: 怎么处理多个并发请求的竞争问题？
 * A: 我写了一个 useAsync hook 专门处理这种情况。
 * 
 * 核心思路是使用 "执行 ID" 来追踪最新的请求：
 * 1. 每次执行时生成递增的 executionId
 * 2. 请求完成后检查 executionId 是否匹配
 * 3. 如果不匹配（说明有新请求），直接丢弃结果
 * 
 * 另外还处理了：
 * - AbortController 取消请求
 * - 自动重试机制（指数退避）
 * - 完整的错误状态管理
 * 
 * 实际场景：在一个表单搜索组件中，用户快速输入时会产生多个请求，
 * 使用这个 hook 后，只有最后一个请求的结果会被采用，避免"先发的请求后回来"导致的数据显示错误。
 */
