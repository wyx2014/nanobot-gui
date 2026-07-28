import ReactMarkdown from 'react-markdown';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';
import { PrismLight as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import tsx from 'react-syntax-highlighter/dist/esm/languages/prism/tsx';
import python from 'react-syntax-highlighter/dist/esm/languages/prism/python';
import bash from 'react-syntax-highlighter/dist/esm/languages/prism/bash';
import json from 'react-syntax-highlighter/dist/esm/languages/prism/json';
import markdown from 'react-syntax-highlighter/dist/esm/languages/prism/markdown';
import { useState, memo, useMemo, useCallback, type ReactNode } from 'react';
import { Copy, Check, FileText, FolderOpen, Download, ChevronDown, ChevronUp } from 'lucide-react';
import { usePreviewStore } from '@/stores/previewStore';
import { useI18n, format } from '@/i18n';
import { cn } from '@/lib/utils';
import { getBaseName, isLocalFilePath } from '@/utils/pathUtils';
import { fsBridge, shellBridge, dialogBridge } from '@/lib/ipc-factory';
import { artifactFromPath, artifactFromUrl, looksLikeArtifactUrl } from '@/core/artifacts';
import type { SearchResult } from '@/types';
import MermaidBlock from './MermaidBlock';
import FileAttachment from './FileAttachment';
import { normalizeMarkdownEmphasis, remarkRelaxedStrong } from './markdownNormalization';

SyntaxHighlighter.registerLanguage('tsx', tsx);
SyntaxHighlighter.registerLanguage('typescript', tsx);
SyntaxHighlighter.registerLanguage('javascript', tsx);
SyntaxHighlighter.registerLanguage('python', python);
SyntaxHighlighter.registerLanguage('bash', bash);
SyntaxHighlighter.registerLanguage('shell', bash);
SyntaxHighlighter.registerLanguage('json', json);
SyntaxHighlighter.registerLanguage('markdown', markdown);

// --- Path detection utilities ---

/** Check if a string looks like an absolute file path (for inline code) */
function isAbsolutePath(text: string): boolean {
  const t = text.trim();
  if (t.includes('\n')) return false;
  if (!isLocalFilePath(t)) return false;
  const normalized = t.replace(/\\/g, '/');
  const segments = normalized.split('/').filter(Boolean);
  return segments.length >= 2;
}

/**
 * Match absolute paths in bare text.
 * Only matches paths with well-known filesystem prefixes to avoid false positives from URLs.
 * Requires a file extension at the end (to avoid partial matches on paths with spaces).
 */
const FS_PREFIXES = 'Users|home|tmp|var|opt|etc|Library|Applications|private|Volumes|mnt';
const STOP_CHARS = '[^\\s,，。；！？：)）\\]】」]+';
// Unix: /Users/foo/bar.txt
const UNIX_PATH_RE = `\\/(?:${FS_PREFIXES})\\/${STOP_CHARS}\\.\\w{1,10}`;
// Windows: C:/Users/foo/bar.txt or C:\Users\foo\bar.txt
const WIN_PATH_RE = `[A-Za-z]:[/\\\\](?:${FS_PREFIXES}|Windows|Program Files|AppData)[/\\\\]${STOP_CHARS}\\.\\w{1,10}`;
const BARE_PATH_REGEX = new RegExp(`${WIN_PATH_RE}|${UNIX_PATH_RE}`, 'g');

/** Split a text string into parts, replacing detected file paths with FilePathChip elements */
function splitTextWithPaths(text: string): ReactNode[] {
  const parts: ReactNode[] = [];
  let lastIndex = 0;
  let match;
  let keyIdx = 0;

  BARE_PATH_REGEX.lastIndex = 0;
  while ((match = BARE_PATH_REGEX.exec(text)) !== null) {
    const path = match[0];
    const idx = match.index;

    // Skip if preceded by / (part of URL like ://)
    if (idx > 0 && text[idx - 1] === '/') continue;

    if (idx > lastIndex) {
      parts.push(text.slice(lastIndex, idx));
    }
    parts.push(<FilePathChip key={`bp-${keyIdx++}`} filePath={path} />);
    lastIndex = idx + path.length;
  }

  if (parts.length === 0) return [text];
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }
  return parts;
}

function textFromNode(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textFromNode).join('');
  if (node && typeof node === 'object' && 'props' in node) {
    return textFromNode((node as { props?: { children?: ReactNode } }).props?.children ?? '');
  }
  return '';
}

function savedHtmlArtifactPath(children: ReactNode): string | null {
  const text = textFromNode(children).trim();
  if (!/^(?:文件已保存至|已保存至|文件保存至|file saved to|saved to)\s*[:：]?/i.test(text)) {
    return null;
  }
  BARE_PATH_REGEX.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = BARE_PATH_REGEX.exec(text)) !== null) {
    if (/\.html?$/i.test(match[0])) return match[0];
  }
  return null;
}

function isArtifactTransportPayload(raw: string, language: string): boolean {
  if (!['desktop', 'json', ''].includes(language)) return false;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return false;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return false;
  const record = parsed as Record<string, unknown>;
  const localPath = record.localPath ?? record.local_path;
  const fileName = record.fileName ?? record.file_name;
  return (
    typeof localPath === 'string'
    && isLocalFilePath(localPath)
    && typeof fileName === 'string'
    && fileName.trim().length > 0
  );
}

function stripArtifactTransportBlocks(content: string): string {
  return content.replace(
    /```([A-Za-z0-9_-]*)[ \t]*\n([\s\S]*?)```/g,
    (block, rawLanguage: string, body: string) => (
      isArtifactTransportPayload(body.trim(), rawLanguage.toLowerCase())
        ? ''
        : block
    ),
  );
}

// --- Citation utilities ---

const CITATION_REGEX = /\[(\d{1,2})\]/g;

/** Inline citation badge — small grounded pill that sits on the text baseline */
function CitationBadge({ index, title, onClick }: {
  index: number;
  title?: string;
  onClick?: (index: number) => void;
}) {
  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onClick?.(index);
  };
  return (
    <span
      onClick={handleClick}
      className="inline-flex items-center justify-center mx-[2px] px-[5px] py-[1px] text-[11px] text-[#d97757] bg-[#d97757]/8 rounded cursor-pointer hover:bg-[#d97757]/15 transition-colors leading-tight align-baseline"
      title={title}
    >
      {index}
    </span>
  );
}

/** Split text to replace [1]-style citation markers with CitationBadge components */
function splitTextWithCitations(
  text: string,
  searchResults: SearchResult[],
  onCitationClick?: (index: number) => void
): ReactNode[] {
  const parts: ReactNode[] = [];
  let lastIndex = 0;
  let keyIdx = 0;

  CITATION_REGEX.lastIndex = 0;
  let match;
  while ((match = CITATION_REGEX.exec(text)) !== null) {
    const citNum = parseInt(match[1], 10);
    if (citNum < 1 || citNum > searchResults.length) continue;

    const idx = match.index;
    if (idx > lastIndex) {
      parts.push(text.slice(lastIndex, idx));
    }
    parts.push(
      <CitationBadge
        key={`cite-${keyIdx++}`}
        index={citNum}
        title={searchResults[citNum - 1]?.title}
        onClick={onCitationClick}
      />
    );
    lastIndex = idx + match[0].length;
  }

  if (parts.length === 0) return [text];
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }
  return parts;
}

/** Process a single text node: split by paths, then optionally by citations */
function splitTextNode(
  text: string,
  searchResults: SearchResult[] | null,
  onCitationClick?: (index: number) => void
): ReactNode[] {
  let parts = splitTextWithPaths(text);
  if (searchResults && searchResults.length > 0) {
    const expanded: ReactNode[] = [];
    for (const part of parts) {
      if (typeof part === 'string') {
        expanded.push(...splitTextWithCitations(part, searchResults, onCitationClick));
      } else {
        expanded.push(part);
      }
    }
    parts = expanded;
  }
  return parts;
}

/** Process react-markdown children: detect file paths and citations in text nodes */
function processChildren(
  children: ReactNode,
  searchResults: SearchResult[] | null,
  onCitationClick?: (index: number) => void
): ReactNode {
  if (typeof children === 'string') {
    const parts = splitTextNode(children, searchResults, onCitationClick);
    return parts.length === 1 ? parts[0] : parts;
  }
  if (!Array.isArray(children)) return children;

  let modified = false;
  const result: ReactNode[] = [];

  for (const child of children) {
    if (typeof child === 'string') {
      const parts = splitTextNode(child, searchResults, onCitationClick);
      if (parts.length > 1 || parts[0] !== child) {
        modified = true;
        result.push(...parts);
      } else {
        result.push(child);
      }
    } else {
      result.push(child);
    }
  }

  return modified ? result : children;
}

// --- Components ---

function FilePathChip({ filePath }: { filePath: string }) {
  const openArtifact = usePreviewStore((s) => s.openArtifact);
  const { t } = useI18n();
  const fileName = getBaseName(filePath);

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    openArtifact(artifactFromPath(filePath));
  };

  const handleReveal = async (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    try {
      await shellBridge.revealItemInDir(filePath);
    } catch { /* ignore */ }
  };

  return (
    <span
      className="inline-flex items-center gap-1 px-1.5 py-0.5 mx-0.5 rounded-md bg-[#f5f3ee] border border-[#e5e2db] hover:border-[#d97757]/40 hover:shadow-sm cursor-pointer transition-all text-[13px] align-middle group/chip"
      title={filePath}
      onClick={handleClick}
    >
      <FileText className="w-3.5 h-3.5 text-[#888579] shrink-0" />
      <span className="text-[#29261b] truncate max-w-[200px]">{fileName}</span>
      <button
        onClick={handleReveal}
        className="p-0.5 rounded hover:bg-[#e5e2db] opacity-0 group-hover/chip:opacity-100 transition-opacity shrink-0"
        title={t.chat.openInFinder}
      >
        <FolderOpen className="w-3 h-3 text-[#888579]" />
      </button>
    </span>
  );
}

function ArtifactLink({ href, children, className }: { href: string; children?: ReactNode; className: string }) {
  const openArtifact = usePreviewStore((state) => state.openArtifact);
  return (
    <a
      href={href}
      onClick={(event) => {
        event.preventDefault();
        openArtifact(artifactFromUrl(href, {
          name: typeof children === 'string' && /\.[A-Za-z0-9]{1,8}$/.test(children.trim())
            ? children.trim()
            : undefined,
        }));
      }}
      className={className}
    >
      {children}
    </a>
  );
}

// --- Language to file extension map ---
const LANG_EXT_MAP: Record<string, string> = {
  typescript: '.ts', tsx: '.tsx', javascript: '.js', jsx: '.jsx',
  python: '.py', bash: '.sh', shell: '.sh', json: '.json',
  html: '.html', css: '.css', sql: '.sql', rust: '.rs',
  go: '.go', java: '.java', kotlin: '.kt', swift: '.swift',
  ruby: '.rb', php: '.php', yaml: '.yml', toml: '.toml',
  xml: '.xml', markdown: '.md', c: '.c', cpp: '.cpp',
};

const COLLAPSE_THRESHOLD = 15;

function CollapsibleCodeBlock({ codeString, language }: { codeString: string; language: string | null }) {
  const { t } = useI18n();
  const [collapsed, setCollapsed] = useState(true);
  const [copied, setCopied] = useState(false);

  const lineCount = codeString.split('\n').length;
  const shouldCollapse = lineCount > COLLAPSE_THRESHOLD;
  const isCollapsed = shouldCollapse && collapsed;

  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(codeString);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [codeString]);

  const handleSaveAs = useCallback(async () => {
    try {
      const ext = (language && LANG_EXT_MAP[language]) || '.txt';
      const filePath = await dialogBridge.save({
        defaultPath: `code${ext}`,
        filters: [{ name: 'Code File', extensions: [ext.slice(1)] }],
      });
      if (filePath) {
        await fsBridge.writeTextFile(filePath, codeString);
      }
    } catch { /* ignore */ }
  }, [codeString, language]);

  return (
    <div className="relative my-3 rounded-lg overflow-hidden max-w-full">
      {/* Code area */}
      <div className="relative">
        <div
          style={isCollapsed ? { maxHeight: '360px', overflow: 'hidden' } : undefined}
        >
          <SyntaxHighlighter
            style={oneDark}
            language={language || 'text'}
            PreTag="div"
            wrapLongLines={true}
            customStyle={{
              margin: 0,
              borderRadius: 0,
              fontSize: '13px',
              padding: '12px 16px',
              overflowX: 'auto',
              maxWidth: '100%',
            }}
          >
            {codeString}
          </SyntaxHighlighter>
        </div>
        {/* Gradient overlay when collapsed */}
        {isCollapsed && (
          <div className="absolute bottom-0 left-0 right-0 h-20 bg-gradient-to-t from-[#282c34] to-transparent flex items-end justify-center pb-2">
            <button
              onClick={() => setCollapsed(false)}
              className="flex items-center gap-1 px-3 py-1 rounded-full bg-white/10 hover:bg-white/20 text-xs text-white/80 transition-colors"
            >
              <ChevronDown className="h-3.5 w-3.5" />
              {format(t.chat.codeBlockExpand, { lines: String(lineCount) })}
            </button>
          </div>
        )}
      </div>
      {/* Bottom toolbar — always visible */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-neutral-800 text-xs text-neutral-400">
        <div className="flex items-center gap-2">
          {language && <span>{language}</span>}
          {shouldCollapse && !isCollapsed && (
            <button
              onClick={() => setCollapsed(true)}
              className="flex items-center gap-0.5 hover:text-neutral-200 transition-colors"
            >
              <ChevronUp className="h-3.5 w-3.5" />
              {t.chat.codeBlockCollapse}
            </button>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={handleCopy}
            className="p-1 rounded hover:bg-white/10 transition-colors"
            title={copied ? '✓' : 'Copy'}
          >
            {copied ? (
              <Check className="h-3.5 w-3.5 text-green-400" />
            ) : (
              <Copy className="h-3.5 w-3.5" />
            )}
          </button>
          <button
            onClick={handleSaveAs}
            className="p-1 rounded hover:bg-white/10 transition-colors"
            title={t.chat.codeBlockSaveAs}
          >
            <Download className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}

// Stable references — avoid recreating on every render
const remarkPluginsStable = [remarkGfm, remarkBreaks, remarkRelaxedStrong];
const SAFE_URL_PATTERN = /^(https?:\/\/|mailto:|tel:|#)/i;

type MarkdownVariant = 'assistant' | 'user';

/** Build markdown component overrides, optionally citation-aware */
function buildMarkdownComponents(
  searchResults: SearchResult[] | null,
  onCitationClick?: (index: number) => void,
  variant: MarkdownVariant = 'assistant'
) {
  const sr = searchResults && searchResults.length > 0 ? searchResults : null;
  const isUser = variant === 'user';
  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    code({ className, children, ...props }: any) {
      const match = /language-(\w+)/.exec(className || '');
      const codeString = String(children).replace(/\n$/, '');
      const isInline = !match && !codeString.includes('\n');
      const language = match?.[1]?.toLowerCase() || null;

      if (isInline) {
        if (!isUser && isAbsolutePath(codeString)) {
          return <FilePathChip filePath={codeString.trim()} />;
        }
        return (
          <code
            className={isUser
              ? 'px-1 py-0.5 rounded bg-[#e3e0d9] text-[#29261b] text-[0.9em]'
              : 'px-1 py-0.5 rounded bg-[#f0eee8] text-[#b85f3f] text-[0.9em]'
            }
            {...props}
          >
            {children}
          </code>
        );
      }

      if (language === 'mermaid' || language === 'mmd') {
        return <MermaidBlock code={codeString} />;
      }

      return (
        <CollapsibleCodeBlock
          codeString={codeString}
          language={language}
        />
      );
    },

    img() {
      return null;
    },
    p({ children }: { children?: ReactNode }) {
      const htmlPath = !isUser ? savedHtmlArtifactPath(children ?? '') : null;
      if (htmlPath) {
        return (
          <div className="my-3">
            <FileAttachment filePath={htmlPath} />
          </div>
        );
      }
      return <p className={isUser ? 'my-1 leading-relaxed text-[14.5px]' : 'my-3 leading-8 text-[18px] text-[#191814]'}>{processChildren(children, sr, onCitationClick)}</p>;
    },
    h1({ children }: { children?: ReactNode }) {
      return <h1 className={cn('text-[30px] leading-tight font-semibold mt-7 mb-4 tracking-[-0.02em]', isUser ? 'text-[#191814]' : 'text-[#191814]')}>{children}</h1>;
    },
    h2({ children }: { children?: ReactNode }) {
      return <h2 className={cn('text-[25px] leading-tight font-semibold mt-8 mb-3 tracking-[-0.015em]', isUser ? 'text-[#191814]' : 'text-[#191814]')}>{children}</h2>;
    },
    h3({ children }: { children?: ReactNode }) {
      return <h3 className={cn('text-[21px] leading-snug font-semibold mt-6 mb-2', isUser ? 'text-[#191814]' : 'text-[#191814]')}>{children}</h3>;
    },
    ul({ children }: { children?: ReactNode }) {
      return <ul className="my-3 ml-6 list-disc space-y-2">{children}</ul>;
    },
    ol({ children }: { children?: ReactNode }) {
      return <ol className="my-3 ml-6 list-decimal space-y-2">{children}</ol>;
    },
    li({ children }: { children?: ReactNode }) {
      return <li className={isUser ? 'leading-relaxed text-[14.5px]' : 'leading-8 text-[18px] text-[#191814]'}>{processChildren(children, sr, onCitationClick)}</li>;
    },
    blockquote({ children }: { children?: ReactNode }) {
      return (
        <blockquote className={cn('my-4 pl-6 border-l-4', isUser ? 'border-[#d4d0c7] text-[#3d3929]' : 'border-[#e5e2db] text-[#3d3929]')}>
          {children}
        </blockquote>
      );
    },
    a({ href, children }: { href?: string; children?: ReactNode }) {
      const safeHref = SAFE_URL_PATTERN.test(href ?? '') || href?.startsWith('/api/') ? href : undefined;
      const className = isUser ? 'text-[#191814] underline' : 'text-[#b85f3f] hover:underline';
      if (safeHref && looksLikeArtifactUrl(safeHref)) {
        return <ArtifactLink href={safeHref} className={className}>{children}</ArtifactLink>;
      }
      return (
        <a href={safeHref} target="_blank" rel="noopener noreferrer" className={className}>
          {children}
        </a>
      );
    },
    strong({ children }: { children?: ReactNode }) {
      return <strong className={cn('font-bold', isUser ? 'text-[#191814]' : 'text-[#191814]')}>{children}</strong>;
    },
    table({ children }: { children?: ReactNode }) {
      return (
        <div className="my-4 overflow-x-auto rounded-lg border border-[#e5e2db] bg-[#fffdf8]">
          <table className="w-full border-collapse text-[14px] leading-6">{children}</table>
        </div>
      );
    },
    thead({ children }: { children?: ReactNode }) {
      return <thead className="bg-[#f4f1e8]">{children}</thead>;
    },
    th({ children }: { children?: ReactNode }) {
      return <th className="border-b border-[#e5e2db] px-3.5 py-2.5 text-left font-semibold text-[#29261b]">{children}</th>;
    },
    td({ children }: { children?: ReactNode }) {
      return <td className="border-t border-[#eeeae1] px-3.5 py-2.5 text-[#3d3929]">{children}</td>;
    },
    hr() {
      return <hr className={cn('my-7', isUser ? 'border-[#d4d0c7]' : 'border-[#dedbd3]')} />;
    },
  };
}

// Stable references for the default (no citations) cases
const defaultAssistantComponents = buildMarkdownComponents(null, undefined, 'assistant');
const defaultUserComponents = buildMarkdownComponents(null, undefined, 'user');

interface MarkdownRendererProps {
  content: string;
  searchResults?: SearchResult[];
  onCitationClick?: (index: number) => void;
  variant?: MarkdownVariant;
}

export default memo(function MarkdownRenderer({ content, searchResults, onCitationClick, variant = 'assistant' }: MarkdownRendererProps) {
  const normalizedContent = useMemo(
    () => normalizeMarkdownEmphasis(
      variant === 'assistant' ? stripArtifactTransportBlocks(content) : content,
    ),
    [content, variant],
  );
  const components = useMemo(
    () => searchResults && searchResults.length > 0
      ? buildMarkdownComponents(searchResults, onCitationClick, variant)
      : variant === 'user' ? defaultUserComponents : defaultAssistantComponents,
    [searchResults, onCitationClick, variant]
  );

  return (
    <div className={variant === 'assistant' ? 'claude-markdown' : undefined}>
      <ReactMarkdown
        remarkPlugins={remarkPluginsStable}
        components={components}
      >
        {normalizedContent}
      </ReactMarkdown>
    </div>
  );
});
