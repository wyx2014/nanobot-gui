import type { MCPTemplate, ModelPreset } from '@/types/marketplace';

/** MCP Server templates for quick installation */
export const mcpTemplates: MCPTemplate[] = [
  {
    id: 'filesystem',
    name: 'filesystem',
    description: '文件系统访问，支持读写文件和目录操作',
    command: 'npx',
    defaultArgs: ['-y', '@modelcontextprotocol/server-filesystem', '/path/to/allowed/dir'],
    configurableArgs: [
      {
        index: 2,
        label: '允许访问的目录',
        placeholder: '~/projects',
      },
    ],
  },
  {
    id: 'brave-search',
    name: 'brave-search',
    description: '使用 Brave Search API 进行网络搜索',
    command: 'npx',
    defaultArgs: ['-y', '@modelcontextprotocol/server-brave-search'],
    configurableArgs: [],
    requiredEnvVars: [
      {
        name: 'BRAVE_API_KEY',
        label: 'Brave Search API Key',
        placeholder: 'BSA...',
        description: '从 brave.com/search/api 获取',
      },
    ],
  },
  {
    id: 'sqlite',
    name: 'sqlite',
    description: 'SQLite 数据库操作和查询',
    command: 'npx',
    defaultArgs: ['-y', '@modelcontextprotocol/server-sqlite', '/path/to/database.db'],
    configurableArgs: [
      {
        index: 2,
        label: '数据库文件路径',
        placeholder: '/path/to/your/database.db',
      },
    ],
  },
  {
    id: 'puppeteer',
    name: 'puppeteer',
    description: '浏览器自动化，支持网页截图和交互',
    command: 'npx',
    defaultArgs: ['-y', '@modelcontextprotocol/server-puppeteer'],
    configurableArgs: [],
  },
  {
    id: 'memory',
    name: 'memory',
    description: '持久化记忆存储，跨会话保存信息',
    command: 'npx',
    defaultArgs: ['-y', '@modelcontextprotocol/server-memory'],
    configurableArgs: [],
  },
  {
    id: 'github',
    name: 'github',
    description: 'GitHub API 集成，支持仓库、Issues、PR 操作',
    command: 'npx',
    defaultArgs: ['-y', '@modelcontextprotocol/server-github'],
    configurableArgs: [],
    requiredEnvVars: [
      {
        name: 'GITHUB_PERSONAL_ACCESS_TOKEN',
        label: 'GitHub Personal Access Token',
        placeholder: 'ghp_...',
        description: '从 GitHub Settings → Developer settings → Personal access tokens 生成',
      },
    ],
  },
  {
    id: 'slack',
    name: 'slack',
    description: 'Slack 集成，发送消息和管理频道',
    command: 'npx',
    defaultArgs: ['-y', '@modelcontextprotocol/server-slack'],
    configurableArgs: [],
    requiredEnvVars: [
      {
        name: 'SLACK_BOT_TOKEN',
        label: 'Slack Bot Token',
        placeholder: 'xoxb-...',
        description: '从 Slack API 管理页面获取 Bot Token',
      },
    ],
  },
  {
    id: 'fetch',
    name: 'fetch',
    description: 'HTTP 请求工具，获取网页和 API 数据',
    command: 'npx',
    defaultArgs: ['-y', '@modelcontextprotocol/server-fetch'],
    configurableArgs: [],
  },
  {
    id: 'playwright',
    name: 'playwright',
    description: '浏览器自动化，支持网页操作、截图、表单填写',
    command: 'npx',
    defaultArgs: ['-y', '@playwright/mcp@latest'],
    configurableArgs: [],
  },
  {
    id: 'notion',
    name: 'notion',
    description: 'Notion 集成，管理页面、数据库和内容',
    command: 'npx',
    defaultArgs: ['-y', '@notionhq/mcp-server-notion'],
    configurableArgs: [],
    requiredEnvVars: [
      {
        name: 'NOTION_API_KEY',
        label: 'Notion Integration Token',
        placeholder: 'ntn_...',
        description: '从 notion.so/my-integrations 创建并获取',
      },
    ],
  },
  {
    id: 'postgres',
    name: 'postgres',
    description: 'PostgreSQL 数据库查询和管理',
    command: 'npx',
    defaultArgs: ['-y', '@anthropic/mcp-server-postgres', 'postgresql://localhost:5432/mydb'],
    configurableArgs: [
      {
        index: 2,
        label: '数据库连接字符串',
        placeholder: 'postgresql://user:pass@localhost:5432/dbname',
      },
    ],
  },
  {
    id: 'docker',
    name: 'docker',
    description: 'Docker 容器管理，支持列出、启停容器和镜像操作',
    command: 'npx',
    defaultArgs: ['-y', '@anthropic/mcp-server-docker'],
    configurableArgs: [],
  },
  {
    id: 'sentry',
    name: 'sentry',
    description: 'Sentry 错误监控集成，查看和管理 issues',
    command: 'npx',
    defaultArgs: ['-y', '@sentry/mcp-server-sentry'],
    configurableArgs: [],
    requiredEnvVars: [
      {
        name: 'SENTRY_AUTH_TOKEN',
        label: 'Sentry Auth Token',
        placeholder: 'sntrys_...',
        description: '从 sentry.io 的 Settings → Auth Tokens 获取',
      },
    ],
  },
  {
    id: 'linear',
    name: 'linear',
    description: 'Linear 项目管理集成，管理 Issues 和项目',
    command: 'npx',
    defaultArgs: ['-y', '@anthropic/mcp-server-linear'],
    configurableArgs: [],
    requiredEnvVars: [
      {
        name: 'LINEAR_API_KEY',
        label: 'Linear API Key',
        placeholder: 'lin_api_...',
        description: '从 Linear Settings → API 获取',
      },
    ],
  },
  {
    id: 'chrome-devtools',
    name: 'chrome-devtools',
    description: 'Chrome DevTools 浏览器调试与自动化，支持截图、网络监控、性能分析、页面操作',
    command: 'npx',
    defaultArgs: ['-y', 'chrome-devtools-mcp@latest'],
    configurableArgs: [],
  },
  {
    id: 'ruyi-browser-bridge',
    name: 'ruyi-browser-bridge',
    description: '太资如意浏览器桥接，配合 Chrome 插件实现网页自动化：点击、填写、提取数据、截图等',
    command: 'npx',
    defaultArgs: ['-y', 'ruyi-browser-bridge@latest'],
    configurableArgs: [],
    setupHint: '需要配合 Ruyi Browser Bridge Chrome 插件使用。请在 Chrome 扩展商店搜索安装 "Ruyi Browser Bridge"，或从 GitHub 下载手动加载。',
    defaultTimeout: 120000, // 120s — browser automation needs longer timeouts (e.g. waiting for popups)
  },
];

/** Model presets for quick switching */
export const modelPresets: ModelPreset[] = [
  {
    id: 'claude-sonnet',
    name: 'Claude Sonnet 4.6',
    provider: 'anthropic',
    apiFormat: 'anthropic',
    model: 'claude-sonnet-4-6',
    description: '速度与智能的最佳平衡，适合大多数任务',
  },
  {
    id: 'claude-opus',
    name: 'Claude Opus 4.6',
    provider: 'anthropic',
    apiFormat: 'anthropic',
    model: 'claude-opus-4-6',
    description: '最强模型，适合复杂推理和编程',
  },
  {
    id: 'claude-haiku',
    name: 'Claude Haiku 4.5',
    provider: 'anthropic',
    apiFormat: 'anthropic',
    model: 'claude-haiku-4-5-20251001',
    description: '快速响应，适合简单任务和高频调用',
  },
  {
    id: 'gpt-4o',
    name: 'GPT-4o',
    provider: 'openai',
    apiFormat: 'openai-compatible',
    model: 'gpt-4o',
    description: 'OpenAI 旗舰多模态模型',
  },
  {
    id: 'gpt-4o-mini',
    name: 'GPT-4o Mini',
    provider: 'openai',
    apiFormat: 'openai-compatible',
    model: 'gpt-4o-mini',
    description: 'OpenAI 轻量快速模型',
  },
  {
    id: 'deepseek-v3',
    name: 'DeepSeek V3.2',
    provider: 'deepseek',
    apiFormat: 'openai-compatible',
    model: 'deepseek-chat',
    baseUrl: 'https://api.deepseek.com',
    description: 'DeepSeek 旗舰模型，高性价比',
  },
  {
    id: 'volcengine-doubao-seed',
    name: 'Doubao Seed 2.0 Pro',
    provider: 'volcengine',
    apiFormat: 'openai-compatible',
    model: 'doubao-seed-2-0-pro-260215',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    description: '豆包旗舰模型，字节跳动出品',
  },
  {
    id: 'bailian-qwen-max',
    name: 'Qwen Max',
    provider: 'bailian',
    apiFormat: 'openai-compatible',
    model: 'qwen-max',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    description: '通义千问旗舰模型，阿里百炼平台',
  },
  {
    id: 'qiniu-deepseek-v3.2',
    name: '七牛云 DeepSeek V3.2',
    provider: 'qiniu',
    apiFormat: 'openai-compatible',
    model: 'deepseek/deepseek-v3.2-251201',
    baseUrl: 'https://api.qnaigc.com',
    description: '七牛云代理，50+ 模型统一接入',
  },
  {
    id: 'ollama-llama',
    name: 'Ollama Llama 3.2',
    provider: 'local',
    apiFormat: 'openai-compatible',
    model: 'llama3.2',
    baseUrl: 'http://localhost:11434/v1',
    description: '本地运行 Llama 3.2 模型',
  },
  {
    id: 'ollama-qwen',
    name: 'Ollama Qwen 2.5',
    provider: 'local',
    apiFormat: 'openai-compatible',
    model: 'qwen2.5',
    baseUrl: 'http://localhost:11434/v1',
    description: '本地运行 Qwen 2.5 模型',
  },
];

/** Get MCP template by ID */
export function getMCPTemplate(id: string): MCPTemplate | undefined {
  return mcpTemplates.find((t) => t.id === id);
}

/** Get model preset by ID */
export function getModelPreset(id: string): ModelPreset | undefined {
  return modelPresets.find((p) => p.id === id);
}
