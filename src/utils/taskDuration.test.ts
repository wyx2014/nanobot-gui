import { describe, expect, it } from 'vitest';
import { formatTaskDuration } from './taskDuration';

describe('formatTaskDuration', () => {
  it('does not display a positive sub-second duration as zero', () => {
    expect(formatTaskDuration(200)).toBe('1s');
  });

  it('formats the authoritative Qingdao Beer turn duration', () => {
    expect(formatTaskDuration(78_516)).toBe('1m19s');
  });
});
