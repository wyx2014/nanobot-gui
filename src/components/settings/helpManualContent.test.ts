import { describe, expect, it } from 'vitest';
import {
  HELP_MANUAL_CHAPTERS,
  searchHelpManual,
} from './helpManualContent';

describe('help manual content', () => {
  it('covers the complete task-oriented information architecture', () => {
    expect(HELP_MANUAL_CHAPTERS.map((chapter) => chapter.id)).toEqual([
      'quick-start',
      'conversations',
      'task-execution',
      'files-artifacts',
      'workspaces-permissions',
      'asset-research-team',
      'automations',
      'skills',
      'mcp-web',
      'models-voice',
      'personalization-settings',
      'troubleshooting',
    ]);
  });

  it('searches titles, summaries, keywords, and article text using all terms', () => {
    expect(searchHelpManual('投研 数据源', 'zh').map((chapter) => chapter.id))
      .toContain('asset-research-team');
    expect(searchHelpManual('microphone ASR', 'en').map((chapter) => chapter.id))
      .toContain('models-voice');
    expect(searchHelpManual('不存在的功能名称', 'zh')).toEqual([]);
    expect(searchHelpManual('', 'zh')).toHaveLength(HELP_MANUAL_CHAPTERS.length);
  });

  it('documents current high-risk behavior instead of obsolete product claims', () => {
    const manual = HELP_MANUAL_CHAPTERS.map((chapter) => chapter.zh.body).join('\n');

    expect(manual).toContain('普通文件当前不会复制成远端云附件');
    expect(manual).toContain('单个可提取文档上限为 50 MB');
    expect(manual).toContain('归档工作空间会将工作空间及其会话从侧栏隐藏');
    expect(manual).toContain('每月：选择日期、小时和分钟');
    expect(manual).toContain('当前编辑器不提供任意 cron 表达式输入');
    expect(manual).toContain('stdio');
    expect(manual).toContain('HTTP');
    expect(manual).toContain('SSE');
  });

  it('explains every runtime-owned asset research workflow stage', () => {
    const chapter = HELP_MANUAL_CHAPTERS.find((item) => item.id === 'asset-research-team');
    expect(chapter?.zh.body).toContain('建立基础数据包');
    expect(chapter?.zh.body).toContain('四位专家并行研究');
    expect(chapter?.zh.body).toContain('主笔交叉质证与汇总');
    expect(chapter?.zh.body).toContain('报告审校与交付');
    expect(chapter?.zh.body).toContain('同花顺 iFinD、聚源、财汇');
    expect(chapter?.zh.body).toContain('不会提前创建会话或启动任务');
    expect(chapter?.zh.body).toContain('填写具体需求并发送后');
  });
});
