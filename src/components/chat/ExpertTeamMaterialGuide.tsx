import { useEffect, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import type { ExpertTeamMaterialRequest, ExpertTeamRevisionRole } from '@/core/types';

function MaterialRequest({ item }: { item: ExpertTeamMaterialRequest }) {
  return <li className="min-w-0 space-y-1 border-b py-3 last:border-b-0">
    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
      <span className="font-medium">{item.title}</span>
      <span className={item.status === 'reported' ? 'text-amber-700 dark:text-amber-300' : 'text-muted-foreground'}>
        {item.status === 'reported' ? '报告待核验' : '建议核验'}
      </span>
    </div>
    <p>{item.data}</p>
    <dl className="material-request-meta text-muted-foreground">
      <dt>期间</dt><dd>{item.period}</dd>
      <dt>用途</dt><dd>{item.purpose}</dd>
      <dt>来源</dt><dd>{item.source}</dd>
    </dl>
    <p className="text-muted-foreground">{item.basis}</p>
  </li>;
}

export default function ExpertTeamMaterialGuide({ role, period }: { role: ExpertTeamRevisionRole; period: string }) {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState('');
  const [preview, setPreview] = useState(false);
  const prompt = role.research_prompt ? [
    ...(period.trim() ? [`本次指定资料期间：${period.trim()}。优先按此期间搜集资料；原报告期间仅用于对照。`, ''] : []),
    role.research_prompt,
  ].join('\n') : '';

  useEffect(() => { setCopied(false); setCopyError(''); }, [prompt]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied(true);
      setCopyError('');
    } catch {
      setCopyError('剪贴板不可用，请在下方选中提示词复制');
      setPreview(true);
    }
  };

  const requests = role.material_requests || [];
  return <section aria-label={`${role.name}资料需求`} className="material-guide min-w-0 py-3 text-xs leading-5">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h3 className="min-w-0 font-medium">{role.name}{role.framework ? ` · ${role.framework}` : ''}</h3>
      {prompt && <Button type="button" variant="outline" size="sm" onClick={() => void copy()} aria-label={`复制${role.name}补充资料提示词`}>
        {copied ? <Check /> : <Copy />}{copied ? '已复制' : '复制提示词'}
      </Button>}
    </div>
    {requests.length > 0 ? <>
      <ul className="min-w-0">{requests.slice(0, 3).map((item) => <MaterialRequest key={item.title} item={item} />)}</ul>
      {requests.length > 3 && <details className="mt-1">
        <summary className="cursor-pointer text-muted-foreground">其余 {requests.length - 3} 项资料</summary>
        <ul>{requests.slice(3).map((item) => <MaterialRequest key={item.title} item={item} />)}</ul>
      </details>}
    </> : <p className="py-2 text-muted-foreground">建议核验：{role.recommended_materials.join('；') || '原角色报告中的证据与来源'}</p>}
    {role.framework_prompt && <details className="mt-2">
      <summary className="cursor-pointer font-medium">研究框架<span className="ml-2 font-normal text-muted-foreground">{role.framework_source}</span></summary>
      <p className="mt-2 whitespace-pre-wrap text-muted-foreground">{role.framework_prompt}</p>
    </details>}
    {prompt && <details className="mt-2" open={preview} onToggle={(event) => setPreview(event.currentTarget.open)}>
      <summary className="cursor-pointer font-medium">完整补充资料提示词</summary>
      <Textarea readOnly value={prompt} aria-label={`${role.name}完整补充资料提示词`} className="mt-2 h-52 resize-y text-xs leading-5" />
    </details>}
    {copyError && <p role="alert" className="mt-2 text-red-600">{copyError}</p>}
    {copied && <span role="status" className="sr-only">{role.name}提示词已复制</span>}
  </section>;
}
