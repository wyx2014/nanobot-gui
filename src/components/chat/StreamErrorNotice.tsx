import { AlertTriangle, ShieldCheck, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { StreamError } from '@/core/nanobot-client';

interface StreamErrorNoticeProps {
  error: StreamError;
  canUseFullAccess?: boolean;
  onDismiss: () => void;
  onAllowFullAccess?: () => void;
}

export default function StreamErrorNotice({
  error,
  canUseFullAccess = true,
  onDismiss,
  onAllowFullAccess,
}: StreamErrorNoticeProps) {
  const copy = resolveCopy(error);
  const canUpgrade = error.kind === 'workspace_access_required' && canUseFullAccess && !!onAllowFullAccess;

  return (
    <div
      role="alert"
      aria-live="assertive"
      className="mb-2 flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-[12.5px] leading-5 text-amber-900 shadow-sm"
    >
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-[#29261b]">{copy.title}</p>
        <p className="mt-0.5 text-[#656358]">{copy.body}</p>
        {canUpgrade ? (
          <Button
            type="button"
            size="sm"
            onClick={onAllowFullAccess}
            className="mt-2 h-8 rounded-lg bg-[#29261b] px-3 text-[12.5px] text-white hover:bg-[#3d3929]"
          >
            <ShieldCheck className="mr-1.5 h-3.5 w-3.5" />
            切换完全访问并重试
          </Button>
        ) : null}
      </div>
      <button
        type="button"
        onClick={onDismiss}
        className="rounded-md p-1 text-amber-700 hover:bg-amber-100 hover:text-amber-900"
        aria-label="关闭提示"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

function resolveCopy(error: StreamError): { title: string; body: string } {
  switch (error.kind) {
    case 'message_too_big':
      return {
        title: '消息过大',
        body: '这次发送的内容超过了网关限制，请减少附件或拆成多次发送。',
      };
    case 'workspace_scope_rejected':
      return {
        title: '工作区权限未生效',
        body: 'TPCowork 拒绝了请求的工作区或权限模式，请确认路径有效后再试。',
      };
    case 'workspace_access_required':
      return {
        title: '需要完全访问权限',
        body: '当前默认权限会限制命令访问工作文件夹外的路径。你可以授权本次会话切换到完全访问，然后自动重试刚才的请求。',
      };
    default: {
      const _exhaustive: never = error;
      return { title: String(_exhaustive), body: '' };
    }
  }
}
