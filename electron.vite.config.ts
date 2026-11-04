import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
export default defineConfig({
  main: { plugins: [externalizeDepsPlugin()], build: { outDir: 'dist/main' } },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'dist/preload',
      rollupOptions: { output: { format: 'cjs', entryFileNames: 'index.cjs' } },
    },
  },
  renderer: {
    plugins: [
      react(),
      tailwindcss(),
      {
        name: 'development-csp',
        transformIndexHtml(html, context) {
          if (!context.server) return html
          return html
            .replace("script-src 'self';", "script-src 'self' 'unsafe-inline';")
            .replace("connect-src 'self';", "connect-src 'self' ws://localhost:* ws://127.0.0.1:*;")
        },
      },
    ],
    build: { outDir: 'dist/renderer' },
  },
})
