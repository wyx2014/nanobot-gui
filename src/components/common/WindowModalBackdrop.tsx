import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/utils';
import {
  windowModalBackdropPositionClasses,
  type BackdropPosition,
} from './windowModalBackdropClasses';
import { useModalBackgroundPause } from './modalPerformance';

interface WindowModalBackdropProps extends HTMLAttributes<HTMLDivElement> {
  position?: BackdropPosition;
  interactive?: boolean;
}

/**
 * Dims renderer content without painting behind Windows' native caption area.
 * Electron's minimise/maximise/close buttons live above the renderer and cannot
 * be covered by an HTML backdrop, so dimming that row would create a white box.
 */
export default function WindowModalBackdrop({
  className,
  position = 'absolute',
  interactive = false,
  ...props
}: WindowModalBackdropProps) {
  useModalBackgroundPause();

  return (
    <div
      aria-hidden="true"
      data-window-modal-backdrop
      className={cn(
        windowModalBackdropPositionClasses(position),
        'bg-black/15',
        interactive ? 'pointer-events-auto' : 'pointer-events-none',
        className,
      )}
      {...props}
    />
  );
}
