import { useRef, useEffect } from 'react';

/**
 * usePrevious - 获取上一次渲染时的值
 * 
 * 面试要点：
 * 1. 使用 useRef 保存前值，不触发重渲染
 * 2. 利用 useEffect 在渲染完成后更新 ref
 * 3. 首次渲染时返回 undefined（可配置初始值）
 * 4. 支持自定义比较函数
 * 
 * @example
 * // 基础用法 - 对比前后值
 * const prevCount = usePrevious(count);
 * useEffect(() => {
 *   if (count !== prevCount) {
 *     console.log(`Count changed from ${prevCount} to ${count}`);
 *   }
 * }, [count]);
 * 
 * // 带自定义比较
 * const prevUser = usePrevious(user, (a, b) => a?.id === b?.id);
 */

export function usePrevious<T>(value: T): T | undefined;
export function usePrevious<T>(value: T, initialValue: T): T;
export function usePrevious<T>(
  value: T,
  compare?: (prev: T | undefined, next: T) => boolean
): T | undefined;

export function usePrevious<T>(
  value: T,
  compareOrInitial?: ((prev: T | undefined, next: T) => boolean) | T
): T | undefined {
  const ref = useRef<T | undefined>(undefined);
  const previousRef = useRef<T | undefined>(undefined);

  useEffect(() => {
    // 判断是否为自定义比较函数
    if (typeof compareOrInitial === 'function') {
      const compareFn = compareOrInitial as (prev: T | undefined, next: T) => boolean;
      const shouldUpdate = compareFn(previousRef.current, value);
      if (shouldUpdate) {
        ref.current = value;
      }
    }
    // 保存前值供下一次渲染使用
    previousRef.current = value;
  }, [value, compareOrInitial]);

  // 如果是初始值，第一次渲染时返回
  if (typeof compareOrInitial !== 'function' && ref.current === undefined) {
    ref.current = compareOrInitial;
  }

  return ref.current;
}

/**
 * usePreviousDistinct - 只在值真正改变时才更新 previous
 * 适用于对象引用变化但内容相同的场景
 */
export function usePreviousDistinct<T>(
  value: T,
  isEqual: (a: T, b: T) => boolean = (a, b) => a === b
): T | undefined {
  const currentRef = useRef<T>(value);
  const previousRef = useRef<T | undefined>(undefined);

  if (!isEqual(currentRef.current, value)) {
    previousRef.current = currentRef.current;
    currentRef.current = value;
  }

  return previousRef.current;
}

/**
 * useHistory - 追踪值的历史记录
 * 适用于需要撤销/重做功能的场景
 */
export function useHistory<T>(
  value: T,
  limit: number = 10
): {
  history: T[];
  canUndo: boolean;
  canRedo: boolean;
  undo: () => void;
  redo: () => void;
  reset: () => void;
} {
  const historyRef = useRef<T[]>([value]);
  const indexRef = useRef(0);

  // 当外部值变化时添加到历史
  const prevValue = usePrevious(value);
  if (prevValue !== undefined && prevValue !== value) {
    // 如果当前不在最新位置，先删除后面的历史
    if (indexRef.current < historyRef.current.length - 1) {
      historyRef.current = historyRef.current.slice(0, indexRef.current + 1);
    }
    
    historyRef.current.push(value);
    indexRef.current += 1;

    // 限制历史记录长度
    if (historyRef.current.length > limit) {
      historyRef.current = historyRef.current.slice(-limit);
      indexRef.current = limit - 1;
    }
  }

  const undo = () => {
    if (indexRef.current > 0) {
      indexRef.current -= 1;
    }
  };

  const redo = () => {
    if (indexRef.current < historyRef.current.length - 1) {
      indexRef.current += 1;
    }
  };

  const reset = () => {
    indexRef.current = historyRef.current.length - 1;
  };

  return {
    history: historyRef.current,
    canUndo: indexRef.current > 0,
    canRedo: indexRef.current < historyRef.current.length - 1,
    undo,
    redo,
    reset,
  };
}

// 面试回答示例：
/*
 * Q: useRef 和 useState 有什么区别？什么时候用 ref？
 * A: 主要区别是 ref 更新不会触发重渲染。
 * 
 * 我写 usePrevious 时就用 ref 来保存前值：
 * - 用 ref 存储，因为保存前值不需要触发 UI 更新
 * - 在 useEffect 里更新 ref，确保在渲染完成后才保存
 * 
 * 如果错误地用 useState，会导致无限循环：
 * setPrevious -> state 变化 -> 重新渲染 -> setPrevious ...
 * 
 * 另外扩展了 useHistory hook，基于 usePrevious 实现撤销/重做功能，
 * 这在表单编辑器、画布应用等场景很有用。
 */
