export function DiffPair({ added, deleted }: { added: number; deleted: number }) {
  const safeAdded = Number.isFinite(added) ? Math.max(0, Math.round(added)) : 0;
  const safeDeleted = Number.isFinite(deleted) ? Math.max(0, Math.round(deleted)) : 0;
  return (
    <span className="inline-flex shrink-0 items-baseline gap-1.5 leading-[inherit] tabular-nums">
      <span className="text-emerald-600/80">+{safeAdded}</span>
      <span className="text-rose-600/75">-{safeDeleted}</span>
    </span>
  );
}
