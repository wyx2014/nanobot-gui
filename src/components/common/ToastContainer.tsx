import { useToastStore } from '@/stores/toastStore';
import { X, CheckCircle, AlertCircle, Info } from 'lucide-react';
import { cn } from '@/lib/utils';

const iconMap = {
  success: CheckCircle,
  error: AlertCircle,
  info: Info,
};

const colorMap = {
  success: {
    bg: 'bg-green-50 border-green-200',
    icon: 'text-green-500',
    title: 'text-green-800',
    message: 'text-green-600',
  },
  error: {
    bg: 'bg-red-50 border-red-200',
    icon: 'text-red-500',
    title: 'text-red-800',
    message: 'text-red-600',
  },
  info: {
    bg: 'bg-blue-50 border-blue-200',
    icon: 'text-blue-500',
    title: 'text-blue-800',
    message: 'text-blue-600',
  },
};

export default function ToastContainer() {
  const { toasts, removeToast } = useToastStore();

  if (toasts.length === 0) return null;

  return (
    <div
      className="window-toast-container window-titlebar-no-drag fixed right-4 z-[100] flex flex-col gap-2 pointer-events-none"
      aria-live="polite"
      role="status"
    >
      {toasts.map((toast) => {
        const Icon = iconMap[toast.type];
        const colors = colorMap[toast.type];

        return (
          <div
            key={toast.id}
            role={toast.onClick ? 'button' : undefined}
            tabIndex={toast.onClick ? 0 : undefined}
            onClick={() => {
              if (!toast.onClick) return;
              toast.onClick();
              removeToast(toast.id);
            }}
            onKeyDown={(event) => {
              if (!toast.onClick || (event.key !== 'Enter' && event.key !== ' ')) return;
              event.preventDefault();
              toast.onClick();
              removeToast(toast.id);
            }}
            className={cn(
              'pointer-events-auto flex items-start gap-2.5 px-4 py-3 rounded-xl border shadow-lg max-w-[360px] animate-in slide-in-from-right-5 fade-in duration-200',
              toast.onClick && 'cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#d97757]/40',
              colors.bg
            )}
          >
            <Icon className={cn('h-4 w-4 mt-0.5 shrink-0', colors.icon)} />
            <div className="flex-1 min-w-0">
              <p className={cn('text-[13px] font-medium', colors.title)}>
                {toast.title}
              </p>
              {toast.message && (
                <p className={cn('text-[12px] mt-0.5', colors.message)}>
                  {toast.message}
                </p>
              )}
            </div>
            <button
              type="button"
              aria-label="Close"
              onClick={(event) => {
                event.stopPropagation();
                removeToast(toast.id);
              }}
              onPointerDown={(event) => event.stopPropagation()}
              onKeyDown={(event) => event.stopPropagation()}
              className={cn(
                'grid h-7 w-7 shrink-0 place-items-center rounded-md hover:bg-black/5',
                colors.icon,
              )}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
