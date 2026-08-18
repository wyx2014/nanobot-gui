import { ThinkingOrb, type ThinkingOrbProps } from 'thinking-orbs';
import { useModalBackgroundPaused } from './modalPerformance';

export type { OrbState } from 'thinking-orbs';

export default function ModalAwareThinkingOrb({ paused, ...props }: ThinkingOrbProps) {
  const backgroundPaused = useModalBackgroundPaused();
  return <ThinkingOrb {...props} paused={paused || backgroundPaused} />;
}
