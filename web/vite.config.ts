import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/ws': {
        target: 'ws://localhost:3000',
        ws: true,
      },
      '/api': {
        target: 'http://localhost:3000',
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    // Use terser instead of esbuild for minification.
    // esbuild has a scope bug that mangles xterm v6's `const enum` IIFE
    // in requestMode(), producing a reference to an undeclared variable
    // and crashing the terminal parser (breaks vim, nano, etc).
    minify: 'terser',
  },
});
