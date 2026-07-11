import { memo, useEffect, useId, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { renderMermaidSvg } from '@/core/mermaid';

interface MermaidBlockProps {
  code: string;
  className?: string;
}

type RenderState =
  | { status: 'loading' }
  | { status: 'ready'; svg: string }
  | { status: 'error'; message: string };

function normalizeId(id: string) {
  return `mermaid-${id.replace(/[^a-zA-Z0-9_-]/g, '')}`;
}

export default memo(function MermaidBlock({ code, className }: MermaidBlockProps) {
  const baseId = normalizeId(useId());
  const [state, setState] = useState<RenderState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;

    async function renderDiagram() {
      setState({ status: 'loading' });

      try {
        const renderId = `${baseId}-${Date.now().toString(36)}`;
        const svg = await renderMermaidSvg(code, renderId);
        if (!cancelled) {
          setState({ status: 'ready', svg });
        }
      } catch (error) {
        if (!cancelled) {
          setState({
            status: 'error',
            message: error instanceof Error ? error.message : 'Invalid Mermaid diagram',
          });
        }
      }
    }

    void renderDiagram();

    return () => {
      cancelled = true;
    };
  }, [baseId, code]);

  if (state.status === 'loading') {
    return (
      <div className={cn('my-4 rounded-lg border border-[#e5e2db] bg-[#fffdf8] px-4 py-5 text-sm text-[#7a7568]', className)}>
        Rendering diagram...
      </div>
    );
  }

  if (state.status === 'error') {
    return (
      <div className={cn('my-4 overflow-hidden rounded-lg border border-[#e5e2db] bg-[#fffdf8]', className)}>
        <div className="flex items-center gap-2 border-b border-[#eeeae1] px-4 py-2 text-sm text-[#8a5a44]">
          <AlertTriangle className="h-4 w-4" />
          <span>Mermaid diagram is invalid: {state.message}</span>
        </div>
        <pre className="overflow-x-auto p-4 text-sm leading-6 text-[#3d3929]">
          <code>{code}</code>
        </pre>
      </div>
    );
  }

  return (
    <div className={cn('my-4 overflow-hidden rounded-lg border border-[#e5e2db] bg-[#fffdf8]', className)}>
      <div
        className="overflow-x-auto p-4 [&_svg]:mx-auto [&_svg]:max-w-none"
        dangerouslySetInnerHTML={{ __html: state.svg }}
      />
    </div>
  );
});
