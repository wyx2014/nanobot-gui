import { describe, expect, it } from 'vitest';
import type { Message } from '@/types';
import {
  conversationFromSessionSummary,
  gatewayTextModelOptions,
  isGatewayVoiceInputAvailable,
  mapGatewayProviderNameForGui,
  mapWebuiThreadToGuiMessages,
  projectGatewayMessagesForHistory,
  shouldPreserveRunningConversation,
  stripRedundantMcpMentionPrefix,
} from './nanobotClient';
import type { SettingsPayload } from './types';

describe('mapGatewayProviderNameForGui', () => {
  it('maps a dynamic gateway provider to the renderer custom provider', () => {
    expect(mapGatewayProviderNameForGui('asset-deepseek', [
      { name: 'asset-deepseek', custom: true },
    ])).toBe('custom');
  });

  it('keeps built-in mappings compatible with the renderer', () => {
    expect(mapGatewayProviderNameForGui('dashscope', [
      { name: 'dashscope', custom: false },
    ])).toBe('bailian');
    expect(mapGatewayProviderNameForGui('deepseek', [
      { name: 'deepseek', custom: false },
    ])).toBe('deepseek');
  });

  it('maps backend providers without a renderer preset list to custom', () => {
    expect(mapGatewayProviderNameForGui('stepfun', [
      { name: 'stepfun', custom: false },
    ])).toBe('custom');
  });
});

describe('gatewayTextModelOptions', () => {
  it('projects the Gateway text catalog with stable preset identifiers', () => {
    const payload = {
      agent: {
        model: 'step-3.7-flash',
        provider: 'stepfun',
        model_preset: 'step-primary',
      },
      model_defaults: { text: 'step-primary' },
      providers: [
        { name: 'stepfun', label: '阶跃星辰' },
        { name: 'asset-deepseek', label: '资产DeepSeek' },
      ],
      model_presets: [
        {
          name: 'default',
          label: 'Default',
          is_default: true,
          provider: 'asset-deepseek',
          model: 'deepseek_v4_flash',
          capabilities: ['text'],
        },
        {
          name: 'deepseek-flash',
          label: '资产DeepSeek / deepseek_v4_flash',
          is_default: false,
          provider: 'asset-deepseek',
          model: 'deepseek_v4_flash',
          capabilities: ['text'],
        },
        {
          name: 'step-primary',
          label: '阶跃星辰 / step-3.7-flash',
          is_default: false,
          provider: 'stepfun',
          model: 'step-3.7-flash',
          capabilities: ['text'],
        },
        {
          name: 'step-asr',
          label: 'Step ASR',
          is_default: false,
          provider: 'stepfun',
          model: 'stepaudio-2.5-asr',
          capabilities: ['speech_to_text'],
        },
      ],
    } as unknown as SettingsPayload;

    expect(gatewayTextModelOptions(payload)).toEqual([
      {
        presetName: 'step-primary',
        provider: 'stepfun',
        model: 'step-3.7-flash',
        label: '阶跃星辰 / step-3.7-flash',
      },
      {
        presetName: 'deepseek-flash',
        provider: 'asset-deepseek',
        model: 'deepseek_v4_flash',
        label: '资产DeepSeek / deepseek_v4_flash',
      },
    ]);
  });
});

describe('isGatewayVoiceInputAvailable', () => {
  const payload = {
    transcription: {
      enabled: true,
      provider: 'stepfun',
      provider_configured: true,
      model: 'stepaudio-2.5-asr',
    },
    model_defaults: {
      speech_to_text: 'stepfun-asr',
    },
    model_presets: [{
      name: 'stepfun-asr',
      provider: 'stepfun',
      model: 'stepaudio-2.5-asr',
      capabilities: ['speech_to_text'],
    }],
  } as unknown as SettingsPayload;

  it('requires an enabled, credentialed, coherent speech model', () => {
    expect(isGatewayVoiceInputAvailable(payload)).toBe(true);
    expect(isGatewayVoiceInputAvailable({
      ...payload,
      transcription: { ...payload.transcription, provider_configured: false },
    })).toBe(false);
    expect(isGatewayVoiceInputAvailable({
      ...payload,
      transcription: { ...payload.transcription, enabled: false },
    })).toBe(false);
  });

  it('rejects missing and stale speech defaults', () => {
    expect(isGatewayVoiceInputAvailable({
      ...payload,
      model_defaults: { ...payload.model_defaults, speech_to_text: null },
    })).toBe(false);
    expect(isGatewayVoiceInputAvailable({
      ...payload,
      transcription: { ...payload.transcription, model: 'another-asr-model' },
    })).toBe(false);
  });
});

describe('conversationFromSessionSummary', () => {
  it('hydrates only metadata and preserves already loaded messages', () => {
    const existing = {
      id: 'chat-a',
      title: '已有标题',
      messages: [{ id: 'm1', role: 'user' as const, content: '历史', timestamp: 1 }],
      createdAt: 1,
      updatedAt: 2,
      status: 'idle' as const,
    };

    const conversation = conversationFromSessionSummary({
      key: 'websocket:chat-a',
      channel: 'websocket',
      chatId: 'chat-a',
      sessionId: 'ses-a',
      projectId: 'prj-a',
      createdAt: '2026-07-26T10:00:00',
      updatedAt: '2026-07-26T11:00:00',
      title: '',
      preview: '第一条用户消息',
      runStartedAt: 123,
      workspaceScope: null,
      expertTeam: null,
    }, existing);

    expect(conversation.messages).toBe(existing.messages);
    expect(conversation.title).toBe('已有标题');
    expect(conversation.status).toBe('running');
    expect(conversation.sessionId).toBe('ses-a');
    expect(conversation.projectId).toBe('prj-a');
    expect(conversation.hasHistory).toBe(true);
  });

  it('uses the server preview without loading a thread for a new session', () => {
    const conversation = conversationFromSessionSummary({
      key: 'websocket:chat-b',
      channel: 'websocket',
      chatId: 'chat-b',
      createdAt: null,
      updatedAt: null,
      title: '',
      preview: '帮我分析启动速度',
      runStartedAt: null,
    });

    expect(conversation.title).toBe('帮我分析启动速度');
    expect(conversation.messages).toEqual([]);
    expect(conversation.status).toBe('idle');
    expect(conversation.hasHistory).toBe(true);
  });

  it('does not adopt gateway-generated previews as titles for cron run sessions', () => {
    const conversation = conversationFromSessionSummary({
      key: 'cron:daily-brief:1723456789000:abcd1234',
      channel: 'cron',
      chatId: 'cron:daily-brief:1723456789000:abcd1234',
      createdAt: null,
      updatedAt: null,
      title: 'The user wants me to execute a',
      preview: 'The user wants me to execute a',
      runStartedAt: null,
    });

    expect(conversation.title).toBe('新对话');
    expect(conversation.hasHistory).toBe(true);
  });

  it('replaces stale generated cron run titles even when the session was already linked', () => {
    const existing = {
      id: 'cron:daily-brief:1723456789000:abcd1234',
      title: 'The user wants me to execute a',
      scheduledTaskId: 'daily-brief',
      messages: [],
      createdAt: 1,
      updatedAt: 2,
      status: 'idle' as const,
    };

    const conversation = conversationFromSessionSummary({
      key: 'cron:daily-brief:1723456789000:abcd1234',
      channel: 'cron',
      chatId: 'cron:daily-brief:1723456789000:abcd1234',
      createdAt: null,
      updatedAt: null,
      title: 'The user wants me to execute a',
      preview: 'The user wants me to execute a',
      runStartedAt: null,
    }, existing);

    expect(conversation.title).toBe('新对话');
    expect(conversation.scheduledTaskId).toBe('daily-brief');
  });

  it('preserves a normalized scheduled-run title once the run has been opened', () => {
    const existing = {
      id: 'cron:daily-brief:1723456789000:abcd1234',
      title: '8/13 13:05 - 每日AI新闻推送',
      scheduledTaskId: 'daily-brief',
      messages: [],
      createdAt: 1,
      updatedAt: 2,
      status: 'idle' as const,
    };

    const conversation = conversationFromSessionSummary({
      key: 'cron:daily-brief:1723456789000:abcd1234',
      channel: 'cron',
      chatId: 'cron:daily-brief:1723456789000:abcd1234',
      createdAt: null,
      updatedAt: null,
      title: 'The user wants me to execute a',
      preview: 'The user wants me to execute a',
      runStartedAt: null,
    }, existing);

    expect(conversation.title).toBe('8/13 13:05 - 每日AI新闻推送');
    expect(conversation.scheduledTaskId).toBe('daily-brief');
  });

});

describe('shouldPreserveRunningConversation', () => {
  it('only protects a local running snapshot while the gateway still has an active run', () => {
    expect(shouldPreserveRunningConversation('running', 123, null)).toBe(true);
    expect(shouldPreserveRunningConversation('running', null, 123)).toBe(true);
    expect(shouldPreserveRunningConversation('running', null, null)).toBe(false);
    expect(shouldPreserveRunningConversation('idle', 123, 123)).toBe(false);
  });
});

describe('projectGatewayMessagesForHistory', () => {
  it('uses gateway history as the canonical transcript', () => {
    const gateway: Message[] = [
      { id: 'gu1', role: 'user', content: '网关问题', timestamp: 2, loopId: 'loop-2' },
      { id: 'ga1', role: 'assistant', content: '网关回答', timestamp: 3, loopId: 'loop-2' },
    ];

    expect(projectGatewayMessagesForHistory(gateway)).toEqual(gateway);
  });

  it('does not synthesize local user turns when gateway history is missing users', () => {
    const gateway: Message[] = [
      {
        id: 'gt1',
        role: 'tool',
        kind: 'trace',
        content: '',
        timestamp: 3,
        loopId: '',
        toolEvents: [{ phase: 'end', call_id: 'call-1', name: 'message', result: '已生成图表' }],
        mediaAttachments: [{ path: '/tmp/chart.svg', kind: 'image' }],
      },
      { id: 'ga1', role: 'assistant', content: '网关回答', timestamp: 4, loopId: '' },
    ];

    const projected = projectGatewayMessagesForHistory(gateway);

    expect(projected.map((message) => message.id)).toEqual(['gt1', 'ga1']);
    expect(projected[0].mediaAttachments).toEqual([{ path: '/tmp/chart.svg', kind: 'image' }]);
  });

  it('dedupes repeated gateway turns with the same content', () => {
    const gateway: Message[] = [
      { id: 'gu1', role: 'user', content: '查相关度', timestamp: 1000, loopId: 'loop-1' },
      { id: 'ga1', role: 'assistant', content: '相关度结果', timestamp: 2000, loopId: 'loop-1' },
      { id: 'gu2', role: 'user', content: '查相关度', timestamp: 3000, loopId: 'loop-2' },
      { id: 'ga2', role: 'assistant', content: '相关度结果', timestamp: 4000, loopId: 'loop-2' },
    ];

    const projected = projectGatewayMessagesForHistory(gateway);

    expect(projected.map((message) => message.id)).toEqual(['gu1', 'ga1']);
  });

  it('does not dedupe repeated questions when the answer differs', () => {
    const gateway: Message[] = [
      { id: 'gu1', role: 'user', content: '查相关度', timestamp: 1000, loopId: 'loop-1' },
      { id: 'ga1', role: 'assistant', content: '第一次结果', timestamp: 2000, loopId: 'loop-1' },
      { id: 'gu2', role: 'user', content: '查相关度', timestamp: 3000, loopId: 'loop-2' },
      { id: 'ga2', role: 'assistant', content: '第二次结果', timestamp: 4000, loopId: 'loop-2' },
    ];

    const projected = projectGatewayMessagesForHistory(gateway);

    expect(projected.map((message) => message.id)).toEqual(['gu1', 'ga1', 'gu2', 'ga2']);
  });
});

describe('mapWebuiThreadToGuiMessages artifacts', () => {
  it('renders legacy local file context as a file card and clean user prompt', () => {
    const messages = mapWebuiThreadToGuiMessages([{
      id: 'user-with-local-file',
      role: 'user',
      content: [
        '本地文件引用（请按路径读取这些文件；如果路径超出当前工作区权限，请先说明无法访问）：',
        '- skill-card.md: /Users/wyx/Desktop/skill-card.md',
        '这个 skill 写得怎么样',
      ].join('\n'),
      createdAt: 1,
    }]);

    expect(messages[0].content).toBe('这个 skill 写得怎么样');
    expect(messages[0].mediaAttachments).toEqual([{
      id: 'local-file:/Users/wyx/Desktop/skill-card.md',
      path: '/Users/wyx/Desktop/skill-card.md',
      localPath: '/Users/wyx/Desktop/skill-card.md',
      name: 'skill-card.md',
      kind: 'file',
    }]);
  });

  it('projects a typed local folder reference as a folder card', () => {
    const messages = mapWebuiThreadToGuiMessages([{
      id: 'user-with-local-folder',
      role: 'user',
      content: [
        '本地路径引用（文件请按路径读取；文件夹请先列出内容；如果路径超出当前工作区权限，请先说明无法访问）：',
        '- [folder] reports: /Users/wyx/project/reports',
        '汇总这个目录',
      ].join('\n'),
      createdAt: 1,
    }]);

    expect(messages[0].content).toBe('汇总这个目录');
    expect(messages[0].mediaAttachments).toEqual([{
      id: 'local-file:/Users/wyx/project/reports',
      path: '/Users/wyx/project/reports',
      localPath: '/Users/wyx/project/reports',
      name: 'reports',
      kind: 'folder',
    }]);
  });

  it('hides a legacy MCP mention prefix while preserving the connector attachment', () => {
    const messages = mapWebuiThreadToGuiMessages([{
      id: 'user-with-connector',
      role: 'user',
      content: '@juyuan\n\n帮我分析下啤酒股票',
      createdAt: 1,
      mcpPresets: [{ name: 'juyuan', display_name: '聚源' }],
    }]);

    expect(messages[0].content).toBe('帮我分析下啤酒股票');
    expect(messages[0].mcpPresets).toEqual([{ name: 'juyuan', display_name: '聚源' }]);
  });

  it('removes only the MCP token from a mixed capability prefix', () => {
    expect(stripRedundantMcpMentionPrefix(
      '@terminal @juyuan\n分析贵州茅台',
      [{ name: 'juyuan' }],
    )).toBe('@terminal\n分析贵州茅台');
  });

  it('does not rewrite natural-language connector references', () => {
    expect(stripRedundantMcpMentionPrefix(
      '请比较 @juyuan 的数据来源',
      [{ name: 'juyuan' }],
    )).toBe('请比较 @juyuan 的数据来源');
  });

  it('restores persisted public narration as an activity trace', () => {
    const messages = mapWebuiThreadToGuiMessages([{
      id: 'narration-history',
      role: 'tool',
      kind: 'trace',
      content: '',
      narration: 'I will inspect the detailed source articles.',
      narrationStreaming: false,
      createdAt: 1,
    }]);

    expect(messages[0]).toMatchObject({
      id: 'narration-history',
      role: 'tool',
      kind: 'trace',
      content: '',
      narration: 'I will inspect the detailed source articles.',
      narrationStreaming: false,
    });
  });

  it('keeps reasoning duration separate from whole-turn latency', () => {
    const completedAt = 1_785_222_083_788;
    const messages = mapWebuiThreadToGuiMessages([{
      id: 'assistant-latency',
      role: 'assistant',
      content: '完成',
      createdAt: 1,
      latencyMs: 548_000,
      reasoningStartedAt: 100,
      reasoningCompletedAt: 12_100,
      reasoningDurationMs: 12_000,
      completedAt,
    }]);

    expect(messages[0].thinkingDuration).toBe(12);
    expect(messages[0].turnDurationMs).toBe(548_000);
    expect(messages[0].thinkingStartedAt).toBe(100);
    expect(messages[0].thinkingCompletedAt).toBe(12_100);
    expect(messages[0].completedAt).toBe(completedAt);
  });

  it('does not expose serialized internal tool calls from gateway history', () => {
    const messages = mapWebuiThreadToGuiMessages([{
      id: 'assistant-protocol-leak',
      role: 'assistant',
      content: '<tool_call>\n<function=update_task_progress>\n</function>\n</tool_call>',
      createdAt: 1,
    }]);

    expect(messages[0].content).toBe('未能生成有效回复，请重试或继续询问当前进度。');
  });

  it('does not expose internal tool calls appended after assistant narration', () => {
    const messages = mapWebuiThreadToGuiMessages([{
      id: 'assistant-mixed-protocol-leak',
      role: 'assistant',
      content: '准备创建文件。<tool_call>\n<function=exec>\n<parameter=command>mkdir demo</parameter>\n</function>\n</tool_call>',
      createdAt: 1,
    }]);

    expect(messages[0].content).toBe('未能生成有效回复，请重试或继续询问当前进度。');
  });

  it('projects unclassified streamed text into Steps until it is final', () => {
    const [streaming] = mapWebuiThreadToGuiMessages([{
      id: 'provisional',
      role: 'assistant',
      content: '好的，我来启动工商银行投研团队。',
      isStreaming: true,
      streamId: 'stream-1',
      createdAt: 1,
    }]);

    expect(streaming.content).toBe('');
    expect(streaming.narration).toBe('好的，我来启动工商银行投研团队。');
    expect(streaming.narrationStreaming).toBe(true);

    const [completed] = mapWebuiThreadToGuiMessages([{
      id: 'final',
      role: 'assistant',
      content: '工商银行分析完成。',
      isStreaming: false,
      createdAt: 2,
    }]);
    expect(completed.content).toBe('工商银行分析完成。');
    expect(completed.narration).toBeUndefined();
  });

  it('preserves signed PDF preview and download metadata from gateway history', () => {
    const messages = mapWebuiThreadToGuiMessages([{
      id: 'assistant-pdf',
      role: 'assistant',
      content: '报告已生成',
      createdAt: 1,
      media: [{
        kind: 'file',
        url: '/api/media/sig/payload',
        download_url: '/api/media/sig/payload?download=1',
        name: 'report.pdf',
        mime_type: 'application/pdf',
        size: 2048,
      }],
    }]);

    expect(messages[0].mediaAttachments).toEqual([{
      id: undefined,
      url: '/api/media/sig/payload',
      downloadUrl: '/api/media/sig/payload?download=1',
      localPath: undefined,
      name: 'report.pdf',
      kind: 'file',
      mimeType: 'application/pdf',
      size: 2048,
    }]);
  });

  it('dedupes a generated artifact restored with a new signed URL', () => {
    const messages = mapWebuiThreadToGuiMessages([{
      id: 'assistant-html',
      role: 'assistant',
      content: '报告已生成',
      createdAt: 1,
      media: [
        {
          kind: 'file',
          url: '/api/media/streamed-signature/report',
          name: '上海咖啡馆研究.html',
          mime_type: 'text/html',
          size: 4096,
        },
        {
          kind: 'file',
          url: '/api/media/replayed-signature/report',
          local_path: '/workspace/上海咖啡馆研究.html',
          name: '上海咖啡馆研究.html',
          mime_type: 'text/html',
          size: 4096,
        },
      ],
    }]);

    expect(messages[0].mediaAttachments).toHaveLength(1);
    expect(messages[0].mediaAttachments?.[0]?.localPath).toBe('/workspace/上海咖啡馆研究.html');
  });
});
