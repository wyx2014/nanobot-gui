import { describe, expect, it } from 'vitest';
import {
  LEGACY_LOCAL_FILE_CONTEXT_HEADER,
  LOCAL_PATH_CONTEXT_HEADER,
  projectLegacyLocalFileContext,
  replaceVisibleLocalFileContent,
} from './localFileContext';

describe('legacy local file context projection', () => {
  it('separates macOS file references from the visible user prompt', () => {
    const wireContent = [
      LEGACY_LOCAL_FILE_CONTEXT_HEADER,
      '- skill-card.md: /Users/wyx/Desktop/skill-card.md',
      '- 持仓.xlsx: /Users/wyx/Desktop/持仓.xlsx',
      '这些文件写得怎么样',
    ].join('\n');

    expect(projectLegacyLocalFileContext(wireContent)).toEqual({
      visibleContent: '这些文件写得怎么样',
      files: [
        { name: 'skill-card.md', path: '/Users/wyx/Desktop/skill-card.md' },
        { name: '持仓.xlsx', path: '/Users/wyx/Desktop/持仓.xlsx' },
      ],
      contextPrefix: [
        LEGACY_LOCAL_FILE_CONTEXT_HEADER,
        '- skill-card.md: /Users/wyx/Desktop/skill-card.md',
        '- 持仓.xlsx: /Users/wyx/Desktop/持仓.xlsx',
      ].join('\n'),
    });
  });

  it('supports Windows paths and filenames containing a colon', () => {
    const wireContent = [
      LEGACY_LOCAL_FILE_CONTEXT_HEADER,
      '- 风险:明细.xlsx: C:\\Users\\alice\\风险明细.xlsx',
      '',
      '分析风险',
    ].join('\r\n');

    const projection = projectLegacyLocalFileContext(wireContent);
    expect(projection.visibleContent).toBe('分析风险');
    expect(projection.files).toEqual([{
      name: '风险:明细.xlsx',
      path: 'C:\\Users\\alice\\风险明细.xlsx',
    }]);
  });

  it('projects typed file and folder path references without leaking transport labels', () => {
    const wireContent = [
      LOCAL_PATH_CONTEXT_HEADER,
      '- [folder] reports: /Users/wyx/project/reports',
      '- [file] brief.md: /Users/wyx/project/brief.md',
      '汇总这些资料',
    ].join('\n');

    expect(projectLegacyLocalFileContext(wireContent)).toEqual({
      visibleContent: '汇总这些资料',
      files: [
        { kind: 'folder', name: 'reports', path: '/Users/wyx/project/reports' },
        { kind: 'file', name: 'brief.md', path: '/Users/wyx/project/brief.md' },
      ],
      contextPrefix: [
        LOCAL_PATH_CONTEXT_HEADER,
        '- [folder] reports: /Users/wyx/project/reports',
        '- [file] brief.md: /Users/wyx/project/brief.md',
      ].join('\n'),
    });
  });

  it('does not rewrite similar natural-language text without a valid file path', () => {
    const content = `${LEGACY_LOCAL_FILE_CONTEXT_HEADER}\n这只是解释，不是文件`;
    expect(projectLegacyLocalFileContext(content)).toEqual({
      visibleContent: content,
      files: [],
    });
  });

  it('preserves file context when the visible prompt is edited', () => {
    const original = [
      LEGACY_LOCAL_FILE_CONTEXT_HEADER,
      '- report.pdf: /Users/wyx/report.pdf',
      '旧问题',
    ].join('\n');

    expect(replaceVisibleLocalFileContent(original, '新问题')).toBe([
      LEGACY_LOCAL_FILE_CONTEXT_HEADER,
      '- report.pdf: /Users/wyx/report.pdf',
      '新问题',
    ].join('\n'));
  });
});
