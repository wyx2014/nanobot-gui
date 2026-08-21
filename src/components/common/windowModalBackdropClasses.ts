import { cn } from '@/lib/utils';

export type BackdropPosition = 'absolute' | 'fixed';

export function windowModalBackdropPositionClasses(
  position: BackdropPosition = 'absolute',
): string {
  return cn(
    position,
    'window-titlebar-safe-top bottom-0 left-0 right-0',
  );
}
