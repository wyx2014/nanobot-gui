import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

const MATCH_HIGHLIGHT_NAME = 'conversation-search-match';
const ACTIVE_HIGHLIGHT_NAME = 'conversation-search-current';
const HIGHLIGHT_STYLE_ID = 'conversation-search-highlight-styles';

function ensureConversationSearchHighlightStyles(): void {
  if (typeof document === 'undefined' || document.getElementById(HIGHLIGHT_STYLE_ID)) return;

  const style = document.createElement('style');
  style.id = HIGHLIGHT_STYLE_ID;
  style.textContent = `
    ::highlight(${MATCH_HIGHLIGHT_NAME}) {
      background-color: rgba(167, 222, 196, 0.48);
      color: inherit;
    }

    ::highlight(${ACTIVE_HIGHLIGHT_NAME}) {
      background-color: #82d4ae;
      color: #173c2b;
    }

    .dark ::highlight(${MATCH_HIGHLIGHT_NAME}) {
      background-color: rgba(72, 148, 111, 0.48);
    }

    .dark ::highlight(${ACTIVE_HIGHLIGHT_NAME}) {
      background-color: #4caa7b;
      color: #f5fff9;
    }
  `;
  document.head.append(style);
}

interface HighlightRegistryLike {
  delete: (name: string) => void;
  set: (name: string, highlight: unknown) => void;
}

interface HighlightConstructorLike {
  new (...ranges: Range[]): unknown;
}

function highlightApi(): {
  registry: HighlightRegistryLike;
  Highlight: HighlightConstructorLike;
} | null {
  const registry = (globalThis.CSS as typeof CSS & {
    highlights?: HighlightRegistryLike;
  } | undefined)?.highlights;
  const Highlight = (globalThis as typeof globalThis & {
    Highlight?: HighlightConstructorLike;
  }).Highlight;
  return registry && Highlight ? { registry, Highlight } : null;
}

export function clearConversationSearchHighlights(): void {
  const api = highlightApi();
  api?.registry.delete(MATCH_HIGHLIGHT_NAME);
  api?.registry.delete(ACTIVE_HIGHLIGHT_NAME);
}

function searchableTextNodes(block: Element): Text[] {
  const nodes: Text[] = [];
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!(node instanceof Text) || !node.data) return NodeFilter.FILTER_REJECT;
      const parent = node.parentElement;
      if (!parent || parent.closest([
        'button',
        'input',
        'textarea',
        'select',
        'option',
        'script',
        'style',
        '[aria-hidden="true"]',
        '[contenteditable="true"]',
        '[data-conversation-search-ignore]',
      ].join(','))) {
        return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  let node = walker.nextNode();
  while (node) {
    nodes.push(node as Text);
    node = walker.nextNode();
  }
  return nodes;
}

interface TextNodeSlice {
  node: Text;
  start: number;
  end: number;
}

function rangesInBlock(block: Element, normalizedQuery: string): Range[] {
  const slices: TextNodeSlice[] = [];
  let text = '';
  for (const node of searchableTextNodes(block)) {
    const start = text.length;
    text += node.data;
    slices.push({ node, start, end: text.length });
  }
  if (!text) return [];

  const normalizedText = text.toLowerCase();
  const ranges: Range[] = [];
  let searchFrom = 0;
  while (searchFrom <= normalizedText.length - normalizedQuery.length) {
    const matchStart = normalizedText.indexOf(normalizedQuery, searchFrom);
    if (matchStart < 0) break;
    const matchEnd = matchStart + normalizedQuery.length;
    const startSlice = slices.find((slice) => matchStart >= slice.start && matchStart < slice.end);
    const endSlice = slices.find((slice) => matchEnd > slice.start && matchEnd <= slice.end);
    if (startSlice && endSlice) {
      const range = document.createRange();
      range.setStart(startSlice.node, matchStart - startSlice.start);
      range.setEnd(endSlice.node, matchEnd - endSlice.start);
      ranges.push(range);
    }
    searchFrom = matchEnd;
  }
  return ranges;
}

export function findConversationSearchMatches(root: HTMLElement, query: string): Range[] {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return [];

  const units = [...root.querySelectorAll<HTMLElement>('[data-thread-unit]')];
  const blocks: Element[] = units.length > 0 ? units : [root];
  return blocks.flatMap((block) => rangesInBlock(block, normalizedQuery));
}

function paintConversationSearchHighlights(matches: Range[], activeIndex: number): void {
  clearConversationSearchHighlights();
  const api = highlightApi();
  if (!api || matches.length === 0) return;

  const activeRange = matches[activeIndex];
  const otherRanges = matches.filter((_, index) => index !== activeIndex);
  if (otherRanges.length > 0) {
    api.registry.set(MATCH_HIGHLIGHT_NAME, new api.Highlight(...otherRanges));
  }
  if (activeRange) {
    api.registry.set(ACTIVE_HIGHLIGHT_NAME, new api.Highlight(activeRange));
  }
}

function scrollMatchIntoView(range: Range | undefined): void {
  const element = range?.startContainer.parentElement;
  element?.scrollIntoView?.({ behavior: 'smooth', block: 'center', inline: 'nearest' });
}

export function useConversationSearch({
  root,
  open,
  query,
  contentRevision,
}: {
  root: HTMLElement | null;
  open: boolean;
  query: string;
  contentRevision: unknown;
}) {
  const [matches, setMatches] = useState<Range[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [navigationRevision, setNavigationRevision] = useState(0);
  const previousQueryRef = useRef('');

  useEffect(() => {
    if (open) ensureConversationSearchHighlightStyles();
  }, [open]);

  useLayoutEffect(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!open || !root || !normalizedQuery) {
      previousQueryRef.current = normalizedQuery;
      setMatches([]);
      setActiveIndex(0);
      clearConversationSearchHighlights();
      return;
    }

    const nextMatches = findConversationSearchMatches(root, normalizedQuery);
    const queryChanged = normalizedQuery !== previousQueryRef.current;
    previousQueryRef.current = normalizedQuery;
    setMatches(nextMatches);
    setActiveIndex((current) => (
      queryChanged ? 0 : Math.min(current, Math.max(0, nextMatches.length - 1))
    ));
  }, [contentRevision, open, query, root]);

  useLayoutEffect(() => {
    if (!open) {
      clearConversationSearchHighlights();
      return;
    }
    paintConversationSearchHighlights(matches, activeIndex);
    scrollMatchIntoView(matches[activeIndex]);
  }, [activeIndex, matches, navigationRevision, open]);

  useEffect(() => () => clearConversationSearchHighlights(), []);

  const selectPrevious = useCallback(() => {
    if (matches.length === 0) return;
    setActiveIndex((current) => (current - 1 + matches.length) % matches.length);
    setNavigationRevision((current) => current + 1);
  }, [matches.length]);

  const selectNext = useCallback(() => {
    if (matches.length === 0) return;
    setActiveIndex((current) => (current + 1) % matches.length);
    setNavigationRevision((current) => current + 1);
  }, [matches.length]);

  return {
    matchCount: matches.length,
    activeMatchIndex: activeIndex,
    selectPrevious,
    selectNext,
  };
}
