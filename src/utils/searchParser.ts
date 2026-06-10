/**
 * Utility to extract structured search results from web_search tool output
 * or from LLM-generated "来源" text blocks.
 *
 * The web_search tool embeds a hidden JSON marker in its output:
 *   <!--SEARCH_JSON:[{...}]-->
 *
 * When no structured data is available (e.g. Anthropic native web search),
 * we fall back to parsing the "来源" section from the LLM's text output.
 */

import type { SearchResult } from '@/types';

const SEARCH_JSON_REGEX = /<!--SEARCH_JSON:([\s\S]*?)-->/;

/**
 * Extract SearchResult[] from a web_search tool result string.
 * Returns null if the result doesn't contain valid search data.
 */
export function parseSearchResults(result: string): SearchResult[] | null {
  const match = result.match(SEARCH_JSON_REGEX);
  if (match) {
    try {
      const parsed = JSON.parse(match[1]);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      // Malformed JSON in marker
    }
  }

  // Fallback: try raw JSON array
  try {
    const parsed = JSON.parse(result);
    if (Array.isArray(parsed)) return parsed;
  } catch {
    // Not JSON
  }

  return null;
}

/**
 * Strip LLM-generated "来源/Sources/References" block from the end of markdown text.
 *
 * Handles multiple formats:
 *  - Line-separated: "来源\n[1] Title https://url\n[2] Title https://url"
 *  - Inline: "来源 [1] Title https://url [2] Title https://url"
 *  - With/without brackets, with/without dashes/em-dashes before URLs
 */
// Line-separated format: header on its own line, then numbered refs on subsequent lines
const SOURCES_BLOCK_LINES = /\n*(?:#{1,3}\s*)?(?:来源|Sources?|References?|参考(?:来源|资料)?)\s*:?\s*\n+(?:\s*\[?\d{1,2}\]?\s*[^\n]*https?:\/\/[^\n]+\n?)+\s*$/i;

// Inline format: header followed by numbered refs all in one flowing block
// e.g. "来源 [1] Title https://url [2] Title https://url"
const SOURCES_BLOCK_INLINE = /\n*(?:#{1,3}\s*)?(?:来源|Sources?|References?|参考(?:来源|资料)?)\s*:?\s*[[]?\d{1,2}]?[^[]*https?:\/\/[^\s]+(?:\s+[[]?\d{1,2}]?[^[]*https?:\/\/[^\s]+)*\s*$/i;

export function stripSourcesBlock(text: string): string {
  // Try line-separated format first, then inline
  let result = text.replace(SOURCES_BLOCK_LINES, '');
  if (result === text) {
    result = text.replace(SOURCES_BLOCK_INLINE, '');
  }
  return result.trimEnd();
}

/**
 * Parse SearchResult[] directly from the "来源" block in LLM text output.
 * Used as a fallback when no structured SEARCH_JSON data is available.
 *
 * Handles formats like:
 *   来源 [1] 新浪科技《Title》https://url [2] Title https://url
 *   来源\n[1] Title - https://url\n[2] Title - https://url
 */
// Match each numbered reference: [N] title text https://url
const SOURCE_ENTRY_REGEX = /\[(\d{1,2})]\s*([^[\n]*?)\s*(https?:\/\/[^\s[\]]+)/g;

// Match the sources header to extract the block
const SOURCES_HEADER = /(?:来源|Sources?|References?|参考(?:来源|资料)?)\s*:?\s*/i;

export function parseSourcesFromText(text: string): SearchResult[] | null {
  // Find the sources section (search from the end of text)
  const headerMatch = text.match(SOURCES_HEADER);
  if (!headerMatch || headerMatch.index === undefined) return null;

  // Only look at text from the header onwards
  const sourcesBlock = text.slice(headerMatch.index);

  // Extract individual source entries
  const results: SearchResult[] = [];
  SOURCE_ENTRY_REGEX.lastIndex = 0;
  let match;
  while ((match = SOURCE_ENTRY_REGEX.exec(sourcesBlock)) !== null) {
    const title = match[2]
      .replace(/[《》「」【】]/g, '') // Remove Chinese brackets
      .replace(/\s*[-—–]\s*$/, '')     // Remove trailing dashes
      .trim();

    // Extract domain from URL
    let source = '';
    try {
      source = new URL(match[3]).hostname;
    } catch {
      // Invalid URL, skip domain extraction
    }

    results.push({
      title: title || `Source ${match[1]}`,
      url: match[3],
      snippet: '',
      source,
    });
  }

  return results.length > 0 ? results : null;
}
