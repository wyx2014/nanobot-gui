let initialized = false;

export function normalizeMermaid(code: string): string {
  const lines = code.split('\n');
  const chart = lines.findIndex((line) => /^\s*bar chart\s*$/i.test(line));
  if (chart < 0) return code;

  const xAxis = lines.find((line) => /^\s*x-axis\s+/.test(line));
  const bar = lines.find((line) => /^\s*bar\s+(?!chart\b)/i.test(line));
  const labels = xAxis?.match(/"(?:[^"\\]|\\.)*"/g);
  const values = bar?.replace(/^\s*bar\s+/, '').replace(/^\[|\]$/g, '').split(',').map((value) => value.trim());
  if (!labels?.length || !values?.length || !values.every((value) => /^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(value))) return code;

  return lines
    .filter((line) => !/^\s*color\s+/i.test(line))
    .map((line, index) => {
      if (index === chart) return 'xychart-beta';
      if (/^\s*x-axis\s+/.test(line)) return `x-axis [${labels.join(', ')}]`;
      if (/^\s*bar\s+(?!chart\b)/i.test(line)) return `bar [${values.join(', ')}]`;
      return line;
    })
    .join('\n');
}

export async function renderMermaidSvg(code: string, id: string): Promise<string> {
  const mermaid = (await import('mermaid')).default;

  if (!initialized) {
    mermaid.initialize({
      startOnLoad: false,
      suppressErrorRendering: true,
      securityLevel: 'strict',
      theme: 'default',
      // Avoid foreignObject sizing bugs that clip long/CJK labels in Chromium.
      htmlLabels: false,
      flowchart: { nodeSpacing: 40, rankSpacing: 55, useMaxWidth: false },
      fontFamily: 'PingFang SC, Microsoft YaHei, Arial, sans-serif',
      themeVariables: { fontFamily: 'PingFang SC, Microsoft YaHei, Arial, sans-serif' },
    });
    initialized = true;
  }

  await document.fonts?.ready;
  const normalized = normalizeMermaid(code);
  await mermaid.parse(normalized, { suppressErrors: false });
  return (await mermaid.render(id, normalized)).svg;
}

export async function renderMermaidPng(code: string, id: string) {
  const svg = await renderMermaidSvg(code, id);
  const viewBox = new DOMParser().parseFromString(svg, 'image/svg+xml').documentElement.getAttribute('viewBox')?.split(/\s+/).map(Number);
  const width = viewBox?.[2] || 800;
  const height = viewBox?.[3] || 600;
  const image = new Image();
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));

  try {
    image.src = url;
    await image.decode();
    const scale = Math.min(2, 2400 / Math.max(width, height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(width * scale);
    canvas.height = Math.ceil(height * scale);
    canvas.getContext('2d')?.drawImage(image, 0, 0, canvas.width, canvas.height);
    return { png: canvas.toDataURL('image/png').split(',', 2)[1], width, height };
  } finally {
    URL.revokeObjectURL(url);
  }
}
