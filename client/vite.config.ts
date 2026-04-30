import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// On Vercel we want a normal `dist/` build alongside the `api/` serverless
// functions. The legacy `../public/client` output (used when Express served
// the SPA from Railway) is intentionally gone.
export default defineConfig({
  plugins: [react()],
  base: '/',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  server: {
    proxy: {
      // Local dev: keep relative `/api/*` calls hitting the Express backend
      // on :3000. In production Vite is not in the loop — Vercel serves the
      // built SPA + edge functions, and VITE_API_BASE_URL points at Railway.
      '/api': 'http://localhost:3000',
      '/webhooks': 'http://localhost:3000',
      '/book': 'http://localhost:3000',
    },
  },
});
