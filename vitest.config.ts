import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: [
      { find: '@', replacement: path.resolve(__dirname, './src') },
      // Prevent vitest from trying to resolve MCP SDK (Node.js only)
      // Specific subpaths must come before the generic prefix
      { find: '@modelcontextprotocol/sdk/client/index.js', replacement: path.resolve(__dirname, './src/test/__mocks__/mcp.ts') },
      { find: '@modelcontextprotocol/sdk/client/stdio.js', replacement: path.resolve(__dirname, './src/test/__mocks__/mcp.ts') },
      { find: '@modelcontextprotocol/sdk/client/streamableHttp.js', replacement: path.resolve(__dirname, './src/test/__mocks__/mcp.ts') },
      { find: '@modelcontextprotocol/sdk/client/sse.js', replacement: path.resolve(__dirname, './src/test/__mocks__/mcp.ts') },
      { find: '@modelcontextprotocol/sdk', replacement: path.resolve(__dirname, './src/test/__mocks__/mcp.ts') },
    ],
  },
  test: {
    environment: 'happy-dom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.ts', 'src/__tests__/**/*.ts'],
    coverage: {
      provider: 'v8',
      exclude: [
        'src/components/**',
        'src/test/**',
        'src/main.tsx',
        'src/App.tsx',
        '**/*.d.ts',
      ],
    },
  },
});
