import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/**
 * Writes site-analytics.json beside the build: the hosted demo's Google
 * Analytics and Clarity ids, read from VITE_GA_MEASUREMENT_ID and
 * VITE_CLARITY_PROJECT_ID, which the deploy workflow sets for the hosted
 * demo's build alone. Any other build writes empty ids. The server reads the
 * file in hosted_demo mode and gives the ids to the consent bar, which loads
 * each tool only under its purpose's yes (src/server/site-analytics.ts).
 */
const siteAnalyticsIds = {
  name: 'paracosm-site-analytics-ids',
  apply: 'build' as const,
  generateBundle(this: { emitFile(file: { type: 'asset'; fileName: string; source: string }): string }) {
    const ids = {
      ga: (process.env.VITE_GA_MEASUREMENT_ID ?? '').trim(),
      clarity: (process.env.VITE_CLARITY_PROJECT_ID ?? '').trim(),
    };
    this.emitFile({ type: 'asset', fileName: 'site-analytics.json', source: `${JSON.stringify(ids)}\n` });
  },
};

export default defineConfig({
  plugins: [react(), tailwindcss(), siteAnalyticsIds],
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
      '/diagrams': 'http://localhost:3456',
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
