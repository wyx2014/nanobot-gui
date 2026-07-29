import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEV_BUNDLE_ID = 'com.tparuyi.app.dev';
const DEV_APP_NAME = '太资如意 Dev';
const MICROPHONE_USAGE =
  '太资如意需要使用麦克风，将录音通过默认语音识别模型转换为输入文字。';

if (process.platform !== 'darwin') {
  console.log('[prepare-electron-dev] Non-macOS platform, skipping app identity setup.');
  process.exit(0);
}

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const electronApp = join(
  projectRoot,
  'node_modules',
  'electron',
  'dist',
  'Electron.app',
);
const infoPlist = join(electronApp, 'Contents', 'Info.plist');
const launchServicesRegister = join(
  '/System',
  'Library',
  'Frameworks',
  'CoreServices.framework',
  'Frameworks',
  'LaunchServices.framework',
  'Support',
  'lsregister',
);

if (!existsSync(infoPlist)) {
  throw new Error(
    `Electron.app is missing at ${electronApp}. Run npm install before npm run electron:dev.`,
  );
}

function readPlistString(key) {
  const result = spawnSync(
    'plutil',
    ['-extract', key, 'raw', infoPlist],
    { encoding: 'utf8' },
  );
  return result.status === 0 ? result.stdout.trim() : null;
}

function writePlistString(key, value) {
  const current = readPlistString(key);
  if (current === value) return false;
  execFileSync(
    'plutil',
    [current === null ? '-insert' : '-replace', key, '-string', value, infoPlist],
    { stdio: 'inherit' },
  );
  return true;
}

let changed = false;
changed = writePlistString('CFBundleIdentifier', DEV_BUNDLE_ID) || changed;
changed = writePlistString('CFBundleDisplayName', DEV_APP_NAME) || changed;
changed = writePlistString('CFBundleName', DEV_APP_NAME) || changed;
changed = writePlistString('NSMicrophoneUsageDescription', MICROPHONE_USAGE) || changed;

const signature = spawnSync(
  'codesign',
  ['--verify', '--deep', '--strict', electronApp],
  { encoding: 'utf8' },
);
if (changed || signature.status !== 0) {
  console.log('[prepare-electron-dev] Applying an ad-hoc signature to Electron.app...');
  execFileSync(
    'codesign',
    ['--force', '--deep', '--sign', '-', electronApp],
    { stdio: 'inherit' },
  );
}

// TCC refuses to create a permission record for a development bundle that
// LaunchServices cannot resolve, returning `denied` before showing a prompt.
// node_modules apps aren't registered automatically, so register this bundle
// on every dev launch (the operation is idempotent).
execFileSync(launchServicesRegister, ['-f', electronApp], { stdio: 'inherit' });

console.log(
  `[prepare-electron-dev] Ready: ${DEV_APP_NAME} (${DEV_BUNDLE_ID}).`,
);
