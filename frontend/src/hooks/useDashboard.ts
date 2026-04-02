// src/hooks/useDashboard.ts
// 优化版 Dashboard Hook - 减少 API 调用和等待时间
import { useEffect, useState, useCallback, useRef } from 'react';
import { 
  fetchDashboard, 
  fetchDecks, 
  fetchAdminManifest,
  type DashboardData 
} from '../api/authoring';

interface DashboardState {
  loading: boolean;
  error: string | null;
  data: DashboardData | null;
  // 渐进式加载状态
  decksLoaded: boolean;
  manifestLoaded: boolean;
}

// 缓存配置
const CACHE_KEY = 'dashboard_cache';
const CACHE_TTL = 5 * 60 * 1000; // 5分钟

interface CacheData {
  data: DashboardData;
  timestamp: number;
}

function getCache(): CacheData | null {
  try {
    const cached = localStorage.getItem(CACHE_KEY);
    if (!cached) return null;
    const parsed = JSON.parse(cached) as CacheData;
    if (Date.now() - parsed.timestamp > CACHE_TTL) {
      localStorage.removeItem(CACHE_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function setCache(data: DashboardData) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({
      data,
      timestamp: Date.now()
    }));
  } catch {
    // 忽略存储错误
  }
}

/**
 * 优化版 Dashboard Hook
 * 
 * 策略:
 * 1. 优先使用缓存 - 立即显示旧数据
 * 2. 渐进式加载 - 先显示 decks，再加载 manifest
 * 3. 静默刷新 - 后台更新不阻塞 UI
 */
export function useDashboard() {
  const [state, setState] = useState<DashboardState>(() => {
    const cached = getCache();
    return {
      loading: !cached, // 有缓存则不显示 loading
      error: null,
      data: cached?.data ?? null,
      decksLoaded: !!cached,
      manifestLoaded: !!cached,
    };
  });

  const mountedRef = useRef(true);
  const loadingRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // 渐进式加载策略
  const loadProgressive = useCallback(async (forceRefresh = false) => {
    if (loadingRef.current) return;
    loadingRef.current = true;

    const cached = getCache();
    
    // 如果有缓存且不强制刷新，直接返回
    if (cached && !forceRefresh) {
      setState(prev => ({
        ...prev,
        loading: false,
        decksLoaded: true,
        manifestLoaded: true,
      }));
      loadingRef.current = false;
      return;
    }

    // 显示 loading（只有在没有缓存时）
    if (!cached) {
      setState(prev => ({ ...prev, loading: true, error: null }));
    }

    try {
      // 尝试使用合并的 Dashboard API (单次请求)
      const dashboardRes = await fetchDashboard();
      
      if (dashboardRes.success && dashboardRes.data) {
        const data = dashboardRes.data;
        setCache(data);
        
        if (mountedRef.current) {
          setState({
            loading: false,
            error: null,
            data,
            decksLoaded: true,
            manifestLoaded: true,
          });
        }
      } else {
        // Dashboard API 失败，回退到独立请求
        await loadFallback();
      }
    } catch {
      // 出错时回退到独立请求
      await loadFallback();
    } finally {
      loadingRef.current = false;
    }
  }, []);

  // 回退方案：独立请求 decks 和 manifest
  const loadFallback = async () => {
    // 先加载 decks (通常更快)
    const decksPromise = fetchDecks().then(res => {
      if (!mountedRef.current) return null;
      if (res.success && res.data) {
        setState(prev => ({
          ...prev,
          data: prev.data ? { ...prev.data, decks: res.data! } : { decks: res.data!, manifest: { meta: {}, decks: [] } },
          decksLoaded: true,
          loading: !prev.manifestLoaded,
        }));
        return res.data;
      }
      return null;
    });

    // 再加载 manifest
    const manifestPromise = fetchAdminManifest().then(res => {
      if (!mountedRef.current) return null;
      if (res.success && res.data) {
        const manifest = res.data as DashboardData['manifest'];
        setState(prev => ({
          ...prev,
          data: prev.data ? { ...prev.data, manifest } : { decks: [], manifest },
          manifestLoaded: true,
          loading: !prev.decksLoaded,
        }));
        return manifest;
      }
      return null;
    });

    const [decks, manifest] = await Promise.all([decksPromise, manifestPromise]);

    if (decks && manifest) {
      setCache({ decks, manifest });
    }

    if (!decks && !manifest) {
      setState(prev => ({
        ...prev,
        loading: false,
        error: 'Failed to load dashboard data',
      }));
    }
  };

  // 静默刷新 (后台更新，不显示 loading)
  const refresh = useCallback(async () => {
    await loadProgressive(true);
  }, [loadProgressive]);

  useEffect(() => {
    loadProgressive(false);
  }, [loadProgressive]);

  return {
    ...state,
    reload: () => loadProgressive(true),
    refresh,
    // 兼容旧代码的字段映射
    decks: state.data?.decks ?? [],
    manifestState: {
      loading: !state.manifestLoaded,
      error: state.error,
      data: state.data?.manifest,
      bySlug: state.data?.manifest?.decks?.reduce((acc, d) => {
        if (d.slug) acc[d.slug] = d;
        return acc;
      }, {} as Record<string, any>),
    },
  };
}
