import { defineConfig } from 'vite';

// GitHub Pages serves project sites from /<repo>/. A relative base ("./") works for any repository
// name because the game is a single page with no client-side routes. Set BASE_PATH (e.g. "/crossfire/")
// to force an absolute base instead.
export default defineConfig({
  base: process.env.BASE_PATH ?? './',
  build: {
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 5000,
    assetsInlineLimit: 0,
  },
  server: { port: 5173, open: false },
  preview: { port: 4173 },
});
