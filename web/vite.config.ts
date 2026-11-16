// Vite configuration for the dashboard (increment 5b).
// The dev server proxies every /api request to the reporting API (npm run api), so the
// dashboard code only ever fetches relative URLs. Like the API, it binds to 127.0.0.1.
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3000',
        changeOrigin: false,
      },
    },
  },
});
