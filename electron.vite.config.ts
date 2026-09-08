import { resolve } from 'path'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { defineConfig, externalizeDepsPlugin, loadEnv } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { version } from './package.json'

const BUILTIN_MCP_BUILD_CONSTANTS = {
  __TPCOWORK_BUILTIN_JUYUAN_MCP_TOKEN__: 'JUYUAN_MCP_TOKEN',
  __TPCOWORK_BUILTIN_CAIHUI_MCP_API_KEY__: 'CAIHUI_MCP_API_KEY',
  __TPCOWORK_BUILTIN_IFIND_MCP_API_KEY__: 'IFIND_MCP_API_KEY',
  __TPCOWORK_BUILTIN_ANYSEARCH_API_KEY__: 'ANYSEARCH_API_KEY',
} as const

export default defineConfig(({ mode }) => {
  let revision = 'unknown';
  let dirty = true;
  try {
    revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: __dirname, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    dirty = Boolean(execFileSync('git', ['status', '--porcelain'], { cwd: __dirname, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim());
  } catch { /* Builds from a source archive have no Git metadata. */ }
  const buildIdentity = JSON.stringify({ id: randomUUID(), revision, dirty, created_at: new Date().toISOString() });
  const fileEnv = loadEnv(mode, process.cwd(), '')
  const mainCredentialDefines = Object.fromEntries(
    Object.entries(BUILTIN_MCP_BUILD_CONSTANTS).map(([constant, envName]) => [
      constant,
      JSON.stringify(process.env[envName]?.trim() || fileEnv[envName]?.trim() || ''),
    ]),
  )

  return {
    main: {
      define: { ...mainCredentialDefines, __TPCOWORK_BUILD__: buildIdentity },
      plugins: [externalizeDepsPlugin()],
      build: {
        sourcemap: 'hidden',
        lib: {
          entry: resolve(__dirname, 'electron/main.ts'),
          formats: ['cjs']
        },
        rollupOptions: {
          external: ['electron'],
          output: {
            entryFileNames: 'index.cjs'
          },
          input: {
            index: resolve(__dirname, 'electron/main.ts')
          }
        },
      }
    },
    preload: {
      plugins: [externalizeDepsPlugin()],
      build: {
        sourcemap: 'hidden',
        rollupOptions: {
          input: {
            index: resolve(__dirname, 'electron/preload.ts')
          }
        }
      }
    },
    renderer: {
      root: '.',
      server: {
        port: 5173,
        strictPort: true,
        watch: {
          ignored: ['**/embedded-python/**', '**/dist/**']
        }
      },
      build: {
        sourcemap: 'hidden',
        rollupOptions: {
          input: {
            index: resolve(__dirname, 'index.html')
          }
        }
      },
      resolve: {
        alias: {
          '@renderer': resolve(__dirname, 'src'),
          '@': resolve(__dirname, 'src')
        },
        // Locally-linked packages (e.g. thinking-orbs) must share the GUI's React.
        dedupe: ['react', 'react-dom']
      },
      plugins: [react()],
      define: {
        __APP_VERSION__: JSON.stringify(version)
      }
    },
  }
})
