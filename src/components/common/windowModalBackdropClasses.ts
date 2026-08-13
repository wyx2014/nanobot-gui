import { cn } from '@/lib/utils';
import { isWindows } from '@/utils/platform';

export type BackdropPosition = 'absolute' | 'fixed';

export function windowModalBackdropPositionClasses(
  position: BackdropPosition = 'absolute',
): string {
  return cn(
    position,
    'bottom-0 left-0 right-0',
    isWindows() ? 'top-10' : 'top-0',
  );
}
