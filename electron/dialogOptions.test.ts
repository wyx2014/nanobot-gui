import { describe, expect, it } from 'vitest';
import { getOpenDialogProperties } from './dialogOptions';

describe('getOpenDialogProperties', () => {
  it('keeps file selection enabled when multiple files are allowed', () => {
    expect(getOpenDialogProperties({ multiple: true, directory: false })).toEqual([
      'openFile',
      'multiSelections',
    ]);
  });

  it('uses directory selection without implicitly enabling files', () => {
    expect(getOpenDialogProperties({ directory: true, multiple: true })).toEqual([
      'openDirectory',
      'multiSelections',
    ]);
  });

  it('preserves caller properties without adding duplicates', () => {
    expect(getOpenDialogProperties({
      properties: ['showHiddenFiles', 'openFile', 'multiSelections'],
      multiple: true,
    })).toEqual(['showHiddenFiles', 'openFile', 'multiSelections']);
  });
});
