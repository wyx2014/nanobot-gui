import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveDroppedFilePath } from './useFileDragDrop';

afterEach(() => {
  Reflect.deleteProperty(window, 'api');
});

describe('resolveDroppedFilePath', () => {
  it('uses the preload path resolver required by current Electron versions', () => {
    const file = new File(['report'], 'report.xlsx');
    const getPathForFile = vi.fn(() => 'C:\\Users\\alice\\Desktop\\report.xlsx');
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: { getPathForFile },
    });

    expect(resolveDroppedFilePath(file)).toBe('C:\\Users\\alice\\Desktop\\report.xlsx');
    expect(getPathForFile).toHaveBeenCalledWith(file);
  });

  it('keeps the legacy absolute path fallback for older Electron builds', () => {
    const file = Object.assign(new File(['notes'], 'notes.md'), {
      path: '/Users/alice/Desktop/notes.md',
    });

    expect(resolveDroppedFilePath(file)).toBe('/Users/alice/Desktop/notes.md');
  });

  it('rejects a bare filename so it cannot leak the transport prefix into chat', () => {
    const file = new File(['notes'], 'notes.md');

    expect(resolveDroppedFilePath(file)).toBeNull();
  });
});
