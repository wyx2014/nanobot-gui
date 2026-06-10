import { describe, it, expect } from 'vitest';
import { mergeHybridResults } from './hybrid';

describe('hybrid merge', () => {

  it('correctly weighs and merges vector and keyword results', async () => {
    const vectorResults = [
      { id: '1', path: 'a.md', startLine: 1, endLine: 2, source: 'user', snippet: 'foo', vectorScore: 0.9 },
      { id: '2', path: 'b.md', startLine: 1, endLine: 2, source: 'user', snippet: 'bar', vectorScore: 0.5 },
    ];
    
    const keywordResults = [
      { id: '1', path: 'a.md', startLine: 1, endLine: 2, source: 'user', snippet: 'foo text', textScore: 0.2 },
      { id: '3', path: 'c.md', startLine: 1, endLine: 2, source: 'user', snippet: 'baz', textScore: 0.8 },
    ];

    const merged = await mergeHybridResults({
      vector: vectorResults,
      keyword: keywordResults,
      vectorWeight: 0.7,
      textWeight: 0.3,
      workspaceDir: undefined, // Skip decay IO checks
      temporalDecay: { enabled: false }
    });

    // We expect 3 distinct items
    expect(merged.length).toBe(3);

    // ID 1: 0.7 * 0.9 + 0.3 * 0.2 = 0.63 + 0.06 = 0.69
    const doc1 = merged.find(m => m.id === '1');
    expect(doc1).toBeDefined();
    expect(doc1!.score).toBeCloseTo(0.69, 4);

    // ID 2: 0.7 * 0.5 + 0 = 0.35
    const doc2 = merged.find(m => m.id === '2');
    expect(doc2!.score).toBeCloseTo(0.35, 4);

    // ID 3: 0 + 0.3 * 0.8 = 0.24
    const doc3 = merged.find(m => m.id === '3');
    expect(doc3!.score).toBeCloseTo(0.24, 4);
    
    // Sort order check: 1 > 2 > 3
    expect(merged[0].id).toBe('1');
    expect(merged[1].id).toBe('2');
    expect(merged[2].id).toBe('3');
  });

});
