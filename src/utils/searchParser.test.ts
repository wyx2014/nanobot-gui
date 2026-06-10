import { describe, it, expect } from 'vitest';
import { parseSearchResults, stripSourcesBlock, parseSourcesFromText } from './searchParser';

describe('searchParser', () => {
  describe('parseSearchResults', () => {
    it('should extract results from SEARCH_JSON marker', () => {
      const input = `<!--SEARCH_JSON:[{"title":"Test","url":"https://example.com","snippet":"A snippet","source":"example.com"}]-->

搜索结果 (共 1 条):

1. **Test** — example.com
   A snippet
   🔗 https://example.com`;

      const results = parseSearchResults(input);
      expect(results).not.toBeNull();
      expect(results).toHaveLength(1);
      expect(results![0]).toEqual({
        title: 'Test',
        url: 'https://example.com',
        snippet: 'A snippet',
        source: 'example.com',
      });
    });

    it('should handle multiple results in marker', () => {
      const items = [
        { title: 'Result 1', url: 'https://a.com', snippet: 'Snippet 1' },
        { title: 'Result 2', url: 'https://b.com', snippet: 'Snippet 2' },
        { title: 'Result 3', url: 'https://c.com', snippet: 'Snippet 3' },
      ];
      const input = `<!--SEARCH_JSON:${JSON.stringify(items)}-->\n\nsome text`;

      const results = parseSearchResults(input);
      expect(results).toHaveLength(3);
      expect(results![0].title).toBe('Result 1');
      expect(results![2].url).toBe('https://c.com');
    });

    it('should fallback to raw JSON array', () => {
      const raw = JSON.stringify([
        { title: 'Raw', url: 'https://raw.com', snippet: 'Raw result' },
      ]);

      const results = parseSearchResults(raw);
      expect(results).not.toBeNull();
      expect(results).toHaveLength(1);
      expect(results![0].title).toBe('Raw');
    });

    it('should return null for plain text', () => {
      expect(parseSearchResults('No results found')).toBeNull();
    });

    it('should return null for empty string', () => {
      expect(parseSearchResults('')).toBeNull();
    });

    it('should return null for malformed JSON in marker', () => {
      const input = '<!--SEARCH_JSON:{not valid json-->rest of text';
      expect(parseSearchResults(input)).toBeNull();
    });

    it('should return null for non-array JSON', () => {
      const input = '{"key": "value"}';
      expect(parseSearchResults(input)).toBeNull();
    });

    it('should return null for non-array JSON in marker', () => {
      const input = '<!--SEARCH_JSON:{"key":"value"}-->rest';
      expect(parseSearchResults(input)).toBeNull();
    });

    it('should handle marker with special characters in snippets', () => {
      const items = [
        { title: 'C++ & "Rust"', url: 'https://lang.com', snippet: 'Compare <C++> & "Rust" performance' },
      ];
      const input = `<!--SEARCH_JSON:${JSON.stringify(items)}-->`;

      const results = parseSearchResults(input);
      expect(results).toHaveLength(1);
      expect(results![0].title).toBe('C++ & "Rust"');
      expect(results![0].snippet).toBe('Compare <C++> & "Rust" performance');
    });

    it('should handle empty results array in marker', () => {
      const input = '<!--SEARCH_JSON:[]-->No results';
      const results = parseSearchResults(input);
      expect(results).not.toBeNull();
      expect(results).toHaveLength(0);
    });

    it('should prefer marker over raw JSON when both present', () => {
      const markerItems = [{ title: 'Marker', url: 'https://m.com', snippet: 'From marker' }];
      // The entire string also happens to be valid JSON (unlikely in practice)
      const input = `<!--SEARCH_JSON:${JSON.stringify(markerItems)}-->`;

      const results = parseSearchResults(input);
      expect(results).toHaveLength(1);
      expect(results![0].title).toBe('Marker');
    });
  });

  describe('stripSourcesBlock', () => {
    it('should strip Chinese 来源 block with numbered URLs (line-separated)', () => {
      const input = `这是一些内容。

来源
[1] 新浪科技 - https://news.sina.com.cn/article1
[2] 腾讯新闻 - https://news.qq.com/article2`;

      expect(stripSourcesBlock(input)).toBe('这是一些内容。');
    });

    it('should strip inline 来源 block', () => {
      const input = `回答内容。

来源 [1] 新浪科技《科技晚报AI速递》https://news.sina.com.cn/article1 [2] 软盟资讯《AI资讯汇总》https://news.softunis.com/52592.html [3] 新浪看点《AI热点》https://k.sina.com.cn/article123`;

      expect(stripSourcesBlock(input)).toBe('回答内容。');
    });

    it('should strip English Sources block', () => {
      const input = `Some content here.

Sources
[1] Example - https://example.com/1
[2] Another - https://another.com/2`;

      expect(stripSourcesBlock(input)).toBe('Some content here.');
    });

    it('should strip References block with markdown header', () => {
      const input = `Content paragraph.

## References
[1] Title One https://example.com/1
[2] Title Two https://example.com/2
[3] Title Three https://example.com/3`;

      expect(stripSourcesBlock(input)).toBe('Content paragraph.');
    });

    it('should strip 参考资料 block', () => {
      const input = `回答内容。

参考资料:
[1] 文章标题 - https://example.com/zh
[2] 另一篇 - https://example.com/zh2`;

      expect(stripSourcesBlock(input)).toBe('回答内容。');
    });

    it('should not strip text without URL references', () => {
      const input = `Some content.

来源: based on my knowledge.`;

      expect(stripSourcesBlock(input)).toBe(input);
    });

    it('should not strip numbered lists that are not sources', () => {
      const input = `Here are the steps:

1. First step
2. Second step
3. Third step`;

      expect(stripSourcesBlock(input)).toBe(input);
    });

    it('should preserve content before the sources block', () => {
      const input = `First paragraph with [1] citation.

Second paragraph.

来源
[1] Example https://example.com`;

      expect(stripSourcesBlock(input)).toBe(`First paragraph with [1] citation.

Second paragraph.`);
    });

    it('should handle empty string', () => {
      expect(stripSourcesBlock('')).toBe('');
    });

    it('should handle text with no sources block', () => {
      const input = 'Just some regular text without any sources.';
      expect(stripSourcesBlock(input)).toBe(input);
    });

    it('should strip sources with bracket-less numbers', () => {
      const input = `Content here.

来源
1 Article Title https://example.com/1
2 Another Article https://example.com/2`;

      expect(stripSourcesBlock(input)).toBe('Content here.');
    });
  });

  describe('parseSourcesFromText', () => {
    it('should parse inline 来源 block', () => {
      const input = `回答内容。

来源 [1] 新浪科技《科技晚报AI速递》https://news.sina.com.cn/article1 [2] 软盟资讯《AI资讯》https://news.softunis.com/52592.html`;

      const results = parseSourcesFromText(input);
      expect(results).not.toBeNull();
      expect(results).toHaveLength(2);
      expect(results![0].title).toBe('新浪科技科技晚报AI速递');
      expect(results![0].url).toBe('https://news.sina.com.cn/article1');
      expect(results![0].source).toBe('news.sina.com.cn');
      expect(results![1].title).toBe('软盟资讯AI资讯');
      expect(results![1].url).toBe('https://news.softunis.com/52592.html');
    });

    it('should parse line-separated sources', () => {
      const input = `Content here.

来源
[1] Example Title - https://example.com/1
[2] Another Title - https://another.com/2`;

      const results = parseSourcesFromText(input);
      expect(results).not.toBeNull();
      expect(results).toHaveLength(2);
      expect(results![0].title).toBe('Example Title');
      expect(results![0].url).toBe('https://example.com/1');
      expect(results![1].title).toBe('Another Title');
    });

    it('should parse sources with Chinese book title marks', () => {
      const input = `来源 [1] 新浪科技《科技晚报AI速递：今日科技热点一览 | 2026-03-03》https://news.sina.com.cn/zx/ds/2026-03-03/doc-inhptein4611107.shtml [2] 软盟资讯《AI人工智能领域最新热点资讯汇总（2026-03-01）》https://news.softunis.com/52592.html [3] 新浪看点《AI热点小时报 | 2026-03-03》https://k.sina.com.cn/article_7857201856_1d45362c001902soq0.html`;

      const results = parseSourcesFromText(input);
      expect(results).not.toBeNull();
      expect(results).toHaveLength(3);
      expect(results![0].title).toContain('科技晚报AI速递');
      expect(results![0].source).toBe('news.sina.com.cn');
      expect(results![2].source).toBe('k.sina.com.cn');
    });

    it('should return null when no sources header present', () => {
      expect(parseSourcesFromText('Just regular text without sources.')).toBeNull();
    });

    it('should return null when sources header has no URL references', () => {
      expect(parseSourcesFromText('来源: based on my knowledge.')).toBeNull();
    });

    it('should handle English Sources header', () => {
      const input = `Content.

Sources [1] Article https://example.com/1 [2] Report https://example.com/2`;

      const results = parseSourcesFromText(input);
      expect(results).not.toBeNull();
      expect(results).toHaveLength(2);
    });
  });
});
