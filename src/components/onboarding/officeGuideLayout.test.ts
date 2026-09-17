import { describe, expect, it } from 'vitest';
import { placeOfficeGuide } from './officeGuideLayout';

describe('office tutorial placement', () => {
  it.each([
    { viewport: { width: 1280, height: 800 }, target: { left: 560, top: 570, width: 110, height: 40 }, height: 240 },
    { viewport: { width: 1024, height: 768 }, target: { left: 390, top: 110, width: 510, height: 48 }, height: 230 },
    { viewport: { width: 1280, height: 600 }, target: { left: 180, top: 180, width: 270, height: 180 }, height: 340 },
    { viewport: { width: 640, height: 480 }, target: { left: 35, top: 160, width: 570, height: 180 }, height: 340 },
    { viewport: { width: 360, height: 560 }, target: { left: 16, top: 290, width: 328, height: 100 }, height: 340 },
  ])('keeps the card visible without covering the click target in $viewport', ({ viewport, target, height }) => {
    const placement = placeOfficeGuide(target, viewport, height);
    const cardHeight = Math.min(height, placement.maxHeight);
    expect(placement.maxHeight).toBeGreaterThan(0);
    expect(placement.left).toBeGreaterThanOrEqual(12);
    expect(placement.top).toBeGreaterThanOrEqual(0);
    expect(placement.left + placement.width).toBeLessThanOrEqual(viewport.width - 12);
    expect(placement.top + cardHeight).toBeLessThanOrEqual(viewport.height - 12);
    const overlaps = placement.left < target.left + target.width
      && placement.left + placement.width > target.left
      && placement.top < target.top + target.height
      && placement.top + cardHeight > target.top;
    expect(overlaps).toBe(false);
  });
});
