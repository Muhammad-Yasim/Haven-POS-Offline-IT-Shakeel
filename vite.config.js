import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: './',          // relative paths so Electron can load from file://
  server: {
    port: 5173,
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // Electron runs the built index.html from disk, so assets must be
    // relative. The base: './' above already handles this.
    rollupOptions: {
      output: {
        // Keep chunk names deterministic for easier debugging
        manualChunks: undefined,
      },
    },
  },
});
