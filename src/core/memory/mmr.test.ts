import { describe, it, expect } from 'vitest';
import { applyMMRToHybridResults } from './mmr';

describe('mmr algorithm', () => {
  it('diversifies top results based on MMR penalty', () => {
    // We mock similar items. Item 1 and Item 2 are duplicate-ish, so MMR should rank Item 3 above Item 2.
    const results = [
      { id: '1', score: 0.9, snippet: 'the quick brown fox', path: 'a.md', source: 'a', startLine: 1, endLine: 1 },
      { id: '2', score: 0.85, snippet: 'a quick brown fox', path: 'a.md', source: 'a', startLine: 2, endLine: 2 }, 
      { id: '3', score: 0.8, snippet: 'lazy dog sleeps', path: 'b.md', source: 'b', startLine: 1, endLine: 1 },
    ];

    const mmrSorted = applyMMRToHybridResults(results, { enabled: true, lambda: 0.5 });
    
    // Original sort: 1, 2, 3
    // Since 2 is very similar to 1, its marginal relevance drops.
    // 3 is totally different, so it should be boosted above 2.
    expect(mmrSorted.length).toBe(3);
    
    expect(mmrSorted[0].id).toBe('1'); 
    
    // We expect 3 to beat 2 due to diversity penalty on 2!
    // But this highly depends on the exact Jaccard similarity threshold vs the lambda score. Let's trace it.
    // Jaccard of 1 and 2: tokens1=[the, quick, brown, fox], tokens2=[a, quick, brown, fox] -> intersection=3, union=5 -> sim=0.6
    // Score of 2 penalized: lambda*0.85 - (1-lambda)*0.6 => 0.425 - 0.3 = 0.125
    // Score of 3 penalized: lambda*0.8 - (1-lambda)*0 => 0.4 - 0 = 0.4
    // 0.4 > 0.125 => Item 3 beats Item 2!
    expect(mmrSorted[1].id).toBe('3');
    expect(mmrSorted[2].id).toBe('2');
  });
});
