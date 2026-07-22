type ToolStatus = 'running' | 'done' | 'error' | 'pending';

function subject(input?: Record<string, unknown>): string | undefined {
  for (const key of ['query', 'q', 'keyword', 'topic', 'name', 'ticker', 'symbol', 'code', 'path', 'file_path']) {
    const value = input?.[key];
    if (typeof value !== 'string' || !value.trim()) continue;
    const text = key.includes('path') ? value.split(/[\\/]/).filter(Boolean).pop() || value : value;
    return text.replace(/\s+/g, ' ').trim().slice(0, 36);
  }
  return undefined;
}

function commandSubject(command: string): string | undefined {
  const matches = [...command.matchAll(/["']?query["']?\s*:\s*["']([^"']+)/g)].map((match) => match[1].replace(/\s+/g, ' ').trim());
  return matches.length ? [...new Set(matches)].slice(0, 2).join('、').slice(0, 36) : undefined;
}

function quoted(value: string | undefined): string {
  return value ? `“${value}”` : '';
}

function skillName(input?: Record<string, unknown>): string | undefined {
  const path = typeof input?.path === 'string' ? input.path : typeof input?.file_path === 'string' ? input.file_path : '';
  return path.match(/[\\/]skills[\\/]([^\\/]+)[\\/]SKILL\.md$/i)?.[1];
}

function skillDescription(result?: string): string | undefined {
  const match = result?.match(/^description:\s*["']?(.+?)["']?\s*$/mi);
  return match?.[1].trim().slice(0, 46);
}

function skillTitle(result: string | undefined, fallback: string): string {
  return result?.match(/^#\s+(.+?)(?:\s*\([^)]*\))?\s*$/m)?.[1].trim() || fallback;
}

function skillCapabilities(result?: string): string | undefined {
  const ignored = /核心函数|调用示例|使用技巧|注意事项|限制/i;
  const sections = [...(result?.matchAll(/^##\s+(.+?)(?:工具)?\s*$/gm) ?? [])]
    .map((match) => match[1].trim())
    .filter((title) => !ignored.test(title));
  return sections.length ? [...new Set(sections)].slice(0, 3).join('、') : undefined;
}

export function toolActivityLabel(name: string, status: ToolStatus, input?: Record<string, unknown>, result?: string): string {
  const target = subject(input);
  const command = typeof input?.command === 'string' ? input.command : typeof input?.cmd === 'string' ? input.cmd : '';
  const query = commandSubject(command);
  if (status === 'error') {
    const failed = query || target;
    return failed ? `未完成${quoted(failed)}查询` : '当前步骤未完成';
  }
  const done = status === 'done';
  if (name === 'read_file') {
    const skill = skillName(input);
    if (skill) {
      const description = skillCapabilities(result) || skillDescription(result);
      const title = skillTitle(result, skill);
      return done
        ? `已启用${quoted(title)}技能${description ? `，可查询${description}等信息` : ''}`
        : `正在加载${quoted(skill)}技能`;
    }
    return done ? `已读取${quoted(target) || '所需资料'}` : `正在读取${quoted(target) || '所需资料'}`;
  }
  if (name === 'write_file' || name === 'edit_file' || name === 'apply_patch') return done ? '已更新文件内容' : '正在更新文件内容';
  if (name === 'write_stdin') return done ? '已获取后台命令输出' : '正在等待后台命令';
  if (name === 'web_search' || name === 'search_web') return done ? `已查到${quoted(target) || '相关'}公开资料` : `正在查找${quoted(target) || '相关'}公开资料`;
  if (name === 'web_fetch') {
    const url = typeof input?.url === 'string' ? input.url : '';
    let site = '';
    try { site = new URL(url).hostname.replace(/^www\./, ''); } catch { /* use a generic label */ }
    return done ? `已读取${quoted(site) || '网页'}资料` : `正在阅读${quoted(site) || '网页'}资料`;
  }
  if (name === 'list_dir' || name === 'find_files' || name === 'grep') return done ? '已定位所需资料' : '正在定位所需资料';
  if (name === 'exec' || name === 'run_shell_command') {
    const skill = command.match(/\/skills\/([^/\s]+)/)?.[1];
    if (query) return done ? `已完成${quoted(query)}数据查询` : `正在查询${quoted(query)}数据`;
    return skill ? (done ? '已完成专项数据查询' : '正在进行专项数据查询') : (done ? '已完成数据处理' : '正在处理数据');
  }
  if (name.startsWith('mcp_')) return done ? `已获取${quoted(target) || '所需'}外部数据` : `正在查询${quoted(target) || '所需'}外部数据`;
  return done ? '步骤已完成' : '正在处理任务';
}
