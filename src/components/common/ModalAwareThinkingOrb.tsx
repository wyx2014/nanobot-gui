import { memo, useEffect, useRef, useState, type RefObject } from 'react';
import { MODE_DRAWS, resolvePreset, type ThinkingOrbProps } from 'thinking-orbs';
import { subscribeAnimationFrames } from './animationFrames';
import { useVisualActivity } from './useVisualActivity';
import { isDevLowPowerMode } from '@/utils/devPerformance';

export type { OrbState } from 'thinking-orbs';

const LABELS = {
  working: 'Working…', searching: 'Searching…', solving: 'Solving…',
  listening: 'Listening…', connecting: 'Connecting…', weaving: 'Weaving…',
  composing: 'Composing…', breathing: 'Thinking…', shaping: 'Shaping…',
};

function useOrbTheme(theme: ThinkingOrbProps['theme'], ref: RefObject<HTMLCanvasElement | null>): boolean {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    if (theme === 'dark' || theme === 'light') {
      setDark(theme === 'dark');
      return;
    }
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const ancestors: Element[] = [];
    for (let node: Element | null = ref.current; node; node = node.parentElement) ancestors.push(node);
    const update = () => {
      for (const node of ancestors) {
        const explicit = node.getAttribute('data-theme');
        if (explicit === 'light' || explicit === 'dark') {
          setDark(explicit === 'dark');
          return;
        }
        if (node.classList.contains('dark') || node.classList.contains('light')) {
          setDark(node.classList.contains('dark'));
          return;
        }
      }
      setDark(query.matches);
    };
    update();
    query.addEventListener('change', update);
    // Observe theme ancestors only; streaming DOM changes elsewhere are irrelevant.
    const observer = new MutationObserver(update);
    for (const node of ancestors) observer.observe(node, { attributes: true, attributeFilter: ['class', 'data-theme'] });
    return () => {
      observer.disconnect();
      query.removeEventListener('change', update);
    };
  }, [ref, theme]);
  return dark;
}

export default memo(function ModalAwareThinkingOrb({
  state = 'working',
  size = 64,
  theme = 'auto',
  speed = 1,
  paused = false,
  style,
  'aria-label': label,
  ...props
}: ThinkingOrbProps) {
  const ref = useRef<HTMLCanvasElement>(null);
  const active = useVisualActivity(ref);
  const dark = useOrbTheme(theme, ref);
  const lowPower = isDevLowPowerMode();
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReducedMotion(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    const canvas = ref.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return;
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(size * ratio);
    canvas.height = Math.round(size * ratio);
    const preset = resolvePreset(state, size);
    const paint = (time: number) => {
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, size, size);
      MODE_DRAWS[preset.mode](context, size, reducedMotion || lowPower ? 0.6 : time / 1_000 * preset.speed * speed, dark, preset.opts);
    };
    paint(performance.now());
    if (paused || !active || reducedMotion || lowPower) return;
    return subscribeAnimationFrames(paint);
  }, [active, dark, lowPower, paused, reducedMotion, size, speed, state]);

  return (
    <canvas
      {...props}
      ref={ref}
      role="img"
      aria-label={label ?? LABELS[state]}
      style={{ width: size, height: size, display: 'block', ...style }}
    />
  );
});
