import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'
import { version } from './package.json'

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(version),
  },
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  clearScreen: false,
  server: {
    host: false,
    port: 5173,
    strictPort: true,
  },
  envPrefix: ['VITE_'],
  build: {
    target: 'chrome120',
    minify: 'esbuild',
    sourcemap: true,
    rollupOptions: {
      // Only externalize stdio transport (requires Node.js: cross-spawn, node:process, node:stream)
      // Client + HTTP/SSE transports are browser-compatible and should be bundled
      external: [
        '@modelcontextprotocol/sdk/client/stdio.js',
        '@modelcontextprotocol/sdk/client/stdio',
        'cross-spawn',
        'node:process',
        'node:stream',
      ],
    },
  },
})
