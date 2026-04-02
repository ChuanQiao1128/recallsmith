import { useState, useEffect, useCallback, useSyncExternalStore } from 'react';

/**
 * useLocalStorage - 一个功能完整的本地存储 Hook
 * 
 * 面试要点：
 * 1. 使用 useSyncExternalStore 实现跨标签页同步
 * 2. 支持自定义序列化/反序列化
 * 3. 错误边界处理（localStorage 可能不可用）
 * 4. TypeScript 泛型约束
 * 
 * @example
 * // 基础用法
 * const [theme, setTheme] = useLocalStorage('theme', 'light');
 * 
 * // 自定义序列化
 * const [user, setUser] = useLocalStorage('user', null, {
 *   serializer: JSON.stringify,
 *   deserializer: JSON.parse
 * });
 */
interface UseLocalStorageOptions<T> {
  serializer?: (value: T) => string;
  deserializer?: (value: string) => T;
}

export function useLocalStorage<T>(
  key: string,
  initialValue: T,
  options: UseLocalStorageOptions<T> = {}
): [T, (value: T | ((prev: T) => T)) => void, () => void] {
  const { serializer = JSON.stringify, deserializer = JSON.parse } = options;

  // 使用 useSyncExternalStore 实现跨标签页同步
  const subscribe = useCallback((callback: () => void) => {
    const handleStorage = (event: StorageEvent) => {
      if (event.key === key) {
        callback();
      }
    };
    
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, [key]);

  const getSnapshot = useCallback(() => {
    try {
      const item = window.localStorage.getItem(key);
      return item ?? serializer(initialValue);
    } catch {
      return serializer(initialValue);
    }
  }, [key, initialValue, serializer]);

  const getServerSnapshot = useCallback(() => {
    return serializer(initialValue);
  }, [initialValue, serializer]);

  // 同步外部存储的值
  const storedString = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot
  );

  const [storedValue, setStoredValue] = useState<T>(() => {
    try {
      return deserializer(storedString);
    } catch {
      return initialValue;
    }
  });

  // 当外部存储变化时更新状态
  useEffect(() => {
    try {
      const value = deserializer(storedString);
      setStoredValue(value);
    } catch {
      setStoredValue(initialValue);
    }
  }, [storedString, deserializer, initialValue]);

  // 设置值，支持函数式更新
  const setValue = useCallback((value: T | ((prev: T) => T)) => {
    try {
      setStoredValue(prev => {
        const valueToStore = value instanceof Function ? value(prev) : value;
        
        if (typeof window !== 'undefined') {
          window.localStorage.setItem(key, serializer(valueToStore));
          // 触发自定义事件，用于同一标签页内的同步
          window.dispatchEvent(
            new StorageEvent('storage', { key, newValue: serializer(valueToStore) })
          );
        }
        
        return valueToStore;
      });
    } catch (error) {
      console.warn(`Error setting localStorage key "${key}":`, error);
    }
  }, [key, serializer]);

  // 移除值
  const removeValue = useCallback(() => {
    try {
      if (typeof window !== 'undefined') {
        window.localStorage.removeItem(key);
        window.dispatchEvent(new StorageEvent('storage', { key, newValue: null }));
      }
      setStoredValue(initialValue);
    } catch (error) {
      console.warn(`Error removing localStorage key "${key}":`, error);
    }
  }, [key, initialValue]);

  return [storedValue, setValue, removeValue];
}

// 使用示例的面试回答：
/*
 * Q: 你在项目中写过什么自定义 hooks？
 * A: 我写了一个 useLocalStorage hook，它比普通的 useState + localStorage 更强大：
 * 
 * 1. 跨标签页同步：使用 useSyncExternalStore 监听 storage 事件
 * 2. 类型安全：完整的 TypeScript 泛型支持
 * 3. 错误处理：localStorage 可能不可用（隐私模式、存储已满）
 * 4. 函数式更新：像 useState 一样支持 setValue(prev => ...)
 * 5. SSR 兼容：服务端渲染时不会报错
 * 
 * 实际应用场景：主题切换、用户偏好设置、表单草稿保存
 */
