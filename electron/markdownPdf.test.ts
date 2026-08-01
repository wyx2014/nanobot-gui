import { describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

vi.mock('electron', () => ({
  app: { getAppPath: vi.fn(() => '/missing-app') },
  BrowserWindow: vi.fn(),
}));

import { renderMarkdownDocument, renderMarkdownHtml } from './markdownPdf';

describe('Markdown PDF document', () => {
  it('renders GFM structures instead of exposing Markdown syntax', () => {
    const html = renderMarkdownDocument(
      '# 报告\n\n> 关键结论\n\n1. 第一项\n2. 第二项\n\n| 指标 | 数值 |\n| --- | --- |\n| 增长 | **28%** |\n\n---\n\n```ts\nconst value = 1\n```',
      '报告',
    );

    expect(html).toContain('<blockquote>');
    expect(html).toContain('<ol>');
    expect(html).toContain('<table>');
    expect(html).toContain('<strong>28%</strong>');
    expect(html).toContain('<hr/>');
    expect(html).toContain('class="language-ts"');
    expect(html).not.toContain('&gt; 关键结论');
  });

  it('uses the page font stack and does not duplicate a leading H1', () => {
    const html = renderMarkdownDocument('# 中国咖啡机市场与品牌全景分析\n\n正文', '中国咖啡机市场与品牌全景分析');
    const body = html.slice(html.indexOf('<body>'));

    expect(body.match(/中国咖啡机市场与品牌全景分析/g)).toHaveLength(1);
    expect(html).toContain('"Newsreader PDF"');
    expect(html).toContain('"PingFang SC"');
    expect(html).toContain('break-after: avoid-page');
    expect(html).toContain('thead { display: table-header-group; }');
  });

  it('adds a visible title only when the Markdown has no H1', () => {
    const html = renderMarkdownDocument('## 摘要\n\n正文', '研究报告');

    expect(html).toContain('<h1 class="document-title">研究报告</h1>');
  });

  it('embeds only report-local raster images as self-contained data', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tparuyi-report-'));
    const assets = path.join(directory, 'assets');
    fs.mkdirSync(assets);
    fs.writeFileSync(
      path.join(assets, 'trend.png'),
      Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL0qQAAAABJRU5ErkJggg==', 'base64'),
    );
    try {
      const html = renderMarkdownDocument(
        '# 研究报告\n\n![收入趋势](assets/trend.png)\n\n![远程图片](https://example.com/chart.png)',
        '研究报告',
        new Map(),
        path.join(directory, 'report.md'),
      );

      expect(html).toContain('data:image/png;base64,');
      expect(html).toContain('收入趋势');
      expect(html).not.toContain('https://example.com/chart.png');
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it('adds a research cover and table of contents for the report PDF template', () => {
    const html = renderMarkdownDocument(
      '# 研究报告\n\n## 核心结论\n\n### 收入趋势\n\n正文',
      '研究报告',
      new Map(),
      undefined,
      'research_report',
    );

    expect(html).toContain('class="research-cover"');
    expect(html).toContain('报告目录');
    expect(html).toContain('核心结论');
  });

  it('creates a self-contained HTML artifact with rendered Mermaid figures', async () => {
    const html = await renderMarkdownHtml(
      '# Report\n\n```mermaid\ngraph TD\nA-->B\n```',
      'Report',
      async () => ({ png: 'aGVsbG8=', width: 320, height: 160 }),
    );

    expect(html).toContain('Generated from Markdown by TPACowork');
    expect(html).toContain('data:image/png;base64,aGVsbG8=');
    expect(html).not.toContain('graph TD');
  });

  it('builds a rich research-report shell with offline data visualizations', async () => {
    const html = await renderMarkdownHtml(
      `# 格力电器投资研究报告

> **数据截止：** 2026年7月10日 | **信息丰富度评级：** A级

## 四维评分

| 维度 | 评分 | 结论 |
| --- | --- | --- |
| 技术面 | 5.5 | 短期修复 |
| 基本面 | 7.5 | 现金流健康 |

## 核心数据

| 指标 | 格力电器 | 美的集团 |
| --- | --- | --- |
| PE | 7.34x | 13.67x |
| 股息率 | 7.84% | 4.5% |

## 财务趋势

| 指标 | 2023 | 2024 | 2025 |
| --- | --- | --- | --- |
| 营收 | 2050 | 1900 | 1711 |`,
      '格力电器投资研究报告',
    );

    expect(html).toContain('class="report-hero"');
    expect(html).toContain('class="report-toc"');
    expect(html).toContain('id="dashboard"');
    expect(html).toContain('多维评分概览');
    expect(html).toContain('trend-figure');
    expect(html).toContain('TPACOWORK · EXPERT RESEARCH');
    expect(html).not.toContain('cdn.jsdelivr.net');

    document.open();
    document.write(html);
    document.close();
    const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
    expect(script).toBeTruthy();
    window.eval(script!);

    expect(document.querySelectorAll('.report-section')).toHaveLength(4);
    expect(document.querySelector('.report-preamble')).not.toBeNull();
    expect(document.querySelector('.score-value')?.textContent).toContain('/10');
    expect(document.querySelectorAll('.toc-links a')).toHaveLength(3);
    expect(document.querySelectorAll('.metric-card')).toHaveLength(3);
    expect(document.querySelectorAll('.score-row')).toHaveLength(2);
    expect(document.querySelectorAll('.comparison-group')).toHaveLength(2);
    expect(document.querySelector('.comparison-card')?.textContent).toContain('关键指标横向对比');
    expect(document.querySelector('.trend-figure')).not.toBeNull();
  });
});
