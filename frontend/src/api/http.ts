// src/api/http.ts
import axios from 'axios';
import { getAccessToken, clearStoredTokens } from '../auth/tokenStore';

const baseURL =
  import.meta.env.VITE_API_BASE_URL ??
  import.meta.env.VITE_API_BASE ??
  'http://localhost:5071';

export const http = axios.create({
  baseURL,
  timeout: 15_000,
});

// attach bearer token
http.interceptors.request.use(cfg => {
  const token = getAccessToken();
  if (token) {
    cfg.headers = cfg.headers ?? {};
    cfg.headers.Authorization = `Bearer ${token}`;
  }
  return cfg;
});

// auto sign-out on 401
http.interceptors.response.use(
  res => res,
  err => {
    const status = err?.response?.status;
    if (status === 401) {
      clearStoredTokens();

      // 可选：跳回登录（如果你不想自动跳转，删掉这段）
      if (typeof window !== 'undefined') {
        const next = encodeURIComponent(window.location.pathname + window.location.search);
        window.location.assign(`/login?next=${next}&error=unauthorized`);
      }
    }
    return Promise.reject(err);
  },
);