import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'
import { viteStaticCopy } from 'vite-plugin-static-copy'

export default defineConfig({
  plugins: [
    react(),
    // Copy extension manifest and icons to dist/extension/
    viteStaticCopy({
      targets: [
        {
          src: 'extension/manifest.json',
          dest: '.',
        },
        {
          src: 'extension/icons/*',
          dest: 'icons',
        },
        // Also copy public icons if extension uses them
        {
          src: 'public/icons/*',
          dest: 'icons',
        },
      ],
    }),
  ],
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'shared'),
      '@': resolve(__dirname, 'src'),
    },
  },
  build: {
    outDir: 'dist/extension',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        popup:      resolve(__dirname, 'extension/popup/popup.html'),
        background: resolve(__dirname, 'extension/background/service-worker.ts'),
        content:    resolve(__dirname, 'extension/content/content.ts'),
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: '[name].js',
        assetFileNames: '[name].[ext]',
      },
    },
  },
})
