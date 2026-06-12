import type { ActivityEvidence } from '@/core/nanobot/activityTimeline';
import { cn } from '@/lib/utils';
import { MessageMedia } from '../MessageMedia';

interface ActivityEvidencePreviewProps {
  evidence: ActivityEvidence[];
  className?: string;
}

export function ActivityEvidencePreview({ evidence, className }: ActivityEvidencePreviewProps) {
  if (evidence.length === 0) return null;
  const media = evidence.slice(0, 4).map((item) => ({
    ...item.attachment,
    name: item.caption || item.attachment.name,
  }));
  return (
    <MessageMedia
      media={media}
      compact
      className={cn(
        'mt-0 max-w-full pt-0.5 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-top-1 motion-safe:duration-200',
        className,
      )}
    />
  );
}
