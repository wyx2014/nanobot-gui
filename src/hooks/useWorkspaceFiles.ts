import { useCallback, useEffect, useRef, useState } from 'react';
import { fsBridge, type WorkspaceFileEntry } from '@/lib/ipc-factory';

/** Keep file mentions current, with periodic scans only while the picker is open. */
export function useWorkspaceFiles(workspacePath: string | null | undefined, pickerOpen: boolean) {
  const [files, setFiles] = useState<WorkspaceFileEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refreshRef = useRef<() => void>(() => {});
  const refresh = useCallback(() => refreshRef.current(), []);

  useEffect(() => {
    let disposed = false;
    let inFlight = false;
    let refreshPending = false;
    let loaded = false;
    setFiles([]);
    setError(null);
    setLoading(Boolean(workspacePath));

    const load = async () => {
      if (disposed || !workspacePath) return;
      if (inFlight) {
        // An import or focus event may arrive during a scan. Read again after
        // it finishes, without overlapping scans or discarding every result.
        refreshPending = true;
        return;
      }
      inFlight = true;
      setError(null);
      if (!loaded) setLoading(true);
      try {
        const entries = await fsBridge.listWorkspaceFiles(workspacePath);
        if (!disposed) {
          loaded = true;
          // Older Electron processes return entries without an explicit kind.
          setFiles(entries.map((entry) => ({
            ...entry,
            kind: entry.kind === 'folder' ? 'folder' : 'file',
          })));
        }
      } catch (cause) {
        if (!disposed) setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        inFlight = false;
        if (!disposed) {
          setLoading(false);
          if (refreshPending) {
            refreshPending = false;
            void load();
          }
        }
      }
    };
    refreshRef.current = () => { void load(); };
    void load();

    const onFocus = () => {
      if (document.visibilityState !== 'hidden') void load();
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    return () => {
      disposed = true;
      refreshRef.current = () => {};
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
    };
  }, [workspacePath]);

  useEffect(() => {
    if (!pickerOpen || !workspacePath) return;
    refresh();
    // Also catch files created by the Agent or copied while @ stays open.
    const timer = window.setInterval(() => {
      if (document.visibilityState !== 'hidden') refresh();
    }, 2000);
    return () => window.clearInterval(timer);
  }, [pickerOpen, refresh, workspacePath]);

  return { files, loading, error, refresh };
}
