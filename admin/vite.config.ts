import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: '/crm/',
  build: {
    outDir: '../public/admin',
    emptyOutDir: true,
  },
  server: {
    port: 5174,
    proxy: {
      '/auth': 'http://localhost:3000',
      '/contacts': 'http://localhost:3000',
      '/deals': 'http://localhost:3000',
      '/sequences': 'http://localhost:3000',
      '/bookings': 'http://localhost:3000',
      '/messages': 'http://localhost:3000',
    },
  },
});
