import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: { getAppPath: vi.fn(() => '/missing-app') },
  BrowserWindow: vi.fn(),
}));

import { renderMarkdownDocument } from './markdownPdf';

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
});
