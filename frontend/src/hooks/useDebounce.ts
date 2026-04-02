import { useState, useEffect, useRef, useCallback } from 'react';

/**
 * useDebounce - 防抖 Hook，优化搜索输入等高频触发场景
 * 
 * 面试要点：
 * 1. 使用 useRef 保持定时器引用，避免闭包问题
 * 2. 清理机制：组件卸载时自动清理定时器
 * 3. 立即执行选项（leading）
 * 4. 取消功能
 * 
 * @example
 * // 基础用法 - 搜索框输入防抖
 * const [searchTerm, setSearchTerm] = useState('');
 * const debouncedSearch = useDebounce(searchTerm, 500);
 * 
 * useEffect(() => {
 *   // 只在用户停止输入 500ms 后执行
 *   fetchSearchResults(debouncedSearch);
 * }, [debouncedSearch]);
 */

interface UseDebounceOptions {
  /** 是否在延迟开始前立即执行一次 */
  leading?: boolean;
  /** 是否在延迟结束后执行 */
  trailing?: boolean;
}

export function useDebounce<T>(
  value: T,
  delay: number,
  options: UseDebounceOptions = {}
): T {
  const { leading = false, trailing = true } = options;
  
  const [debouncedValue, setDebouncedValue] = useState<T>(value);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const leadingRef = useRef(true);

  useEffect(() => {
    // Leading：首次变化立即执行
    if (leading && leadingRef.current) {
      leadingRef.current = false;
      setDebouncedValue(value);
      return;
    }

    // 清理之前的定时器
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    if (trailing) {
      timeoutRef.current = setTimeout(() => {
        setDebouncedValue(value);
        leadingRef.current = true; // 重置 leading 状态
      }, delay);
    }

    // 清理函数：组件卸载时取消定时器
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [value, delay, leading, trailing]);

  return debouncedValue;
}

/**
 * useDebouncedCallback - 防抖回调函数版本
 * 适用于需要防抖的事件处理函数（如按钮点击、窗口调整）
 */
export function useDebouncedCallback<T extends (...args: any[]) => any>(
  callback: T,
  delay: number,
  options: UseDebounceOptions = {}
): {
  run: T;
  cancel: () => void;
  flush: () => void;
  pending: () => boolean;
} {
  const { leading = false, trailing = true } = options;
  
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const argsRef = useRef<Parameters<T> | null>(null);
  const leadingRef = useRef(true);

  const cancel = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    argsRef.current = null;
    leadingRef.current = true;
  }, []);

  const flush = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    if (argsRef.current) {
      callback(...argsRef.current);
      argsRef.current = null;
      leadingRef.current = true;
    }
  }, [callback]);

  const pending = useCallback(() => {
    return timeoutRef.current !== null;
  }, []);

  const run = useCallback((...args: Parameters<T>) => {
    argsRef.current = args;

    // Leading 模式：首次调用立即执行
    if (leading && leadingRef.current) {
      leadingRef.current = false;
      callback(...args);
      return;
    }

    // 清理之前的定时器
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    if (trailing) {
      timeoutRef.current = setTimeout(() => {
        if (argsRef.current) {
          callback(...argsRef.current);
          argsRef.current = null;
          leadingRef.current = true;
        }
        timeoutRef.current = null;
      }, delay);
    }
  }, [callback, delay, leading, trailing]);

  // 组件卸载时清理
  useEffect(() => cancel, [cancel]);

  return { run: run as T, cancel, flush, pending };
}

// 面试回答示例：
/*
 * Q: 什么时候需要用防抖？怎么实现？
 * A: 防抖主要用于高频触发场景，比如搜索框输入、窗口 resize、滚动事件。
 * 
 * 我实现了两个版本：
 * 1. useDebounce：用于值的防抖，配合 useEffect 使用
 * 2. useDebouncedCallback：用于函数的防抖，返回控制方法
 * 
 * 核心实现要点：
 * - 使用 useRef 存储定时器，避免闭包导致的 stale closure
 * - 组件卸载时自动清理，防止内存泄漏
 * - 支持 leading（立即执行）和 trailing（延迟执行）两种模式
 * - 提供 cancel/flush/pending 等控制方法
 * 
 * 实际案例：在一个电商项目中，搜索框输入时每输入一个字符就发请求，
 * 使用防抖后，只在用户停止输入 300ms 后才发送请求，减少 80% 的 API 调用。
 */
