import { describe, expect, it } from 'vitest';
import { toolActivityLabel } from './toolDisplay';

describe('toolActivityLabel', () => {
  it('hides shell commands while retaining a useful task status', () => {
    expect(toolActivityLabel('exec', 'running', { command: "cd /tmp/skills/finance && call({ query: '雅克科技 财务状况' })" }))
      .toBe('正在查询“雅克科技 财务状况”数据');
    expect(toolActivityLabel('exec', 'done', { cmd: "call({ \"query\": \"比亚迪 行情\" }); call({query: '特斯拉 行情'})" }))
      .toBe('已完成“比亚迪 行情、特斯拉 行情”数据查询');
    expect(toolActivityLabel('exec', 'error', { command: "call({query: '沪电股份 估值'})" })).toBe('未完成“沪电股份 估值”查询');
    expect(toolActivityLabel('web_search', 'done', { query: '雅克科技 盈利能力' })).toBe('已查到“雅克科技 盈利能力”公开资料');
    expect(toolActivityLabel('web_fetch', 'running', { url: 'https://www.example.com/report' })).toBe('正在阅读“example.com”资料');
    expect(toolActivityLabel('write_stdin', 'running', { session_id: 'abc123' }))
      .toBe('正在等待后台命令');
  });
});
