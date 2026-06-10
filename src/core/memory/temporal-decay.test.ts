import { describe, it, expect } from 'vitest';
import { applyTemporalDecayToScore, type TemporalDecayConfig } from './temporal-decay';

describe('temporal-decay', () => {

  it('preserves score when item age is 0 days', () => {
    const decayedScore = applyTemporalDecayToScore({
      score: 1.0,
      ageInDays: 0,
      halfLifeDays: 30
    });
    expect(decayedScore).toBeCloseTo(1.0, 4);
  });

  it('strictly halves the score after exactly 30 days (halfLife=30)', () => {
    const decayedScore = applyTemporalDecayToScore({
      score: 1.0,
      ageInDays: 30,
      halfLifeDays: 30
    });
    expect(decayedScore).toBeCloseTo(0.5, 4);
  });

  it('decays to a quarter after 60 days (halfLife=30)', () => {
    const decayedScore = applyTemporalDecayToScore({
      score: 1.0,
      ageInDays: 60,
      halfLifeDays: 30
    });
    expect(decayedScore).toBeCloseTo(0.25, 4);
  });

  it('decays further as time passes', () => {
    const scoreA = applyTemporalDecayToScore({ score: 1.0, ageInDays: 10, halfLifeDays: 30 });
    const scoreB = applyTemporalDecayToScore({ score: 1.0, ageInDays: 60, halfLifeDays: 30 });
    
    expect(scoreB).toBeLessThan(scoreA); // Older = lower score
  });

  it('does not amplify score if time is in the future (negative elapsed)', () => {
    const decayedScore = applyTemporalDecayToScore({
      score: 1.0,
      ageInDays: -10,
      halfLifeDays: 30
    });
    expect(decayedScore).toBeCloseTo(1.0, 4); 
  });
});
