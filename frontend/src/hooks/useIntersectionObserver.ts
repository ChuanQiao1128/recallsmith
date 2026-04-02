import { useState, useEffect, useRef, useCallback, type RefObject } from 'react';

/**
 * useIntersectionObserver - 监听元素进入/离开视口
 * 
 * 面试要点：
 * 1. IntersectionObserver API 的封装
 * 2. ref 的转发和动态绑定
 * 3. 懒加载、无限滚动、埋点上报等场景
 * 4. 性能优化（rootMargin 预加载）
 * 
 * @example
 * // 基础用法 - 图片懒加载
 * const { ref, isIntersecting } = useIntersectionObserver({ threshold: 0.1 });
 * <img ref={ref} src={isIntersecting ? realSrc : placeholder} />
 * 
 * // 无限滚动
 * const { ref, isIntersecting } = useIntersectionObserver();
 * useEffect(() => { if (isIntersecting) loadMore(); }, [isIntersecting]);
 * <div ref={ref}>Loading more...</div>
 */

interface UseIntersectionObserverOptions {
  /** 触发阈值 0-1 */
  threshold?: number | number[];
  /** 根元素 margin，可用于预加载 */
  rootMargin?: string;
  /** 根元素（默认 viewport） */
  root?: Element | null;
  /** 只触发一次 */
  triggerOnce?: boolean;
  /** 进入视口回调 */
  onEnter?: () => void;
  /** 离开视口回调 */
  onLeave?: () => void;
}

interface UseIntersectionObserverReturn<T extends Element> {
  /** 绑定到目标元素的 ref */
  ref: RefObject<T | null>;
  /** 是否在视口内 */
  isIntersecting: boolean;
  /** 交叉比例 0-1 */
  intersectionRatio: number;
  /** 是否在视口上方 */
  isAboveViewport: boolean;
  /** 是否在视口下方 */
  isBelowViewport: boolean;
}

export function useIntersectionObserver<T extends Element = HTMLElement>(
  options: UseIntersectionObserverOptions = {}
): UseIntersectionObserverReturn<T> {
  const {
    threshold = 0,
    rootMargin = '0px',
    root = null,
    triggerOnce = false,
    onEnter,
    onLeave,
  } = options;

  const [state, setState] = useState({
    isIntersecting: false,
    intersectionRatio: 0,
    isAboveViewport: false,
    isBelowViewport: false,
  });

  const targetRef = useRef<T>(null);
  const hasTriggeredRef = useRef(false);
  const observerRef = useRef<IntersectionObserver | null>(null);

  useEffect(() => {
    const element = targetRef.current;
    if (!element) return;

    // 如果已经触发过一次，不再观察
    if (triggerOnce && hasTriggeredRef.current) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        const { isIntersecting, intersectionRatio, boundingClientRect } = entry;
        const viewportHeight = window.innerHeight;

        // 判断元素在视口上方还是下方
        const isAboveViewport = boundingClientRect.bottom < 0;
        const isBelowViewport = boundingClientRect.top > viewportHeight;

        setState({
          isIntersecting,
          intersectionRatio,
          isAboveViewport,
          isBelowViewport,
        });

        // 触发回调
        if (isIntersecting && onEnter) {
          onEnter();
        }
        if (!isIntersecting && onLeave) {
          onLeave();
        }

        // 只触发一次
        if (triggerOnce && isIntersecting) {
          hasTriggeredRef.current = true;
          observer.unobserve(element);
        }
      },
      { threshold, rootMargin, root }
    );

    observerRef.current = observer;
    observer.observe(element);

    return () => {
      observer.disconnect();
    };
  }, [threshold, rootMargin, root, triggerOnce, onEnter, onLeave]);

  return {
    ref: targetRef,
    ...state,
  };
}

/**
 * useInfiniteScroll - 基于 IntersectionObserver 的无限滚动 Hook
 * 
 * 特点：
 * - 自动处理 loading 状态
 * - 支持 hasMore 判断
 * - 支持错误重试
 */
interface UseInfiniteScrollOptions {
  /** 是否还有更多数据 */
  hasMore: boolean;
  /** 是否在加载中 */
  isLoading: boolean;
  /** 加载更多回调 */
  onLoadMore: () => void | Promise<void>;
  /** 触发阈值 */
  threshold?: number;
  /** 提前加载的距离 */
  rootMargin?: string;
}

export function useInfiniteScroll(options: UseInfiniteScrollOptions) {
  const { hasMore, isLoading, onLoadMore, threshold = 0, rootMargin = '100px' } = options;

  const loadingRef = useRef(isLoading);
  loadingRef.current = isLoading;

  const handleEnter = useCallback(() => {
    if (!loadingRef.current && hasMore) {
      onLoadMore();
    }
  }, [hasMore, onLoadMore]);

  const { ref, isIntersecting } = useIntersectionObserver<HTMLDivElement>({
    threshold,
    rootMargin,
    onEnter: handleEnter,
  });

  // 兜底：如果已经在视口内但没有触发，手动触发
  useEffect(() => {
    if (isIntersecting && !isLoading && hasMore) {
      onLoadMore();
    }
  }, [isIntersecting, isLoading, hasMore, onLoadMore]);

  return {
    /** 绑定到底部 sentinel 元素 */
    loaderRef: ref,
    /** 是否正在加载 */
    isLoading,
    /** 是否还有更多 */
    hasMore,
  };
}

/**
 * useCountUp - 数字滚动动画 Hook
 * 元素进入视口时开始动画
 */
export function useCountUp(
  end: number,
  duration: number = 2000
): { ref: RefObject<HTMLSpanElement | null>; value: number } {
  const [value, setValue] = useState(0);
  const hasAnimatedRef = useRef(false);

  const { ref, isIntersecting } = useIntersectionObserver<HTMLSpanElement>({
    triggerOnce: true,
    threshold: 0.5,
  });

  useEffect(() => {
    if (isIntersecting && !hasAnimatedRef.current) {
      hasAnimatedRef.current = true;
      const startTime = Date.now();
      const startValue = 0;

      const animate = () => {
        const elapsed = Date.now() - startTime;
        const progress = Math.min(elapsed / duration, 1);
        
        // easeOutQuart 缓动函数
        const easeProgress = 1 - Math.pow(1 - progress, 4);
        const current = Math.floor(startValue + (end - startValue) * easeProgress);
        
        setValue(current);

        if (progress < 1) {
          requestAnimationFrame(animate);
        }
      };

      requestAnimationFrame(animate);
    }
  }, [isIntersecting, end, duration]);

  return { ref, value };
}

// 面试回答示例：
/*
 * Q: 无限滚动怎么实现？怎么处理性能问题？
 * A: 我用 IntersectionObserver 封装了一个 useInfiniteScroll hook。
 * 
 * 相比传统的 scroll 事件监听，IntersectionObserver 的优势：
 * 1. 性能更好：由浏览器优化，不需要频繁计算 scrollTop
 * 2. 使用 rootMargin 可以实现提前加载，用户体验更流畅
 * 3. 自动处理元素进入/离开视口的时机判断
 * 
 * 另外扩展了 useCountUp，实现数字滚动动画，进入视口才开始动画，
 * 避免页面不可见时浪费计算资源。
 * 
 * 实际项目：在一个长列表页面，使用无限滚动替代分页，
 * 配合虚拟列表（react-window），可以流畅展示万级数据。
 */
