import { afterEach, describe, expect, it } from 'vitest';

import {
  clearConversationSearchHighlights,
  findConversationSearchMatches,
} from './useConversationSearch';

afterEach(() => {
  clearConversationSearchHighlights();
  document.body.replaceChildren();
});

describe('conversation search matching', () => {
  it('finds case-insensitive matches across user and assistant message units', () => {
    const root = document.createElement('div');
    root.innerHTML = `
      <div data-thread-unit><p>青岛啤酒的数字是 123</p></div>
      <div data-thread-unit><p>第二个数字在这里</p></div>
    `;
    document.body.append(root);

    const matches = findConversationSearchMatches(root, '数字');

    expect(matches).toHaveLength(2);
    expect(matches.map((range) => range.toString())).toEqual(['数字', '数字']);
  });

  it('supports a phrase spanning adjacent markdown text nodes', () => {
    const root = document.createElement('div');
    root.innerHTML = `
      <div data-thread-unit><p>投资<strong>研究</strong>报告</p></div>
    `;
    document.body.append(root);

    const matches = findConversationSearchMatches(root, '投资研究');

    expect(matches).toHaveLength(1);
    expect(matches[0].toString()).toBe('投资研究');
  });

  it('does not count action labels or hidden accessibility text', () => {
    const root = document.createElement('div');
    root.innerHTML = `
      <div data-thread-unit>
        <p>正文包含一次报告</p>
        <button>复制报告</button>
        <span aria-hidden="true">隐藏报告</span>
      </div>
    `;
    document.body.append(root);

    expect(findConversationSearchMatches(root, '报告')).toHaveLength(1);
    expect(findConversationSearchMatches(root, '不存在')).toEqual([]);
    expect(findConversationSearchMatches(root, '   ')).toEqual([]);
  });
});
