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

function markdownBody(markdown: string): string {
  return renderToStaticMarkup(React.createElement(ReactMarkdown, {
    remarkPlugins,
    components: {
      // Match the chat renderer: remote Markdown images are not loaded implicitly.
      img: () => null,
    },
    children: markdown,
  }));
}

export function renderMarkdownDocument(
  markdown: string,
  title: string,
  mermaidFigures: Map<string, MermaidImage> = new Map(),
): string {
  const font = readNewsreaderFont();
  const fontFace = font
    ? `@font-face { font-family: "Newsreader PDF"; src: url(data:font/woff2;base64,${font}) format("woff2"); font-style: normal; font-weight: 200 800; font-display: block; }`
    : '';
  let body = markdownBody(markdown);
  for (const [token, image] of mermaidFigures) {
    const figure = `<figure class="mermaid"><img src="data:image/png;base64,${image.png}" width="${image.width}" height="${image.height}" alt="Mermaid diagram"></figure>`;
    body = body.replace(`<p>${token}</p>`, figure);
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
.document-title { margin-bottom: 9mm; }
</style>
</head>
<body>${visibleTitle}${body}</body>
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
): Promise<Buffer> {
  const prepared = await prepareMermaid(markdown, mermaidRenderer);
  const document = renderMarkdownDocument(prepared.markdown, title, prepared.figures);
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
