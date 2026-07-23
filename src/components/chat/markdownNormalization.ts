function normalizeEmphasisText(text: string): string {
  return text
    // Some model/provider combinations escape Markdown delimiters even though
    // the response is ultimately rendered as Markdown.
    .replace(/\\\*\\\*([^\n]+?)\\\*\\\*/g, '**$1**')
    .replace(/＊＊([^\n]+?)＊＊/g, '**$1**')
    .replace(/\*[\u200B-\u200D\uFEFF]\*/g, '**')
    // CommonMark deliberately treats `** text **` as plain text. Models emit
    // this relaxed form often enough that the chat renderer should repair it.
    .replace(/\*\*[ \t]+(\S(?:[^*\n]*?\S)?)[ \t]+\*\*/g, '**$1**');
}

function normalizeInlineMarkdown(text: string): string {
  let output = '';
  let textStart = 0;
  let cursor = 0;

  while (cursor < text.length) {
    if (text[cursor] !== '`') {
      cursor += 1;
      continue;
    }

    let runEnd = cursor + 1;
    while (text[runEnd] === '`') runEnd += 1;
    const delimiter = text.slice(cursor, runEnd);
    const closingIndex = text.indexOf(delimiter, runEnd);
    if (closingIndex === -1) {
      cursor = runEnd;
      continue;
    }

    output += normalizeEmphasisText(text.slice(textStart, cursor));
    const codeEnd = closingIndex + delimiter.length;
    output += text.slice(cursor, codeEnd);
    textStart = codeEnd;
    cursor = codeEnd;
  }

  return output + normalizeEmphasisText(text.slice(textStart));
}

/**
 * Normalize emphasis delimiters commonly emitted by streaming model APIs.
 * Fenced and inline code are intentionally left byte-for-byte unchanged.
 */
export function normalizeMarkdownEmphasis(content: string): string {
  const lines = content.match(/[^\n]*(?:\n|$)/g) ?? [content];
  let fence: { marker: string; length: number } | null = null;

  return lines.map((line) => {
    const fenceMatch = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (fence) {
      if (
        fenceMatch
        && fenceMatch[1][0] === fence.marker
        && fenceMatch[1].length >= fence.length
      ) {
        fence = null;
      }
      return line;
    }

    if (fenceMatch) {
      fence = { marker: fenceMatch[1][0], length: fenceMatch[1].length };
      return line;
    }

    return normalizeInlineMarkdown(line);
  }).join('');
}

interface MarkdownAstNode {
  type: string;
  value?: string;
  children?: MarkdownAstNode[];
}

function relaxedStrongChildren(value: string): MarkdownAstNode[] | null {
  const pattern = /\*\*([^*\n]+?)\*\*/g;
  const children: MarkdownAstNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(value)) !== null) {
    if (match.index > lastIndex) {
      children.push({ type: 'text', value: value.slice(lastIndex, match.index) });
    }
    children.push({
      type: 'strong',
      children: [{ type: 'text', value: match[1] }],
    });
    lastIndex = match.index + match[0].length;
  }

  if (children.length === 0) return null;
  if (lastIndex < value.length) {
    children.push({ type: 'text', value: value.slice(lastIndex) });
  }
  return children;
}

function transformRelaxedStrong(node: MarkdownAstNode): void {
  if (!node.children) return;

  for (let index = 0; index < node.children.length; index += 1) {
    const child = node.children[index];
    if (child.type === 'text' && child.value) {
      const replacements = relaxedStrongChildren(child.value);
      if (replacements) {
        node.children.splice(index, 1, ...replacements);
        index += replacements.length - 1;
      }
      continue;
    }
    transformRelaxedStrong(child);
  }
}

/**
 * Parse paired strong markers that CommonMark leaves as text when the markers
 * sit between Chinese text and punctuation, for example `呈现**"结论"**的`.
 * Code and inlineCode nodes have no child text nodes, so they remain untouched.
 */
export function remarkRelaxedStrong() {
  return (tree: MarkdownAstNode) => transformRelaxedStrong(tree);
}
