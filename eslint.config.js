import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  // Generated application bundles and the standalone Python distribution are
  // third-party/build output, not application source. Linting them makes the
  // result depend on a previous build and hides actionable failures.
  globalIgnores([
    'dist/**',
    'out/**',
    'embedded-python/**',
    'node_modules/**',
    'coverage/**',
    'src-tauri/**',
  ]),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        destructuredArrayIgnorePattern: '^_',
      }],
      // IPC and gateway payloads are progressively typed. Keep these visible
      // without allowing historical boundary types to disable the gate.
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/ban-ts-comment': 'warn',
      '@typescript-eslint/no-unused-expressions': 'warn',
      'no-control-regex': 'warn',
      'no-empty': 'warn',
      'react-refresh/only-export-components': 'warn',
      // These rules from React hooks recommended are too strict for legitimate patterns
      // like form initialization, syncing derived state, and dynamic icon components
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/purity': 'off',
      'react-hooks/static-components': 'off',
    },
  },
])
