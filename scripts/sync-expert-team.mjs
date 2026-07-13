import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const guiRoot = path.resolve(scriptDir, '..');
const sourceRoot = path.resolve(guiRoot, '../ai-berkshire');
const teamRoot = path.join(guiRoot, 'resources/expert-teams/asset-research-team');
const targetRoot = path.join(teamRoot, 'source/ai-berkshire');

const skillFiles = [
  'bottleneck-hunter.md', 'deep-company-series.md', 'dyp-ask.md',
  'earnings-review.md', 'earnings-team.md', 'financial-data.md',
  'industry-funnel.md', 'industry-research.md', 'investment-checklist.md',
  'investment-research.md', 'investment-team.md', 'management-deep-dive.md',
  'news-pulse.md', 'portfolio-review.md', 'private-company-research.md',
  'quality-screen.md', 'thesis-drift.md', 'thesis-tracker.md', 'wechat-article.md',
];

const relativeFiles = [
  'AGENTS.md',
  'README.md',
  ...skillFiles.map((name) => `skills/${name}`),
  'tools/financial_rigor.py',
  'tools/report_audit.py',
  'tools/xueqiu_scraper.py',
  'assets/team-core.svg',
  'assets/architecture.svg',
];

function sha256(file) {
  return `sha256:${crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')}`;
}

if (!fs.existsSync(sourceRoot)) {
  throw new Error(`ai-berkshire source not found: ${sourceRoot}`);
}

for (const relative of relativeFiles) {
  const source = path.join(sourceRoot, relative);
  const target = path.join(targetRoot, relative);
  if (!fs.existsSync(source)) throw new Error(`missing upstream file: ${relative}`);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
}

let sourceRevision = '';
try {
  const head = fs.readFileSync(path.join(sourceRoot, '.git/HEAD'), 'utf8').trim();
  if (head.startsWith('ref: ')) {
    sourceRevision = fs.readFileSync(path.join(sourceRoot, '.git', head.slice(5)), 'utf8').trim();
  } else {
    sourceRevision = head;
  }
} catch {
  sourceRevision = 'unknown';
}

const files = Object.fromEntries(relativeFiles.map((relative) => [
  relative,
  sha256(path.join(targetRoot, relative)),
]));
const manifest = {
  name: 'ai-berkshire',
  sourcePath: sourceRoot,
  importedAt: new Date().toISOString(),
  sourceRevision,
  files,
};
fs.writeFileSync(
  path.join(teamRoot, 'upstream.json'),
  `${JSON.stringify(manifest, null, 2)}\n`,
  'utf8',
);

console.log(`Synced ${relativeFiles.length} files into ${targetRoot}`);
