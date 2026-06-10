/**
 * TaskStepParser - Parse AI-generated execution plans from response text
 *
 * Supports two formats:
 * 1. Markdown format: "## 执行计划" followed by numbered list
 * 2. JSON format: {"plan": [...]}
 */

export interface ParsedStep {
  index: number;
  description: string;
  status: 'pending' | 'running' | 'completed' | 'error';
}

export interface ParsedPlan {
  steps: ParsedStep[];
  rawText: string;
  format: 'markdown' | 'json' | 'none';
}

// Regex patterns for different plan formats
// Support variations: "## 执行计划", "##执行计划", "# 执行计划", "执行计划："
const MARKDOWN_PLAN_HEADER = /^#*\s*执行计划[:：]?\s*$/m;
const JSON_PLAN_PATTERN = /\{"plan"\s*:\s*\[([^\]]+)\]\}/;

/**
 * Parse execution plan from AI response text
 */
export function parseExecutionPlan(text: string): ParsedPlan {
  // Try JSON format first (more precise)
  const jsonPlan = parseJSONPlan(text);
  if (jsonPlan.steps.length > 0) {
    return jsonPlan;
  }

  // Try Markdown format
  const markdownPlan = parseMarkdownPlan(text);
  if (markdownPlan.steps.length > 0) {
    return markdownPlan;
  }

  // No plan found
  return {
    steps: [],
    rawText: '',
    format: 'none',
  };
}

/**
 * Parse JSON format plan: {"plan": ["step1", "step2"]}
 */
function parseJSONPlan(text: string): ParsedPlan {
  const match = text.match(JSON_PLAN_PATTERN);
  if (!match) {
    return { steps: [], rawText: '', format: 'json' };
  }

  try {
    const planArray = JSON.parse(`[${match[1]}]`) as string[];
    const steps: ParsedStep[] = planArray.map((desc, i) => ({
      index: i + 1,
      description: desc.trim(),
      status: 'pending' as const,
    }));

    return {
      steps,
      rawText: match[0],
      format: 'json',
    };
  } catch {
    return { steps: [], rawText: '', format: 'json' };
  }
}

/**
 * Parse Markdown format plan:
 * ## 执行计划
 * 1. Step one
 * 2. Step two
 */
function parseMarkdownPlan(text: string): ParsedPlan {
  // Find the plan header
  const headerMatch = text.match(MARKDOWN_PLAN_HEADER);
  if (!headerMatch) {
    return { steps: [], rawText: '', format: 'markdown' };
  }

  // Find the section after header until next ## or end
  const headerIndex = headerMatch.index!;
  const afterHeader = text.slice(headerIndex + headerMatch[0].length);
  const nextSectionMatch = afterHeader.match(/^##\s/m);
  const planSection = nextSectionMatch
    ? afterHeader.slice(0, nextSectionMatch.index)
    : afterHeader;

  // Extract numbered steps (support various formats)
  // - "1. Step"
  // - "1、Step"
  // - "- Step" (bullet points)
  // - "* Step" (asterisk bullets)
  const steps: ParsedStep[] = [];
  const stepRegex = /^(?:\d+[.、]|[-*])\s+(.+)$/gm;
  let stepMatch;

  while ((stepMatch = stepRegex.exec(planSection)) !== null) {
    steps.push({
      index: steps.length + 1,
      description: stepMatch[1].trim(),
      status: 'pending',
    });
  }

  if (steps.length === 0) {
    return { steps: [], rawText: '', format: 'markdown' };
  }

  // Calculate raw text span
  const rawText = text.slice(
    headerIndex,
    headerIndex + headerMatch[0].length + (nextSectionMatch?.index ?? planSection.length)
  );

  return {
    steps,
    rawText: rawText.trim(),
    format: 'markdown',
  };
}

/**
 * Match a tool call to a plan step based on description keywords
 */
export function matchToolToStep(
  toolName: string,
  toolInput: Record<string, unknown>,
  steps: ParsedStep[]
): number | null {
  const pendingSteps = steps.filter((s) => s.status === 'pending');
  if (pendingSteps.length === 0) return null;

  // Generate keywords from tool call
  const keywords: string[] = [toolName.toLowerCase()];

  // Add file path keywords
  const path = (toolInput.path || toolInput.file_path || toolInput.filePath) as string | undefined;
  if (path) {
    const fileName = path.split(/[/\\]/).pop()?.toLowerCase();
    if (fileName) keywords.push(fileName);
  }

  // Add command keywords
  const command = (toolInput.command || toolInput.cmd) as string | undefined;
  if (command) {
    // Extract first few words of command
    const cmdWords = command.toLowerCase().split(/\s+/).slice(0, 3);
    keywords.push(...cmdWords);
  }

  // Add query keywords
  const query = (toolInput.query || toolInput.pattern) as string | undefined;
  if (query) {
    keywords.push(query.toLowerCase());
  }

  // Tool name to Chinese keyword mapping
  const toolKeywords: Record<string, string[]> = {
    read_file: ['读取', '查看', '读', '看'],
    write_file: ['写入', '创建', '生成', '保存', '写'],
    edit_file: ['修改', '编辑', '更新', '改'],
    list_directory: ['列出', '目录', '查看', '看'],
    run_command: ['执行', '运行', '命令', 'python', 'node', 'npm'],
    get_system_info: ['系统', '信息', '环境'],
    web_search: ['搜索', '查询', '网上'],
  };

  if (toolKeywords[toolName]) {
    keywords.push(...toolKeywords[toolName]);
  }

  // Score each pending step
  let bestMatch: { index: number; score: number } | null = null;

  for (const step of pendingSteps) {
    const descLower = step.description.toLowerCase();
    let score = 0;

    for (const keyword of keywords) {
      if (descLower.includes(keyword)) {
        score += keyword.length; // Longer matches score higher
      }
    }

    if (score > 0 && (!bestMatch || score > bestMatch.score)) {
      bestMatch = { index: step.index, score };
    }
  }

  // If no keyword match, return first pending step (sequential execution)
  if (!bestMatch && pendingSteps.length > 0) {
    return pendingSteps[0].index;
  }

  return bestMatch?.index ?? null;
}

/**
 * Check if text starts with a plan (for early parsing)
 */
export function textStartsWithPlan(text: string): boolean {
  const trimmed = text.trim();
  return (
    /^#*\s*执行计划/.test(trimmed) ||
    trimmed.startsWith('{"plan"')
  );
}

/**
 * Extract plan text from the beginning of response
 * Returns null if no plan found at the start
 */
export function extractPlanFromStart(text: string): { plan: ParsedPlan; remainingText: string } | null {
  const plan = parseExecutionPlan(text);
  if (plan.format === 'none' || plan.steps.length === 0) {
    return null;
  }

  // Remove the plan section from the beginning
  const planEndIndex = text.indexOf(plan.rawText) + plan.rawText.length;
  const remainingText = text.slice(planEndIndex).trim();

  return { plan, remainingText };
}
