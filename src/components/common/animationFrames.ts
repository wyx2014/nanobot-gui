type FramePainter = (time: number) => void;

const painters = new Set<FramePainter>();
const FRAME_INTERVAL_MS = 1_000 / 30;
let frame: number | null = null;
let lastPaint = -Infinity;

function tick(time: number): void {
  frame = null;
  if (time - lastPaint >= FRAME_INTERVAL_MS - 0.5) {
    lastPaint = time;
    for (const paint of painters) paint(time);
  }
  if (painters.size) frame = requestAnimationFrame(tick);
}

/** All visible status canvases share a clock and retain their original speed. */
export function subscribeAnimationFrames(paint: FramePainter): () => void {
  painters.add(paint);
  if (frame === null) {
    lastPaint = -Infinity;
    frame = requestAnimationFrame(tick);
  }
  return () => {
    painters.delete(paint);
    if (!painters.size && frame !== null) {
      cancelAnimationFrame(frame);
      frame = null;
    }
  };
}
