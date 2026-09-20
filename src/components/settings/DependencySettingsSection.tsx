import { useEffect, useState } from 'react';
import { CheckCircle2, Loader2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Toggle } from '@/components/ui/toggle';
import { checkPackageSources, fetchPackageSources, savePackageSources } from '@/core/api';
import type { PackageSourcesPayload, PackageSourcesSettings } from '@/core/types';

export default function DependencySettingsSection({ token, apiBase, isEnglish }: {
  token: string; apiBase: string; isEnglish: boolean;
}) {
  const [payload, setPayload] = useState<PackageSourcesPayload | null>(null);
  const [form, setForm] = useState<PackageSourcesSettings | null>(null);
  const [busy, setBusy] = useState('load');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const text = (zh: string, en: string) => isEnglish ? en : zh;
  const apply = (next: PackageSourcesPayload) => {
    setPayload(next);
    setForm({ enabled: next.enabled, npm_registry: next.npm_registry, pypi_index_url: next.pypi_index_url, workspace_python: next.workspace_python });
  };

  useEffect(() => {
    if (!token || !apiBase) return;
    let active = true;
    fetchPackageSources(token, apiBase)
      .then((next) => { if (active) apply(next); })
      .catch((err: unknown) => { if (active) setError(err instanceof Error ? err.message : String(err)); })
      .finally(() => { if (active) setBusy(''); });
    return () => { active = false; };
  }, [token, apiBase]);

  const run = async (action: 'save' | 'check' | 'load') => {
    setBusy(action); setError(''); setMessage('');
    try {
      if (action === 'save' && form) {
        const next = await savePackageSources(token, form, apiBase);
        apply(next);
        setMessage(next.requires_restart
          ? text('已保存，新命令立即生效。现有 MCP 需要重启软件后使用新配置。', 'Saved for new commands. Restart the app to apply it to existing MCP processes.')
          : next.mcp_reload_error
            ? text('已保存，新命令立即生效。部分 MCP 尚未连接，请到工具箱检查。', 'Saved for new commands. Check disconnected MCP servers in the toolbox.')
            : text('已保存，后续任务和 MCP 将使用此配置。', 'Saved. New tasks and MCP processes will use these settings.'));
      } else if (action === 'check') {
        setPayload(await checkPackageSources(token, apiBase));
      } else {
        apply(await fetchPackageSources(token, apiBase));
      }
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setBusy(''); }
  };

  const dirty = !!(form && payload && Object.entries(form).some(([key, value]) => value !== payload[key as keyof PackageSourcesSettings]));
  return <section className="mx-auto max-w-3xl space-y-5" data-dependency-settings>
    <p className="text-[13px] leading-6 text-[var(--cowork-text)]">{text('统一设置技能、代码任务和 MCP 安装依赖时使用的包源。配置仅用于软件任务环境。', 'Choose package sources for skills, code tasks, and MCP. These settings apply to this app’s task environments.')}</p>
    {error && <div role="alert" className="rounded-lg bg-red-500/10 p-3 text-[13px] text-red-600 dark:text-red-300">{error}<Button variant="ghost" size="sm" onClick={() => void run('load')} disabled={!!busy}>{text('重新加载', 'Reload')}</Button></div>}
    {message && <p role="status" className="text-[13px] text-[var(--cowork-blue)]">{message}</p>}
    {payload?.mcp_reload_error && <p role="alert" className="rounded-lg border border-[var(--cowork-line)] p-3 text-[13px] text-[var(--cowork-text)]">{payload.mcp_reload_error}</p>}
    {!form ? busy && <Loader2 className="size-5 animate-spin text-[var(--cowork-muted)]" /> : <>
      <div className="space-y-5 rounded-2xl border border-[var(--cowork-line)] bg-[var(--cowork-surface)] p-5">
        <div className="flex items-center justify-between gap-4">
          <div><h3 className="text-sm font-semibold">{text('使用指定包源', 'Use configured sources')}</h3><p className="mt-1 text-xs text-[var(--cowork-muted)]">{text('关闭后使用运行环境原有的包源设置。', 'When off, use the runtime’s existing package defaults.')}</p></div>
          <Toggle checked={form.enabled} onChange={() => setForm({ ...form, enabled: !form.enabled })} aria-label={text('使用指定包源', 'Use configured sources')} disabled={!!busy} />
        </div>
        <div className="flex justify-end"><Button variant="outline" size="sm" disabled={!!busy} onClick={() => setForm({ ...form, enabled: true, npm_registry: 'http://10.94.211.66/repository/npm_mirror/', pypi_index_url: 'http://10.94.211.66/repository/officialPypi/simple/' })}>{text('填入公司内网源', 'Use company preset')}</Button></div>
        <label className="block space-y-2 text-[13px]"><span>npm / npx</span><Input value={form.npm_registry} disabled={!form.enabled || !!busy} onChange={(event) => setForm({ ...form, npm_registry: event.target.value })} /></label>
        <label className="block space-y-2 text-[13px]"><span>Python / pip / uv</span><Input value={form.pypi_index_url} disabled={!form.enabled || !!busy} onChange={(event) => setForm({ ...form, pypi_index_url: event.target.value })} /><span className="block text-xs text-[var(--cowork-muted)]">{text('Python 地址需以 /simple/ 结尾；HTTP 源会仅信任该主机。', 'Python URLs must end in /simple/. HTTP trust is limited to that host.')}</span></label>
      </div>
      <div className="rounded-2xl border border-[var(--cowork-line)] bg-[var(--cowork-surface)] p-5">
        <div className="flex items-center justify-between gap-4"><div><h3 className="text-sm font-semibold">{text('工作空间 Python 环境', 'Workspace Python environment')}</h3><p className="mt-1 text-xs leading-5 text-[var(--cowork-muted)]">{text('首次运行命令时用内置 Python 创建 .venv，安装依赖和运行脚本共用此环境。', 'Create .venv with the bundled Python on the first command; use it for both dependencies and scripts.')}</p></div><Toggle checked={form.workspace_python} onChange={() => setForm({ ...form, workspace_python: !form.workspace_python })} aria-label={text('工作空间 Python 环境', 'Workspace Python environment')} disabled={!!busy} /></div>
        <dl className="mt-4 space-y-2 text-xs text-[var(--cowork-text)]">{(['python_path', 'node_path', 'npm_path'] as const).map((key) => <div key={key} className="grid grid-cols-[60px_1fr] gap-3"><dt>{key.replace('_path', '')}</dt><dd className="break-all">{payload?.[key] || text('未找到，请检查软件运行环境', 'Unavailable; check the app runtime')}</dd></div>)}</dl>
      </div>
      {payload?.checks && <div aria-live="polite" className="space-y-2">{payload.checks.map((check) => <div key={check.name} className="rounded-lg border border-[var(--cowork-line)] p-3 text-[13px]"><span className="font-medium">{check.name} · {check.ok ? text('可访问', 'Reachable') : text('检查失败', 'Check failed')}</span>{check.ok ? <CheckCircle2 className="ml-2 inline size-4 text-emerald-600" /> : <p className="mt-1 break-words text-[var(--cowork-text)]">{check.code}: {check.message}</p>}</div>)}<p className="text-xs text-[var(--cowork-muted)]">{text('检查查询示例包信息；实际安装还取决于包版本和平台。', 'Checks query sample package metadata. Installation also depends on the package version and platform.')}</p></div>}
      <div className="flex justify-end gap-2"><Button variant="outline" disabled={!!busy || dirty || !payload?.enabled} onClick={() => void run('check')}>{busy === 'check' ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}{text('检查已保存配置', 'Check saved settings')}</Button><Button disabled={!!busy || !dirty} onClick={() => void run('save')}>{busy === 'save' && <Loader2 className="size-4 animate-spin" />}{text('保存', 'Save')}</Button></div>
    </>}
  </section>;
}
