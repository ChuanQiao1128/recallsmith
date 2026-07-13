import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
//
// Note: the dev proxy target USED to be hard-coded to a real AWS API Gateway
// URL right here in the repo. That URL was visible to anyone who cloned the
// repo. It's now read from VITE_DEV_PROXY_TARGET (loaded from .env.development
// or .env.development.local). See .env.example for the template.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const proxyTarget = env.VITE_DEV_PROXY_TARGET ?? env.VITE_API_BASE ?? '';

  return {
    plugins: [react()],
    server: proxyTarget
      ? {
          proxy: {
            '/api': {
              target: proxyTarget,
              changeOrigin: true,
              rewrite: (path) => path.replace(/^\/api/, '/api'),
            },
          },
        }
      : {},
  };
});
