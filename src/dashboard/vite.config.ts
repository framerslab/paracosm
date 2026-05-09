import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      '/events': 'http://localhost:3456',
      '/scenario': 'http://localhost:3456',
      '/scenarios': 'http://localhost:3456',
      '/setup': 'http://localhost:3456',
      '/chat': 'http://localhost:3456',
      '/clear': 'http://localhost:3456',
      '/compile': 'http://localhost:3456',
      '/admin-config': 'http://localhost:3456',
      '/rate-limit': 'http://localhost:3456',
      '/favicon.svg': 'http://localhost:3456',
      '/favicon.png': 'http://localhost:3456',
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
