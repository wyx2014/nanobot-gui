import { AlertCircle, CheckCircle2, CircleDashed } from 'lucide-react';
import type { UIFileEdit } from '@/core/types';
import { cn } from '@/lib/utils';
import { getBaseName } from '@/utils/pathUtils';
import { ActivityStep } from './ActivityStep';
import { DiffPair } from './DiffPair';

export interface FileEditSummary {
  key: string;
  path: string;
  absolute_path?: string;
  added: number;
  deleted: number;
  approximate: boolean;
  binary: boolean;
  status: UIFileEdit['status'];
  operation?: UIFileEdit['operation'];
  pending: boolean;
  error?: string;
}

export function FileEditGroup({ edits }: { edits: FileEditSummary[] }) {
  if (edits.length === 0) return null;
  return (
    <ul className="space-y-1">
      {edits.map((edit) => (
        <FileEditRow key={edit.key} edit={edit} />
      ))}
    </ul>
  );
}

function FileEditRow({ edit }: { edit: FileEditSummary }) {
  const editing = edit.status === 'editing';
  const failed = edit.status === 'error';
  const hasCountedDiff = !failed && !edit.binary && hasVisibleDiffStats(edit);
  const failureDetail = failed ? formatFileEditError(edit.error) || 'File change was not applied.' : '';
  const statusIcon = failed ? (
    <AlertCircle className="h-3 w-3" aria-hidden />
  ) : editing ? (
    <CircleDashed className="h-3 w-3 animate-spin" aria-hidden />
  ) : (
    <CheckCircle2 className="h-3 w-3" aria-hidden />
  );
  return (
    <ActivityStep
      as="li"
      marker={(
        <span
          className={cn(
            'grid h-3.5 w-3.5 place-items-center rounded-full border bg-white transition-colors',
            failed && 'border-red-500/30 text-red-600',
            editing && 'border-[#8b887c]/30 text-[#8b887c]',
            !failed && !editing && 'border-emerald-500/30 text-emerald-600',
          )}
        >
          {statusIcon}
        </span>
      )}
      active={editing}
      tone={failed ? 'error' : editing ? 'active' : 'success'}
      className="text-xs"
      contentClassName={failed ? 'min-w-0' : 'grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3'}
      title={cleanFileEditError(edit.error) || edit.absolute_path || edit.path}
      label={edit.pending && !edit.path
        ? 'Preparing file edit...'
        : (
          <span className="min-w-0 truncate rounded bg-[#f5f3ee] px-1.5 py-0.5 text-[12px] text-[#29261b]">
            {getBaseName(edit.path) || edit.path}
          </span>
        )}
      aside={hasCountedDiff ? <DiffPair added={edit.added} deleted={edit.deleted} /> : null}
    >
      {failed ? (
        <span className="block max-w-[42rem] truncate text-[11px] leading-4 text-red-600/80">
          {failureDetail}
        </span>
      ) : null}
    </ActivityStep>
  );
}

export function hasVisibleDiffStats(edit: Pick<FileEditSummary, 'added' | 'deleted'>): boolean {
  return edit.added > 0 || edit.deleted > 0;
}

function cleanFileEditError(error?: string): string {
  const firstLine = (error || '').replace(/\s+/g, ' ').trim();
  if (!firstLine) return '';
  return firstLine
    .replace(/^Error applying patch:\s*/i, '')
    .replace(/^Error writing file:\s*/i, '')
    .replace(/^Error editing file:\s*/i, '')
    .replace(/^Error:\s*/i, '');
}

function formatFileEditError(error?: string): string {
  const cleaned = cleanFileEditError(error);
  if (!cleaned) return '';
  if (/\bpermission denied\b/i.test(cleaned) || /\boperation not permitted\b/i.test(cleaned)) {
    return 'No permission to change this location.';
  }
  return cleaned
    .replace(/^old_text not found in (.+)$/i, 'Target text was not found in $1.')
    .replace(/^old_text appears multiple times in (.+)$/i, 'Target text matched multiple places in $1.')
    .replace(/^file to (?:update|delete) does not exist: (.+)$/i, 'File does not exist: $1.')
    .replace(/^path to (?:update|delete) is not a file: (.+)$/i, 'Path is not a file: $1.')
    .slice(0, 180);
}
