import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin, loadEnv } from 'electron-vite'
import react from '@vitejs/plugin-react'

const BUILTIN_MCP_BUILD_CONSTANTS = {
  __TPACOWORK_BUILTIN_JUYUAN_MCP_TOKEN__: 'JUYUAN_MCP_TOKEN',
  __TPACOWORK_BUILTIN_CAIHUI_MCP_API_KEY__: 'CAIHUI_MCP_API_KEY',
  __TPACOWORK_BUILTIN_IFIND_MCP_API_KEY__: 'IFIND_MCP_API_KEY',
  __TPACOWORK_BUILTIN_ANYSEARCH_API_KEY__: 'ANYSEARCH_API_KEY',
} as const

export default defineConfig(({ mode }) => {
  const fileEnv = loadEnv(mode, process.cwd(), '')
  const mainCredentialDefines = Object.fromEntries(
    Object.entries(BUILTIN_MCP_BUILD_CONSTANTS).map(([constant, envName]) => [
      constant,
      JSON.stringify(process.env[envName]?.trim() || fileEnv[envName]?.trim() || ''),
    ]),
  )

  return {
    main: {
      define: mainCredentialDefines,
      plugins: [externalizeDepsPlugin()],
      build: {
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
          ignored: ['**/embedded-python/**']
        }
      },
      build: {
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
        __APP_VERSION__: JSON.stringify(process.env.npm_package_version || '0.0.0')
      }
    },
  }
})
