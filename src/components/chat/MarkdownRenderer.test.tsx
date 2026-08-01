import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import MarkdownRenderer from './MarkdownRenderer';
import { normalizeMarkdownEmphasis } from './markdownNormalization';

let container: HTMLDivElement | undefined;
let root: Root | undefined;

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  container = undefined;
  root = undefined;
});

function render(
  content: string,
  variant: 'assistant' | 'activity' = 'assistant',
): HTMLDivElement {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() => root?.render(<MarkdownRenderer content={content} variant={variant} />));
  return container;
}

describe('MarkdownRenderer emphasis', () => {
  it('renders standard double-asterisk Markdown as bold text', () => {
    const view = render('这是 **重点内容**。');
    const strong = view.querySelector('strong');

    expect(strong?.textContent).toBe('重点内容');
    expect(strong?.classList.contains('font-bold')).toBe(true);
    expect(view.textContent).toBe('这是 重点内容。');
  });

  it('renders quoted bold text when the markers touch surrounding Chinese text', () => {
    const view = render(
      '中国2026年上半年的进口呈现**"AI产业链一骑绝尘、能源进口剧烈分化、内需整体仍偏弱"**的格局。',
    );
    const strong = view.querySelector('strong');

    expect(strong?.textContent).toBe('"AI产业链一骑绝尘、能源进口剧烈分化、内需整体仍偏弱"');
    expect(view.textContent).toBe(
      '中国2026年上半年的进口呈现"AI产业链一骑绝尘、能源进口剧烈分化、内需整体仍偏弱"的格局。',
    );
  });

  it('repairs relaxed, escaped, and full-width emphasis delimiters', () => {
    const view = render('** 宽松格式 **、\\*\\*转义格式\\*\\*、＊＊全角格式＊＊');

    expect([...view.querySelectorAll('strong')].map((node) => node.textContent)).toEqual([
      '宽松格式',
      '转义格式',
      '全角格式',
    ]);
    expect(view.textContent).not.toContain('**');
  });

  it('does not rewrite emphasis examples inside code', () => {
    const markdown = '`** 行内代码 **`\n\n```markdown\n** 围栏代码 **\n```';

    expect(normalizeMarkdownEmphasis(markdown)).toBe(markdown);
  });

  it('hides desktop file-delivery JSON while retaining the answer text', () => {
    const view = render([
      'PDF 已生成，共 4 页。',
      '',
      '```desktop',
      '{',
      '  "localPath": "/Users/test/reports/report.pdf",',
      '  "fileName": "report.pdf"',
      '}',
      '```',
    ].join('\n'));

    expect(view.textContent).toContain('PDF 已生成，共 4 页。');
    expect(view.textContent).not.toContain('localPath');
    expect(view.textContent).not.toContain('fileName');
    expect(view.textContent).not.toContain('/Users/test/reports/report.pdf');
    expect(view.querySelector('pre')).toBeNull();
  });

  it('uses compact, low-emphasis system typography for activity thinking', () => {
    const view = render([
      '# 核验思路',
      '',
      '先检查 **数据口径**。',
      '',
      '- 对比公告',
      '- 检查单位',
    ].join('\n'), 'activity');

    const activity = view.querySelector('.activity-markdown');
    const heading = view.querySelector('h1');
    const paragraph = view.querySelector('p');
    const listItem = view.querySelector('li');
    const strong = view.querySelector('strong');

    expect(activity).not.toBeNull();
    expect(view.querySelector('.claude-markdown')).toBeNull();
    expect(heading?.className).toContain('text-[12px]');
    expect(heading?.className).toContain('font-medium');
    expect(heading?.className).not.toContain('font-semibold');
    expect(paragraph?.className).toContain('font-normal');
    expect(paragraph?.className).toContain('text-muted-foreground/70');
    expect(listItem?.className).toContain('text-[12px]');
    expect(strong?.className).toContain('font-medium');
  });
});
