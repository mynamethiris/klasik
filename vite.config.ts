import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vite';

const isNetlifyDev = process.env.NETLIFY === 'true';
const apiTarget = isNetlifyDev
  ? 'http://localhost:8888/.netlify/functions'
  : 'http://localhost:3000';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: apiTarget,
        changeOrigin: true,
        rewrite: isNetlifyDev
          ? (path) => path.replace(/^\/api/, '')
          : undefined,
      },
      '/uploads': {
        target: apiTarget,
        changeOrigin: true,
      },
    },
  },
});
