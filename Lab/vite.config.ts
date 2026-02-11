/// <reference types="vitest" />

import legacy from '@vitejs/plugin-legacy'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    legacy({ renderLegacyChunks: false }), // désactivé pour n'avoir qu'un seul JS ; remettre true pour support navigateurs anciens
  ],
  build: {
    rollupOptions: {
      output: {
        manualChunks: () => 'index',
      },
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/setupTests.ts',
  }
})
