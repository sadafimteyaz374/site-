import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/gmail-api': {
        target: 'https://gmail.googleapis.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/gmail-api/, ''),
      },
    },
  },
});