import { describe, expect, it } from 'vitest';
import { normalizeMermaid } from './mermaid';

describe('normalizeMermaid', () => {
  it('converts legacy bar charts into Mermaid xycharts', () => {
    expect(normalizeMermaid('bar chart\n  x-axis "A", "B"\n  y-axis 0 --> 10\n  bar 1, -2\n  color 1: #fff')).toBe(
      'xychart-beta\nx-axis ["A", "B"]\n  y-axis 0 --> 10\nbar [1, -2]'
    );
  });
});
