export interface GuideRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Keep the guide beside its target and inside the window, including short windows. */
export function placeOfficeGuide(
  target: GuideRect | null,
  viewport: { width: number; height: number },
  contentHeight: number,
) {
  const margin = 12;
  const topInset = Math.min(56, viewport.height / 6);
  const gap = 14;
  const width = Math.min(340, Math.max(0, viewport.width - margin * 2));
  const availableHeight = Math.max(0, viewport.height - topInset - margin);
  const height = Math.min(contentHeight, availableHeight);
  const clampLeft = (left: number) => Math.max(margin, Math.min(left, viewport.width - width - margin));
  const clampTop = (top: number) => Math.max(topInset, Math.min(top, viewport.height - height - margin));

  if (!target) {
    return { left: (viewport.width - width) / 2, top: clampTop((viewport.height - height) / 2), width, maxHeight: availableHeight };
  }

  const above = Math.max(0, target.top - gap - topInset);
  const below = Math.max(0, viewport.height - margin - target.top - target.height - gap);
  const left = clampLeft(target.left + (target.width - width) / 2);
  if (above >= height) return { left, top: target.top - gap - height, width, maxHeight: above };
  if (below >= height) return { left, top: target.top + target.height + gap, width, maxHeight: below };

  const top = clampTop(target.top + (target.height - height) / 2);
  if (viewport.width - target.left - target.width - gap - margin >= width) {
    return { left: target.left + target.width + gap, top, width, maxHeight: availableHeight };
  }
  if (target.left - gap - margin >= width) {
    return { left: target.left - gap - width, top, width, maxHeight: availableHeight };
  }

  // Allow the card itself to scroll instead of extending the page or covering
  // the control the user needs to click.
  return above >= below
    ? { left, top: topInset, width, maxHeight: above }
    : { left, top: target.top + target.height + gap, width, maxHeight: below };
}
