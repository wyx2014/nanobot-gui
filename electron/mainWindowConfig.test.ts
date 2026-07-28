import { describe, expect, it } from 'vitest';
import { MAIN_WINDOW_BOUNDS } from './mainWindowConfig';

describe('main window bounds', () => {
  it('matches the OpenWorker desktop window contract', () => {
    expect(MAIN_WINDOW_BOUNDS).toEqual({
      width: 1360,
      height: 900,
      minWidth: 980,
      minHeight: 640,
    });
  });

  it('is immutable so runtime setup cannot drift from the tested contract', () => {
    expect(Object.isFrozen(MAIN_WINDOW_BOUNDS)).toBe(true);
  });
});
