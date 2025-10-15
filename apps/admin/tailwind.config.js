// apps/admin/tailwind.config.js  (ESM)
import typography from '@tailwindcss/typography';

export default {
  content: [
    './index.html',
    './src/**/*.{ts,tsx,js,jsx,vue,svelte}',
  ],
  theme: { extend: {} },
  plugins: [typography()],
};