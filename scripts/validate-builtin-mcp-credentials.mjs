import process from 'node:process';

import { loadEnv } from 'vite';

const required = [
  'JUYUAN_MCP_TOKEN',
  'CAIHUI_MCP_API_KEY',
  'IFIND_MCP_API_KEY',
  'ANYSEARCH_API_KEY',
  'TPCOWORK_IMAGE_EXTRACT_API_KEY',
];
const fileEnv = loadEnv('production', process.cwd(), '');
const missing = required.filter((name) => !(
  process.env[name]?.trim() || fileEnv[name]?.trim()
));

if (missing.length > 0) {
  console.error(
    `[builtin-services] Packaging stopped: missing ${missing.join(', ')}.\n`
      + 'Set them in the build environment or .env.production.local '
      + '(see .env.production.example).',
  );
  process.exit(1);
}

console.log('[builtin-services] Shared connector and image extraction credentials are configured.');
