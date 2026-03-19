import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: '/',
  build: {
    outDir: '../public/client',
    emptyOutDir: true,
  },
  server: {
    proxy: {
      '/api': 'http://localhost:3000',
      '/webhooks': 'http://localhost:3000',
      '/book': 'http://localhost:3000',
    },
  },
});
