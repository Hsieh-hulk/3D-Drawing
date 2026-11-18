/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

const BASE = '/3D-Drawing/';

/**
 * `vite preview` answers /3D-Drawing (no trailing slash) with 404, while GitHub Pages redirects it.
 * Redirect it locally too, so the preview behaves like the deployed site.
 */
function trailingSlashRedirect(): Plugin {
  return {
    name: 'trailing-slash-redirect',
    configurePreviewServer(server) {
      server.middlewares.use((req, res, next) => {
        // No @types/node here, so the request is typed loosely.
        const [path, query] = ((req as { url?: string }).url ?? '').split('?');
        if (path !== BASE.slice(0, -1)) return next();
        res.statusCode = 301;
        res.setHeader('Location', BASE + (query ? `?${query}` : ''));
        res.end();
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), trailingSlashRedirect()],
  base: BASE,
  server: { port: 5173, host: true },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
