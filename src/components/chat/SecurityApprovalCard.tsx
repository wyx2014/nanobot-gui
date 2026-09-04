import { useEffect, useState } from 'react';
import { Check, FilePenLine, Loader2, ShieldAlert, Terminal, X } from 'lucide-react';
import type { UISecurityApproval } from '@/core/types';

interface SecurityApprovalCardProps {
  approval: UISecurityApproval;
  onRespond: (decision: 'allow_turn' | 'deny') => boolean;
}

function toolLabel(toolName: string): string {
  if (toolName === 'exec') return '命令执行';
  if (toolName === 'write_file') return '写入文件';
  if (toolName === 'edit_file') return '编辑文件';
  if (toolName === 'apply_patch') return '修改文件';
  return toolName;
}

function isFileTool(toolName: string): boolean {
  return toolName === 'write_file' || toolName === 'edit_file' || toolName === 'apply_patch';
}

export default function SecurityApprovalCard({ approval, onRespond }: SecurityApprovalCardProps) {
  const [submitting, setSubmitting] = useState<'allow_turn' | 'deny' | null>(null);

  useEffect(() => {
    setSubmitting(null);
  }, [approval.approval_id]);

  const respond = (decision: 'allow_turn' | 'deny') => {
    if (submitting || !onRespond(decision)) return;
    setSubmitting(decision);
  };

  return (
    <section
      data-security-approval-card
      className="mx-auto mb-2.5 w-full max-w-[760px] overflow-hidden rounded-lg border border-[#ded9d0] border-l-[3px] border-l-[#b65f3f] bg-[#fffefa] shadow-[0_2px_8px_rgba(45,38,31,0.06)] dark:border-[#4b4742] dark:border-l-[#d47a5a] dark:bg-[#272624]"
      aria-label="高风险操作确认"
    >
      <div className="px-3.5 py-3">
        <div className="flex items-start gap-2.5">
          <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-md bg-[#f7e8df] text-[#a75032] dark:bg-[#4a352d] dark:text-[#efaa8d]">
            <ShieldAlert className="h-3.5 w-3.5" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <h3 className="text-[13px] font-semibold leading-5 text-[#342f2b] dark:text-[#f1ece6]">确认高风险操作</h3>
              <span className="rounded-[4px] bg-[#f3efea] px-1.5 py-0.5 text-[10.5px] font-medium leading-4 text-[#70675f] dark:bg-[#373431] dark:text-[#c7beb6]">
                {toolLabel(approval.tool_name)}
              </span>
            </div>
            <p className="mt-0.5 text-[12px] leading-[18px] text-[#746b63] dark:text-[#bcb3ab]">{approval.summary}</p>
          </div>
        </div>

        {approval.target ? (
          <div className="mt-2 flex min-w-0 items-start gap-2 rounded-md border border-[#e9e5de] bg-[#f7f5f1] px-2.5 py-1.5 dark:border-[#403d39] dark:bg-[#201f1d]">
            {isFileTool(approval.tool_name) ? (
              <FilePenLine className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#81776f] dark:text-[#a79d95]" />
            ) : (
              <Terminal className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#81776f] dark:text-[#a79d95]" />
            )}
            <code
              className="max-h-[42px] min-w-0 overflow-auto whitespace-pre-wrap break-all text-[11.5px] leading-[18px] text-[#403a35] dark:text-[#ddd6cf]"
              title={approval.target}
            >
              {approval.target}
            </code>
          </div>
        ) : null}

        <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2">
          <p className="min-w-0 text-[11px] leading-4 text-[#8a827a] dark:text-[#9f9790]">
            仅对当前轮同类操作有效
          </p>
          <div className="ml-auto flex shrink-0 items-center gap-1.5">
            <button
              type="button"
              disabled={submitting !== null}
              onClick={() => respond('deny')}
              className="inline-flex h-7 items-center gap-1 whitespace-nowrap rounded-md border border-[#d8d3cb] bg-transparent px-2.5 text-[11.5px] font-medium text-[#5d5751] transition-colors hover:bg-[#f2efea] disabled:opacity-60 dark:border-[#504c47] dark:text-[#d8d1ca] dark:hover:bg-[#35322f]"
            >
              {submitting === 'deny' ? <Loader2 className="h-3 w-3 animate-spin" /> : <X className="h-3 w-3" />}
              拒绝
            </button>
            <button
              type="button"
              disabled={submitting !== null}
              onClick={() => respond('allow_turn')}
              className="inline-flex h-7 items-center gap-1 whitespace-nowrap rounded-md bg-[#ad5739] px-2.5 text-[11.5px] font-medium text-white transition-colors hover:bg-[#98492f] disabled:opacity-60 dark:bg-[#c66d4d] dark:hover:bg-[#b65f42]"
            >
              {submitting === 'allow_turn' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
              允许本轮同类操作
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
