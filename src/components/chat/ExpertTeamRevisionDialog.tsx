import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, FilePlus2, Loader2, Play, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { getNanobotClient } from '@/core/nanobotClient';
import type { ExpertTeamRevisionContext, ExpertTeamRevisionPlan } from '@/core/types';
import ExpertTeamMaterialGuide from './ExpertTeamMaterialGuide';
import './expertTeamRevision.css';

export type RevisionAction = (runId: string, roleId: string, mode: 'supplement' | 'retry') => void;

interface Props {
  chatId: string;
  runId: string;
  roleId: string;
  mode: 'supplement' | 'retry';
  disabled?: boolean;
  onClose: () => void;
  onStart: (plan: ExpertTeamRevisionPlan) => boolean;
}

function encodeFile(file: File): Promise<{ name: string; base64: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`无法读取 ${file.name}`));
    reader.onload = () => resolve({ name: file.name, base64: String(reader.result).split(',')[1] });
    reader.readAsDataURL(file);
  });
}

export default function ExpertTeamRevisionDialog({ chatId, runId, roleId, mode, disabled, onClose, onStart }: Props) {
  const [context, setContext] = useState<ExpertTeamRevisionContext | null>(null);
  const [roles, setRoles] = useState([roleId]);
  const [shared, setShared] = useState(false);
  const [text, setText] = useState('');
  const [period, setPeriod] = useState('');
  const [links, setLinks] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [plan, setPlan] = useState<ExpertTeamRevisionPlan | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const mounted = useRef(false);
  const submitting = useRef(false);
  const picker = useRef<HTMLInputElement>(null);
  const preparedPlan = useRef<string | null>(null);

  useEffect(() => {
    mounted.current = true;
    let cancelled = false;
    getNanobotClient().revisionContext(chatId, runId).then((result) => {
      if (!cancelled) setContext(result);
    }).catch((cause: unknown) => {
      if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
    });
    return () => {
      cancelled = true;
      mounted.current = false;
      if (preparedPlan.current) getNanobotClient().discardRevision(chatId, preparedPlan.current);
    };
  }, [chatId, runId]);

  const role = context?.roles.find((item) => item.id === roleId);
  const roleNames = (ids: string[]) => ids.map((id) => context?.roles.find((item) => item.id === id)?.name || id).join('、') || '无';

  const prepare = async () => {
    if (!context || submitting.current || disabled) return;
    submitting.current = true;
    setBusy(true);
    setError('');
    try {
      const encoded = [];
      for (const file of files) encoded.push(await encodeFile(file));
      if (!mounted.current) return;
      const result = await getNanobotClient().prepareRevision(chatId, {
        run_id: runId, checkpoint_revision: context.checkpoint_revision,
        roles, text, period, links: links.split(/\r?\n/).map((link) => link.trim()).filter(Boolean),
        files: encoded,
      });
      if (mounted.current) {
        if (preparedPlan.current) getNanobotClient().discardRevision(chatId, preparedPlan.current);
        preparedPlan.current = result.plan_id;
        setPlan(result);
      } else getNanobotClient().discardRevision(chatId, result.plan_id);
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      submitting.current = false;
      if (mounted.current) setBusy(false);
    }
  };

  const start = () => {
    if (!plan || submitting.current || disabled) return;
    submitting.current = true;
    try {
      if (onStart(plan)) { setBusy(true); onClose(); }
      else { submitting.current = false; setError('任务未启动，请确认网关连接和模型配置'); }
    } catch (cause) {
      submitting.current = false;
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="expert-team-revision relative max-h-[85dvh] max-w-xl overflow-y-auto rounded-lg p-5 text-sm tracking-normal">
        <DialogTitle className="pr-7 text-base leading-6 tracking-normal">
          {context?.target || '研究结果'} · {plan ? `确认更新 v${plan.version}` : mode === 'retry' ? '重试角色' : '补充资料'}
        </DialogTitle>
        <DialogDescription className="break-words text-xs">{role?.name || '角色记录'}{role ? ` · ${role.reason}` : ''}</DialogDescription>
        {!context && !error && <div role="status" className="flex items-center gap-2"><Loader2 className="size-4 animate-spin" />读取研究记录</div>}
        {context && !plan && <>
          <div className="min-w-0 border-y text-xs leading-5">
            <p className="pt-3 font-medium">待补充与核验资料</p>
            {context.roles.filter((item) => roles.includes(item.id)).map((item) => <ExpertTeamMaterialGuide key={item.id} role={item} period={period} />)}
            {roles.length === 0 && <p className="py-3 text-muted-foreground">请选择更新角色</p>}
          </div>
          <fieldset disabled={busy || disabled} className="min-w-0 space-y-3">
            <label className="block space-y-1 text-xs">资料期间
              <Input value={period} maxLength={120} onChange={(event) => setPeriod(event.target.value)} placeholder="例如：2026 年中报、截至 2026-06-30" />
              {context.research_period && <p className="text-muted-foreground">原报告期间：{context.research_period}</p>}
            </label>
            <label className="block space-y-1 text-xs">补充内容
              <Textarea value={text} maxLength={30000} onChange={(event) => setText(event.target.value)} className="min-h-24 resize-y" placeholder="财务数据、公告摘录、需要更正的结论" />
            </label>
            <label className="block space-y-1 text-xs">资料链接
              <Textarea value={links} onChange={(event) => setLinks(event.target.value)} rows={2} placeholder="https://..." />
            </label>
            <div>
              <input ref={picker} aria-label="选择补充文件" type="file" multiple accept=".pdf,.docx,.xlsx,.pptx,.txt,.md,.csv" className="hidden" onChange={(event) => {
                const added = Array.from(event.target.files || []);
                const next = [...files, ...added];
                if (next.length > 6 || next.some((file) => file.size > 8 * 1024 * 1024) || next.reduce((size, file) => size + file.size, 0) > 16 * 1024 * 1024) {
                  setError('最多 6 个文件，单文件 8 MB，合计 16 MB');
                } else { setFiles(next); setError(''); }
                event.target.value = '';
              }} />
              <Button variant="outline" size="sm" onClick={() => picker.current?.click()}><FilePlus2 />添加文件</Button>
              <span className="ml-2 text-xs text-muted-foreground">PDF / Office / TXT / MD / CSV</span>
              <ul className="mt-2 space-y-1">
                {files.map((file, index) => <li key={`${file.name}-${index}`} className="flex min-w-0 items-center gap-2 text-xs">
                  <span className="min-w-0 flex-1 break-all">{file.name}</span>
                  <span className="shrink-0 text-muted-foreground">待核验</span>
                  <Button size="icon-xs" variant="ghost" title={`移除 ${file.name}`} aria-label={`移除 ${file.name}`} onClick={() => setFiles((items) => items.filter((_, i) => i !== index))}><Trash2 /></Button>
                </li>)}
              </ul>
            </div>
            <fieldset className="border-t pt-3">
              <legend className="font-medium">更新角色</legend>
              <div className="grid grid-cols-2 gap-2 py-2">
                {context.roles.map((item) => <label key={item.id} className="flex items-start gap-2 text-xs">
                  <input type="checkbox" className="mt-0.5 accent-primary" checked={roles.includes(item.id)} disabled={shared} onChange={(event) => setRoles((current) => event.target.checked ? [...current, item.id] : current.filter((id) => id !== item.id))} />
                  <span>{item.name}<span className="block text-muted-foreground">{item.cached ? item.status === 'completed' ? '结果已缓存' : '原结果已降级' : '缓存不可用'}</span></span>
                </label>)}
              </div>
              <label className="flex items-start gap-2 text-xs">
                <input type="checkbox" className="mt-0.5 accent-primary" checked={shared} onChange={(event) => { setShared(event.target.checked); setRoles(event.target.checked ? context.roles.map((item) => item.id) : [roleId]); }} />
                本次更正涉及共用财务数据（更新四个角色）
              </label>
            </fieldset>
          </fieldset>
        </>}
        {plan && <dl className="space-y-3 border-y py-4 text-sm">
          <div><dt className="text-xs text-muted-foreground">更新</dt><dd className="mt-1 break-words">{roleNames(plan.selected_roles)}、主笔汇总、报告审校</dd></div>
          <div><dt className="text-xs text-muted-foreground">复用</dt><dd className="mt-1 break-words">{roleNames(plan.reused_roles)}</dd></div>
          <div><dt className="text-xs text-muted-foreground">基础资料</dt><dd className="mt-1">{plan.base_cached ? '复用已缓存的数据包' : '旧任务未保存数据包，引用已有角色报告'}</dd></div>
          <div><dt className="text-xs text-muted-foreground">资料核验</dt><dd className="mt-1">{files.length} 个文件 · {links.split(/\r?\n/).filter((link) => link.trim()).length} 个链接{text.trim() ? ' · 补充文字' : ''} · 待核验</dd></div>
          <div><dt className="text-xs text-muted-foreground">交付</dt><dd className="mt-1">报告 v{plan.version}、变更摘要及剩余缺口；保留原版</dd></div>
        </dl>}
        {error && <p role="alert" className="break-words text-xs text-red-600">{error}</p>}
        {disabled && <p role="status" className="text-xs text-muted-foreground">当前会话正在执行任务，暂不能启动更新</p>}
        <div className="flex flex-wrap justify-end gap-2">
          {plan && <Button variant="ghost" onClick={() => { setPlan(null); setError(''); }}><ArrowLeft />返回修改</Button>}
          <Button variant="outline" onClick={onClose}>取消</Button>
          {context && (plan
            ? <Button disabled={busy || disabled} onClick={start}><Play />确认更新 v{plan.version}</Button>
            : <Button disabled={busy || disabled || roles.length === 0} onClick={() => void prepare()}>{busy ? <Loader2 className="animate-spin" /> : <ArrowRight />}查看更新范围</Button>)}
        </div>
      </DialogContent>
    </Dialog>
  );
}
