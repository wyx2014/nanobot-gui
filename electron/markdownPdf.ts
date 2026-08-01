import { BrowserWindow, app } from 'electron';
import fs from 'fs';
import path from 'path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ReactMarkdown from 'react-markdown';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';

export type MermaidImage = { png: string; width: number; height: number };
export type MermaidImageRenderer = (code: string) => Promise<MermaidImage>;

const remarkPlugins = [remarkGfm, remarkBreaks];
const MAX_EMBEDDED_LOCAL_IMAGE_BYTES = 8 * 1024 * 1024;
const LOCAL_IMAGE_MIME_TYPES: Record<string, string> = {
  '.gif': 'image/gif',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
};

function readNewsreaderFont(): string | null {
  const relative = path.join(
    'node_modules',
    '@fontsource-variable',
    'newsreader',
    'files',
    'newsreader-latin-wght-normal.woff2',
  );
  const candidates = [
    path.join(process.cwd(), relative),
    path.join(app.getAppPath(), relative),
  ];
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) {
        return fs.readFileSync(candidate).toString('base64');
      }
    } catch {
      // Fall through to the system font stack.
    }
  }
  return null;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function hasLeadingTitle(markdown: string): boolean {
  return /^\s*#\s+\S/m.test(markdown);
}

function researchOutline(markdown: string): Array<{ level: number; title: string }> {
  const outline: Array<{ level: number; title: string }> = [];
  const pattern = /^(#{2,3})\s+(.+?)\s*$/gm;
  for (const match of markdown.matchAll(pattern)) {
    const title = match[2].replace(/[`*_]/g, '').trim();
    if (title) outline.push({ level: match[1].length, title });
  }
  return outline.slice(0, 36);
}

function researchPrintPreamble(markdown: string, title: string): string {
  const meta = reportMeta(markdown);
  const outline = researchOutline(markdown);
  const outlineRows = outline.length
    ? outline.map((item) => `<li class="toc-level-${item.level}">${escapeHtml(item.title)}</li>`).join('')
    : '<li class="toc-empty">正文未包含可列入目录的二、三级标题。</li>';
  return `<section class="research-cover">
  <div class="research-cover-kicker">TPACOWORK · EXPERT RESEARCH</div>
  <h1>${escapeHtml(title)}</h1>
  <p>多角色研究、交叉质证与数据审计</p>
  <div class="research-cover-meta">${meta.date ? `数据截止：${escapeHtml(meta.date)}` : '以报告正文披露的数据截止日期为准'}</div>
</section>
<section class="research-print-toc">
  <div class="research-toc-kicker">TABLE OF CONTENTS</div>
  <h2>报告目录</h2>
  <ol>${outlineRows}</ol>
</section>`;
}

function localMarkdownImageDataUrl(sourcePath: string | undefined, rawSource: string | undefined): string | null {
  if (!sourcePath || !rawSource || rawSource.length > 2_048) return null;
  if (/^(?:[a-z][a-z\d+.-]*:|\/)/i.test(rawSource)) return null;

  try {
    const sourceDirectory = path.dirname(sourcePath);
    const rawPath = decodeURIComponent(rawSource.split(/[?#]/, 1)[0]);
    const imagePath = path.resolve(sourceDirectory, rawPath);
    const relative = path.relative(sourceDirectory, imagePath);
    if (relative.startsWith('..') || path.isAbsolute(relative)) return null;

    const mimeType = LOCAL_IMAGE_MIME_TYPES[path.extname(imagePath).toLowerCase()];
    if (!mimeType) return null;
    const image = fs.readFileSync(imagePath);
    if (image.length === 0 || image.length > MAX_EMBEDDED_LOCAL_IMAGE_BYTES) return null;
    return `data:${mimeType};base64,${image.toString('base64')}`;
  } catch {
    return null;
  }
}

function markdownBody(markdown: string, sourcePath?: string): string {
  return renderToStaticMarkup(React.createElement(ReactMarkdown, {
    remarkPlugins,
    components: {
      // Embed only raster images relative to the report source. Remote, data-URL,
      // absolute, and parent-directory references deliberately remain blocked.
      img: ({ src, alt }) => {
        const dataUrl = localMarkdownImageDataUrl(sourcePath, src);
        if (!dataUrl) return null;
        return React.createElement(
          'span',
          { className: 'report-image' },
          React.createElement('img', { src: dataUrl, alt: alt || '' }),
          alt ? React.createElement('span', { className: 'report-image-caption' }, alt) : null,
        );
      },
    },
    children: markdown,
  }));
}

export function renderMarkdownDocument(
  markdown: string,
  title: string,
  mermaidFigures: Map<string, MermaidImage> = new Map(),
  sourcePath?: string,
  template = 'simple',
): string {
  const font = readNewsreaderFont();
  const fontFace = font
    ? `@font-face { font-family: "Newsreader PDF"; src: url(data:font/woff2;base64,${font}) format("woff2"); font-style: normal; font-weight: 200 800; font-display: block; }`
    : '';
  let body = markdownBody(markdown, sourcePath);
  for (const [token, image] of mermaidFigures) {
    const figure = `<figure class="mermaid"><img src="data:image/png;base64,${image.png}" width="${image.width}" height="${image.height}" alt="Mermaid diagram"></figure>`;
    body = body.replace(`<p>${token}</p>`, figure);
  }
  if (template === 'research_report') {
    body = body.replace(/^\s*<h1>[^]*?<\/h1>\s*/i, '');
  }
  const visibleTitle = hasLeadingTitle(markdown)
    ? ''
    : `<h1 class="document-title">${escapeHtml(title)}</h1>`;

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
${fontFace}
@page { size: A4; margin: 17mm 18mm 20mm; }
* { box-sizing: border-box; }
html { background: #ffffff; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body {
  margin: 0;
  color: #191814;
  background: #ffffff;
  font-family: "Newsreader PDF", "Newsreader Variable", "Newsreader", "PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", "Hiragino Sans GB", sans-serif;
  font-size: 11.5pt;
  line-height: 1.72;
  letter-spacing: 0;
  overflow-wrap: break-word;
}
h1, h2, h3, h4, h5, h6 {
  color: #191814;
  font-family: inherit;
  font-weight: 650;
  line-height: 1.25;
  break-after: avoid-page;
  page-break-after: avoid;
  orphans: 3;
}
h1 { margin: 0 0 8mm; font-size: 23pt; letter-spacing: -0.02em; }
h1:not(:first-child) { margin-top: 9mm; }
h2 { margin: 8mm 0 3.5mm; font-size: 17.5pt; letter-spacing: -0.015em; }
h3 { margin: 6mm 0 2.5mm; font-size: 14.5pt; }
h4 { margin: 5mm 0 2mm; font-size: 12.5pt; }
p { margin: 0 0 3.5mm; orphans: 3; widows: 3; }
strong { color: #191814; font-weight: 680; }
em { color: #565247; }
hr { margin: 7mm 0; border: 0; border-top: 0.35mm solid #dedbd3; }
ul, ol { margin: 2.5mm 0 4mm; padding-left: 7mm; }
li { margin: 0 0 1.6mm; padding-left: 1mm; break-inside: avoid-page; }
li > p { margin-bottom: 1.2mm; }
blockquote {
  margin: 4mm 0 5mm;
  padding: 2.5mm 4mm;
  border-left: 1.1mm solid #d97757;
  background: #fbf8f1;
  color: #3d3929;
  break-inside: avoid-page;
}
blockquote > :last-child { margin-bottom: 0; }
table {
  width: 100%;
  margin: 3.5mm 0 6mm;
  border-collapse: separate;
  border-spacing: 0;
  overflow: hidden;
  border: 0.3mm solid #dedbd3;
  border-radius: 2mm;
  font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif;
  font-size: 9.3pt;
  line-height: 1.5;
  break-inside: avoid-page;
  page-break-inside: avoid;
}
thead { display: table-header-group; }
tr { break-inside: avoid-page; page-break-inside: avoid; }
th, td { padding: 2.3mm 2.6mm; text-align: left; vertical-align: top; border-right: 0.25mm solid #eeeae1; border-bottom: 0.25mm solid #eeeae1; }
th:last-child, td:last-child { border-right: 0; }
tr:last-child td { border-bottom: 0; }
th { background: #f4f1e8; color: #29261b; font-weight: 650; }
tbody tr:nth-child(even) td { background: #fffdf8; }
code {
  padding: 0.25mm 1mm;
  border-radius: 1mm;
  background: #f0eee8;
  color: #a65439;
  font-family: ui-monospace, "SF Mono", "Cascadia Code", "Roboto Mono", Menlo, monospace;
  font-size: 0.88em;
}
pre {
  margin: 4mm 0 5mm;
  padding: 4mm;
  border-radius: 2mm;
  background: #24231f;
  color: #f7f4ed;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  break-inside: avoid-page;
}
pre code { padding: 0; background: transparent; color: inherit; font-size: 9pt; line-height: 1.55; }
a { color: #b85f3f; text-decoration: none; overflow-wrap: anywhere; }
figure.mermaid { margin: 5mm auto 7mm; text-align: center; break-inside: avoid-page; }
figure.mermaid img { display: inline-block; width: auto; max-width: 100%; height: auto; max-height: 160mm; }
.report-image { display: block; margin: 5mm auto 7mm; text-align: center; break-inside: avoid-page; page-break-inside: avoid; }
.report-image img { display: inline-block; max-width: 100%; max-height: 160mm; height: auto; }
.report-image-caption { display: block; margin-top: 1.5mm; color: #666157; font-size: 9pt; text-align: center; }
.document-title { margin-bottom: 9mm; }
.research-cover { display: flex; min-height: 228mm; flex-direction: column; justify-content: center; padding: 26mm 24mm; color: #fff; background: radial-gradient(circle at 86% 15%, rgba(96,139,255,.72), transparent 29%), linear-gradient(135deg, #0b1731 0%, #173d95 56%, #4f76e2 100%); break-after: page; page-break-after: always; }
.research-cover-kicker, .research-toc-kicker { margin-bottom: 9mm; font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", sans-serif; font-size: 10pt; font-weight: 700; letter-spacing: .16em; }
.research-cover h1 { max-width: 142mm; margin: 0; color: #fff; font-size: 30pt; letter-spacing: -.025em; }
.research-cover p { margin: 7mm 0 15mm; color: rgba(255,255,255,.82); font-size: 14pt; }
.research-cover-meta { display: inline-block; width: fit-content; padding: 3mm 4mm; border: .25mm solid rgba(255,255,255,.3); border-radius: 5mm; color: rgba(255,255,255,.9); font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", sans-serif; font-size: 9.5pt; }
.research-print-toc { min-height: 220mm; padding: 8mm 4mm 16mm; break-after: page; page-break-after: always; }
.research-toc-kicker { margin-bottom: 4mm; color: #3156d3; }
.research-print-toc h2 { margin: 0 0 9mm; font-size: 22pt; }
.research-print-toc ol { margin: 0; padding: 0; list-style: none; }
.research-print-toc li { margin: 0; padding: 2.2mm 0; border-bottom: .25mm solid #e5e8ef; color: #343b4c; font-size: 11pt; }
.research-print-toc .toc-level-3 { padding-left: 7mm; color: #687083; font-size: 10pt; }
.research-print-toc .toc-empty { color: #687083; }
</style>
</head>
<body>${template === 'research_report' ? researchPrintPreamble(markdown, title) : ''}${visibleTitle}${body}</body>
</html>`;
}

function reportMeta(markdown: string): { date: string; richness: string } {
  const date = markdown.match(/(?:数据截止|报告日期|更新日期)\s*[：:]\s*(?:\*\*)?([^|\n*]+)/i)?.[1]?.trim() || '';
  const richness = markdown.match(/(?:信息丰富度评级|信息丰富度)\s*[：:]\s*(?:\*\*)?([^|\n*]+)/i)?.[1]?.trim() || '';
  return { date, richness };
}

function renderRichMarkdownHtml(
  markdown: string,
  title: string,
  mermaidFigures: Map<string, MermaidImage>,
  sourcePath?: string,
): string {
  let body = markdownBody(markdown, sourcePath);
  for (const [token, image] of mermaidFigures) {
    const figure = `<figure class="mermaid"><img src="data:image/png;base64,${image.png}" width="${image.width}" height="${image.height}" alt="研究关系图"></figure>`;
    body = body.replace(`<p>${token}</p>`, figure);
  }
  // The web report owns a dedicated hero, so avoid rendering the Markdown H1 twice.
  body = body.replace(/^\s*<h1>[^]*?<\/h1>\s*/i, '');
  const meta = reportMeta(markdown);
  const metaItems = [
    meta.date ? `<span>数据截止 · ${escapeHtml(meta.date)}</span>` : '',
    meta.richness ? `<span>信息评级 · ${escapeHtml(meta.richness)}</span>` : '',
    '<span>AI 多角色交叉研究</span>',
  ].filter(Boolean).join('');

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
:root {
  color-scheme: light;
  --page: #eef1f5;
  --paper: #ffffff;
  --ink: #172033;
  --muted: #687083;
  --line: #e5e9f0;
  --brand: #3156d3;
  --brand-2: #163b8f;
  --brand-soft: #edf2ff;
  --positive: #058c78;
  --positive-soft: #e8f8f4;
  --negative: #d85750;
  --negative-soft: #fff0ee;
  --warning: #c17a16;
  --warning-soft: #fff6e4;
  --purple: #7650be;
  --shadow: 0 12px 32px rgba(31, 43, 71, .08);
}
* { box-sizing: border-box; }
html { scroll-behavior: smooth; background: var(--page); }
body { margin: 0; color: var(--ink); background: var(--page); font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif; font-size: 15px; line-height: 1.72; overflow-wrap: anywhere; }
.report-hero { position: relative; overflow: hidden; padding: 58px 24px 52px; color: #fff; background: radial-gradient(circle at 82% 5%, rgba(90,139,255,.55), transparent 32%), linear-gradient(135deg, #101b38 0%, var(--brand-2) 52%, #4269dd 100%); }
.report-hero::after { content: ""; position: absolute; width: 380px; height: 380px; right: -120px; bottom: -270px; border: 1px solid rgba(255,255,255,.25); border-radius: 50%; box-shadow: 0 0 0 48px rgba(255,255,255,.035), 0 0 0 96px rgba(255,255,255,.025); }
.hero-inner { position: relative; z-index: 1; max-width: 1120px; margin: 0 auto; }
.eyebrow { margin-bottom: 13px; font-size: 12px; font-weight: 750; letter-spacing: .16em; opacity: .72; }
.report-hero h1 { max-width: 900px; margin: 0; font-size: clamp(30px, 4.2vw, 48px); line-height: 1.16; letter-spacing: -.035em; }
.hero-subtitle { margin: 14px 0 20px; color: #fff; font-size: 16px; font-weight: 600; letter-spacing: .01em; opacity: 1; text-shadow: 0 1px 2px rgba(0,0,0,.28); }
.hero-meta { display: flex; flex-wrap: wrap; gap: 9px; }
.hero-meta span { padding: 6px 11px; border: 1px solid rgba(255,255,255,.2); border-radius: 999px; background: rgba(255,255,255,.1); font-size: 12px; backdrop-filter: blur(6px); }
.report-shell { max-width: 1120px; margin: 0 auto; padding: 24px 20px 72px; }
.report-toc { position: sticky; top: 10px; z-index: 8; display: flex; align-items: center; gap: 12px; margin: 0 0 22px; padding: 13px 16px; border: 1px solid rgba(226,230,239,.9); border-radius: 13px; background: rgba(255,255,255,.92); box-shadow: 0 5px 18px rgba(31,43,71,.06); backdrop-filter: blur(14px); }
.toc-label { flex: 0 0 auto; color: var(--muted); font-size: 12px; font-weight: 700; }
.toc-links { display: flex; gap: 7px; overflow-x: auto; scrollbar-width: none; }
.toc-links::-webkit-scrollbar { display: none; }
.toc-links a { flex: 0 0 auto; padding: 5px 10px; border-radius: 7px; color: #4b556a; background: #f4f6f9; font-size: 12px; text-decoration: none; }
.toc-links a:hover { color: var(--brand); background: var(--brand-soft); }
.dashboard-grid { display: grid; grid-template-columns: repeat(4, minmax(0,1fr)); gap: 12px; margin-bottom: 18px; }
.metric-card { min-height: 116px; padding: 18px; border: 1px solid var(--line); border-radius: 14px; background: var(--paper); box-shadow: 0 4px 14px rgba(31,43,71,.045); }
.metric-label { color: var(--muted); font-size: 12px; }
.metric-value { margin-top: 9px; color: var(--brand-2); font-size: 25px; font-weight: 760; line-height: 1.15; letter-spacing: -.025em; }
.metric-value.negative { color: var(--negative); }
.metric-value.positive { color: var(--positive); }
.visual-card { margin: 0 0 18px; padding: 22px; border: 1px solid var(--line); border-radius: 15px; background: var(--paper); box-shadow: 0 5px 18px rgba(31,43,71,.05); }
.visual-card h3 { margin: 0 0 15px; font-size: 17px; }
.score-row { display: grid; grid-template-columns: minmax(130px, 1.4fr) 4fr 42px; gap: 12px; align-items: center; margin: 10px 0; }
.score-name { color: #465067; font-size: 13px; }
.score-track { height: 10px; overflow: hidden; border-radius: 999px; background: #edf0f5; }
.score-fill { height: 100%; border-radius: inherit; background: linear-gradient(90deg, #6385ed, var(--brand)); }
.score-value { color: var(--brand-2); font-size: 13px; font-weight: 750; text-align: right; }
.comparison-group { margin-top: 17px; padding-top: 16px; border-top: 1px solid var(--line); }
.comparison-group:first-of-type { margin-top: 0; padding-top: 0; border-top: 0; }
.comparison-title { margin-bottom: 9px; color: #3d4860; font-size: 13px; font-weight: 720; }
.comparison-item { display: grid; grid-template-columns: minmax(85px,1fr) 3fr minmax(58px,.8fr); gap: 10px; align-items: center; margin: 7px 0; }
.comparison-name { overflow: hidden; color: var(--muted); font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
.comparison-track { height: 9px; overflow: hidden; border-radius: 999px; background: #edf0f5; }
.comparison-fill { display: block; height: 100%; min-width: 4px; border-radius: inherit; background: var(--brand); }
.comparison-item:nth-child(3) .comparison-fill { background: var(--positive); }
.comparison-item:nth-child(4) .comparison-fill { background: var(--purple); }
.comparison-item:nth-child(5) .comparison-fill { background: var(--warning); }
.comparison-value { color: #35415a; font-size: 12px; font-weight: 700; text-align: right; }
.report-section { margin: 0 0 18px; padding: 26px 28px 29px; border: 1px solid var(--line); border-radius: 16px; background: var(--paper); box-shadow: var(--shadow); }
.report-section > h2 { display: flex; align-items: center; gap: 11px; margin: 0 0 20px; padding-bottom: 14px; border-bottom: 1px solid var(--line); font-size: 23px; line-height: 1.25; letter-spacing: -.018em; }
.section-index { display: inline-flex; flex: 0 0 auto; align-items: center; justify-content: center; width: 29px; height: 29px; border-radius: 9px; color: #fff; background: var(--brand); font-size: 13px; }
.report-section h3 { margin: 27px 0 11px; font-size: 18px; }
.report-section h4 { margin: 22px 0 9px; font-size: 16px; }
p { margin: 0 0 13px; color: #40495c; }
strong { color: #182238; font-weight: 720; }
em { color: var(--muted); }
ul, ol { margin: 9px 0 16px; padding-left: 23px; }
li { margin: 5px 0; }
a { color: var(--brand); text-decoration: none; }
a:hover { text-decoration: underline; }
blockquote { margin: 18px 0; padding: 16px 19px; border: 0; border-left: 4px solid var(--brand); border-radius: 0 10px 10px 0; color: #293856; background: var(--brand-soft); }
blockquote > :last-child { margin-bottom: 0; }
hr { margin: 28px 0; border: 0; border-top: 1px solid var(--line); }
.table-wrap { width: 100%; margin: 17px 0 24px; overflow-x: auto; border: 1px solid var(--line); border-radius: 12px; }
table { width: 100%; border-collapse: collapse; min-width: 650px; font-size: 13px; line-height: 1.5; }
th, td { padding: 11px 12px; border-right: 1px solid #edf0f4; border-bottom: 1px solid #edf0f4; text-align: left; vertical-align: top; }
th:last-child, td:last-child { border-right: 0; }
tr:last-child td { border-bottom: 0; }
th { color: #26334d; background: #f4f6fa; font-weight: 700; white-space: nowrap; }
tbody tr:nth-child(even) td { background: #fbfcfe; }
tbody tr:hover td { background: #f6f8fc; }
tr.risk-high td { background: var(--negative-soft) !important; }
tr.risk-medium td { background: var(--warning-soft) !important; }
tr.risk-low td { background: var(--positive-soft) !important; }
code { padding: 2px 5px; border-radius: 5px; color: #a34d35; background: #f3f0eb; font-family: ui-monospace, "SF Mono", Menlo, monospace; }
pre { margin: 17px 0 22px; padding: 18px 20px; overflow-x: auto; border-radius: 12px; color: #f5f7fb; background: #1d2535; white-space: pre-wrap; }
pre code { padding: 0; color: inherit; background: transparent; }
figure.mermaid, .trend-figure { margin: 20px 0 25px; padding: 18px; border: 1px solid var(--line); border-radius: 13px; background: #fbfcff; text-align: center; }
figure.mermaid img { width: auto; max-width: 100%; height: auto; max-height: 600px; }
.report-image { display: block; margin: 20px 0 25px; padding: 18px; border: 1px solid var(--line); border-radius: 13px; background: #fbfcff; text-align: center; }
.report-image img { display: inline-block; max-width: 100%; height: auto; max-height: 600px; }
.report-image-caption { display: block; margin-top: 10px; color: var(--muted); font-size: 12px; }
.trend-caption { margin-bottom: 8px; color: #37435a; font-size: 13px; font-weight: 700; text-align: left; }
.trend-figure svg { display: block; width: 100%; height: auto; }
.positive-heading { color: var(--positive); }
.negative-heading { color: var(--negative); }
.report-footer { margin-top: 24px; padding: 22px; border: 1px solid #efdfae; border-radius: 13px; color: #79632e; background: #fffaea; font-size: 12px; text-align: center; }
@media (max-width: 850px) { .dashboard-grid { grid-template-columns: repeat(2,minmax(0,1fr)); } .report-section { padding: 22px 20px 25px; } }
@media (max-width: 560px) { .report-hero { padding: 42px 20px 38px; } .report-shell { padding: 16px 12px 50px; } .report-toc { top: 6px; } .dashboard-grid { grid-template-columns: 1fr 1fr; gap: 8px; } .metric-card { min-height: 98px; padding: 14px; } .metric-value { font-size: 20px; } .score-row { grid-template-columns: 1fr 2fr 36px; gap: 7px; } .report-section > h2 { font-size: 20px; } }
@media print { html, body { background: #fff; } .report-toc { position: static; } .report-section, .metric-card, .visual-card { box-shadow: none; break-inside: avoid; } }
</style>
</head>
<body>
<header class="report-hero">
  <div class="hero-inner">
    <div class="eyebrow">TPACOWORK · EXPERT RESEARCH</div>
    <h1>${escapeHtml(title)}</h1>
    <p class="hero-subtitle">专家团队 · 多角色研究、交叉质证与数据审计</p>
    <div class="hero-meta">${metaItems}</div>
  </div>
</header>
<main class="report-shell">
  <nav class="report-toc" aria-label="报告目录"><span class="toc-label">报告目录</span><div class="toc-links"></div></nav>
  <div id="dashboard"></div>
  <article id="report-content">${body}</article>
  <footer class="report-footer">本报告由TPACowork专家团队基于可用资料生成，仅作研究辅助，不构成投资建议。</footer>
</main>
<script>
(function () {
  var content = document.getElementById('report-content');
  var dashboard = document.getElementById('dashboard');
  if (!content || !dashboard) return;

  function clean(value) { return (value || '').replace(/\\s+/g, ' ').trim(); }
  function slug(value, index) {
    var base = clean(value).toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-').replace(/^-|-$/g, '');
    return base || 'section-' + index;
  }
  function numberFrom(value) {
    var match = clean(value).replace(/,/g, '').match(/-?\\d+(?:\\.\\d+)?/);
    return match ? Number(match[0]) : NaN;
  }

  var original = Array.prototype.slice.call(content.children);
  var fragment = document.createDocumentFragment();
  var current = null;
  var sectionCount = 0;
  original.forEach(function (node) {
    if (node.tagName === 'H2') {
      sectionCount += 1;
      current = document.createElement('section');
      current.className = 'report-section';
      var headingText = clean(node.textContent);
      node.id = slug(headingText, sectionCount);
      var indexBadge = document.createElement('span');
      indexBadge.className = 'section-index';
      indexBadge.textContent = String(sectionCount);
      node.insertBefore(indexBadge, node.firstChild);
      current.appendChild(node);
      fragment.appendChild(current);
    } else {
      if (!current) {
        current = document.createElement('section');
        current.className = 'report-section report-preamble';
        fragment.appendChild(current);
      }
      current.appendChild(node);
    }
  });
  content.textContent = '';
  content.appendChild(fragment);

  var toc = document.querySelector('.toc-links');
  content.querySelectorAll('h2').forEach(function (heading) {
    var link = document.createElement('a');
    link.href = '#' + heading.id;
    link.textContent = clean(heading.textContent).replace(/^\\d+/, '').trim();
    toc.appendChild(link);
  });

  var tables = Array.prototype.slice.call(content.querySelectorAll('table'));
  var metricPattern = /市值|营收|收入|净利润|自由现金流|现金流|净现金|股息率|ROE|PE(?:_|\\b)|PB(?:_|\\b)/i;
  var seenMetrics = {};
  var metrics = [];
  tables.forEach(function (table) {
    Array.prototype.slice.call(table.querySelectorAll('tbody tr')).forEach(function (row) {
      var cells = row.querySelectorAll('td');
      if (cells.length < 2) return;
      var label = clean(cells[0].textContent);
      var value = clean(cells[1].textContent);
      if (!metricPattern.test(label) || seenMetrics[label] || !value || value.length > 28) return;
      seenMetrics[label] = true;
      metrics.push({ label: label, value: value });
    });
  });
  if (metrics.length) {
    var metricGrid = document.createElement('section');
    metricGrid.className = 'dashboard-grid';
    metrics.slice(0, 8).forEach(function (item) {
      var card = document.createElement('div');
      card.className = 'metric-card';
      var label = document.createElement('div');
      label.className = 'metric-label';
      label.textContent = item.label;
      var value = document.createElement('div');
      value.className = 'metric-value';
      if (/^-|下降|减少/.test(item.value)) value.classList.add('negative');
      if (/^\\+|增长|提升/.test(item.value)) value.classList.add('positive');
      value.textContent = item.value;
      card.appendChild(label);
      card.appendChild(value);
      metricGrid.appendChild(card);
    });
    dashboard.appendChild(metricGrid);
  }

  var scoreTable = tables.find(function (table) {
    return /评分|得分|星/.test(clean(table.querySelector('thead') && table.querySelector('thead').textContent));
  });
  if (scoreTable) {
    var headers = Array.prototype.slice.call(scoreTable.querySelectorAll('thead th')).map(function (cell) { return clean(cell.textContent); });
    var scoreIndex = headers.findIndex(function (header) { return /评分|得分|星/.test(header); });
    if (scoreIndex < 0) scoreIndex = 1;
    var scores = [];
    scoreTable.querySelectorAll('tbody tr').forEach(function (row) {
      var cells = row.querySelectorAll('td');
      if (cells.length <= scoreIndex) return;
      var score = numberFrom(cells[scoreIndex].textContent);
      if (!Number.isFinite(score) || score < 0 || score > 10) return;
      scores.push({ name: clean(cells[0].textContent), score: score });
    });
    if (scores.length >= 2) {
      var scoreScale = scores.some(function (item) { return item.score > 5; }) ? 10 : 5;
      var scoreCard = document.createElement('section');
      scoreCard.className = 'visual-card';
      var scoreTitle = document.createElement('h3');
      scoreTitle.textContent = '多维评分概览';
      scoreCard.appendChild(scoreTitle);
      scores.slice(0, 8).forEach(function (item) {
        var row = document.createElement('div');
        row.className = 'score-row';
        var name = document.createElement('span');
        name.className = 'score-name';
        name.textContent = item.name;
        var track = document.createElement('span');
        track.className = 'score-track';
        var fill = document.createElement('span');
        fill.className = 'score-fill';
        fill.style.width = Math.max(0, Math.min(100, item.score / scoreScale * 100)) + '%';
        track.appendChild(fill);
        var value = document.createElement('span');
        value.className = 'score-value';
        value.textContent = item.score.toFixed(1) + '/' + scoreScale;
        row.appendChild(name); row.appendChild(track); row.appendChild(value);
        scoreCard.appendChild(row);
      });
      dashboard.appendChild(scoreCard);
    }
  }

  var comparisonPattern = /PE|PB|股息率|ROE|毛利率|净利率/i;
  var comparisonTable = tables.find(function (table) {
    var heads = table.querySelectorAll('thead th');
    if (heads.length < 3) return false;
    var matchingRows = Array.prototype.slice.call(table.querySelectorAll('tbody tr')).filter(function (row) {
      var first = row.querySelector('td');
      return first && comparisonPattern.test(clean(first.textContent));
    });
    return matchingRows.length >= 2;
  });
  if (comparisonTable) {
    var companyHeaders = Array.prototype.slice.call(comparisonTable.querySelectorAll('thead th')).map(function (cell) { return clean(cell.textContent); });
    var comparisonRows = Array.prototype.slice.call(comparisonTable.querySelectorAll('tbody tr')).filter(function (row) {
      var first = row.querySelector('td');
      return first && comparisonPattern.test(clean(first.textContent));
    }).slice(0, 4);
    var comparisonCard = document.createElement('section');
    comparisonCard.className = 'visual-card comparison-card';
    var comparisonHeading = document.createElement('h3');
    comparisonHeading.textContent = '关键指标横向对比';
    comparisonCard.appendChild(comparisonHeading);
    comparisonRows.forEach(function (row) {
      var cells = row.querySelectorAll('td');
      var values = [];
      for (var index = 1; index < Math.min(cells.length, 5); index += 1) values.push(numberFrom(cells[index].textContent));
      var finite = values.filter(Number.isFinite);
      if (finite.length < 2) return;
      var maxValue = Math.max.apply(Math, finite.map(Math.abs)) || 1;
      var group = document.createElement('div');
      group.className = 'comparison-group';
      var title = document.createElement('div');
      title.className = 'comparison-title';
      title.textContent = clean(cells[0].textContent);
      group.appendChild(title);
      values.forEach(function (numericValue, valueIndex) {
        if (!Number.isFinite(numericValue)) return;
        var item = document.createElement('div');
        item.className = 'comparison-item';
        var name = document.createElement('span');
        name.className = 'comparison-name';
        name.textContent = companyHeaders[valueIndex + 1] || '对比项 ' + (valueIndex + 1);
        var track = document.createElement('span');
        track.className = 'comparison-track';
        var fill = document.createElement('span');
        fill.className = 'comparison-fill';
        fill.style.width = Math.max(4, Math.abs(numericValue) / maxValue * 100) + '%';
        track.appendChild(fill);
        var value = document.createElement('span');
        value.className = 'comparison-value';
        value.textContent = clean(cells[valueIndex + 1].textContent);
        item.appendChild(name); item.appendChild(track); item.appendChild(value);
        group.appendChild(item);
      });
      comparisonCard.appendChild(group);
    });
    if (comparisonCard.querySelector('.comparison-group')) dashboard.appendChild(comparisonCard);
  }

  tables.forEach(function (table) {
    var yearHeaders = Array.prototype.slice.call(table.querySelectorAll('thead th')).map(function (cell) { return clean(cell.textContent); });
    var yearIndexes = [];
    yearHeaders.forEach(function (header, index) { if (/^20\\d{2}(?:Q[1-4])?$/.test(header)) yearIndexes.push(index); });
    if (yearIndexes.length >= 2 && !table.dataset.charted) {
      var trendRow = Array.prototype.slice.call(table.querySelectorAll('tbody tr')).find(function (row) {
        var first = row.querySelector('td');
        return first && /营收|收入|净利润|现金流|ROE|毛利率/i.test(clean(first.textContent));
      });
      if (trendRow) {
        var cells = trendRow.querySelectorAll('td');
        var points = yearIndexes.map(function (index) { return numberFrom(cells[index] && cells[index].textContent); });
        if (points.every(Number.isFinite)) {
          var min = Math.min.apply(Math, points), max = Math.max.apply(Math, points);
          if (min === max) { min -= 1; max += 1; }
          var svgNS = 'http://www.w3.org/2000/svg';
          var figure = document.createElement('figure');
          figure.className = 'trend-figure';
          var caption = document.createElement('div');
          caption.className = 'trend-caption';
          caption.textContent = clean(cells[0].textContent) + '趋势';
          var svg = document.createElementNS(svgNS, 'svg');
          svg.setAttribute('viewBox', '0 0 720 270');
          svg.setAttribute('role', 'img');
          var coords = points.map(function (value, index) {
            var x = 64 + index * (610 / Math.max(1, points.length - 1));
            var y = 210 - (value - min) / (max - min) * 150;
            return [x, y];
          });
          var baseline = document.createElementNS(svgNS, 'line');
          baseline.setAttribute('x1', '55'); baseline.setAttribute('x2', '685'); baseline.setAttribute('y1', '210'); baseline.setAttribute('y2', '210'); baseline.setAttribute('stroke', '#dfe4ed');
          svg.appendChild(baseline);
          var polyline = document.createElementNS(svgNS, 'polyline');
          polyline.setAttribute('points', coords.map(function (point) { return point.join(','); }).join(' '));
          polyline.setAttribute('fill', 'none'); polyline.setAttribute('stroke', '#3156d3'); polyline.setAttribute('stroke-width', '4'); polyline.setAttribute('stroke-linecap', 'round'); polyline.setAttribute('stroke-linejoin', 'round');
          svg.appendChild(polyline);
          coords.forEach(function (point, index) {
            var circle = document.createElementNS(svgNS, 'circle');
            circle.setAttribute('cx', String(point[0])); circle.setAttribute('cy', String(point[1])); circle.setAttribute('r', '6'); circle.setAttribute('fill', '#fff'); circle.setAttribute('stroke', '#3156d3'); circle.setAttribute('stroke-width', '4');
            svg.appendChild(circle);
            var valueLabel = document.createElementNS(svgNS, 'text');
            valueLabel.setAttribute('x', String(point[0])); valueLabel.setAttribute('y', String(point[1] - 14)); valueLabel.setAttribute('text-anchor', 'middle'); valueLabel.setAttribute('font-size', '12'); valueLabel.setAttribute('font-weight', '700'); valueLabel.setAttribute('fill', '#243252'); valueLabel.textContent = clean(cells[yearIndexes[index]].textContent);
            svg.appendChild(valueLabel);
            var yearLabel = document.createElementNS(svgNS, 'text');
            yearLabel.setAttribute('x', String(point[0])); yearLabel.setAttribute('y', '238'); yearLabel.setAttribute('text-anchor', 'middle'); yearLabel.setAttribute('font-size', '12'); yearLabel.setAttribute('fill', '#70798d'); yearLabel.textContent = yearHeaders[yearIndexes[index]];
            svg.appendChild(yearLabel);
          });
          figure.appendChild(caption); figure.appendChild(svg);
          table.parentNode.insertBefore(figure, table);
          table.dataset.charted = 'true';
        }
      }
    }
  });

  content.querySelectorAll('h3,h4').forEach(function (heading) {
    var text = clean(heading.textContent);
    if (/看多|优势|机会|Bull/i.test(text)) heading.classList.add('positive-heading');
    if (/看空|风险|劣势|Bear/i.test(text)) heading.classList.add('negative-heading');
  });
  content.querySelectorAll('tbody tr').forEach(function (row) {
    var text = clean(row.textContent);
    if (/🔴|极高|高风险/.test(text)) row.classList.add('risk-high');
    else if (/🟡|中高|中风险/.test(text)) row.classList.add('risk-medium');
    else if (/🟢|低风险|极低/.test(text)) row.classList.add('risk-low');
  });
  tables.forEach(function (table) {
    if (table.parentElement && table.parentElement.classList.contains('table-wrap')) return;
    var wrap = document.createElement('div');
    wrap.className = 'table-wrap';
    table.parentNode.insertBefore(wrap, table);
    wrap.appendChild(table);
  });
})();
</script>
</body>
</html>`;
}

async function prepareMermaid(
  markdown: string,
  renderer?: MermaidImageRenderer,
): Promise<{ markdown: string; figures: Map<string, MermaidImage> }> {
  if (!renderer) return { markdown, figures: new Map() };
  const figures = new Map<string, MermaidImage>();
  const pattern = /^```(?:mermaid|mmd)[^\n]*\n([\s\S]*?)^```[ \t]*$/gim;
  let prepared = '';
  let cursor = 0;
  let index = 0;
  for (const match of markdown.matchAll(pattern)) {
    const start = match.index ?? 0;
    prepared += markdown.slice(cursor, start);
    try {
      const token = `NANOBOT_MERMAID_FIGURE_${index++}`;
      figures.set(token, await renderer(match[1].trim()));
      prepared += token;
    } catch {
      prepared += match[0];
    }
    cursor = start + match[0].length;
  }
  prepared += markdown.slice(cursor);
  return { markdown: prepared, figures };
}

export async function renderMarkdownPdf(
  markdown: string,
  title: string,
  mermaidRenderer?: MermaidImageRenderer,
  sourcePath?: string,
  template = 'simple',
): Promise<Buffer> {
  const prepared = await prepareMermaid(markdown, mermaidRenderer);
  const document = renderMarkdownDocument(prepared.markdown, title, prepared.figures, sourcePath, template);
  const window = new BrowserWindow({
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  try {
    await window.loadURL(`data:text/html;base64,${Buffer.from(document).toString('base64')}`);
    await window.webContents.executeJavaScript('document.fonts.ready.then(() => true)');
    return await window.webContents.printToPDF({
      pageSize: 'A4',
      printBackground: true,
      preferCSSPageSize: true,
      displayHeaderFooter: true,
      headerTemplate: '<span></span>',
      footerTemplate: '<div style="width:100%;text-align:center;font:8px -apple-system;color:#888579"><span class="pageNumber"></span> / <span class="totalPages"></span></div>',
      generateTaggedPDF: true,
    });
  } finally {
    window.destroy();
  }
}

export async function renderMarkdownHtml(
  markdown: string,
  title: string,
  mermaidRenderer?: MermaidImageRenderer,
  sourcePath?: string,
): Promise<string> {
  const prepared = await prepareMermaid(markdown, mermaidRenderer);
  return `<!-- Generated from Markdown by TPACowork -->\n${renderRichMarkdownHtml(
    prepared.markdown,
    title,
    prepared.figures,
    sourcePath,
  )}`;
}
