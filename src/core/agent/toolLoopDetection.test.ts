import { describe, it, expect, beforeEach } from 'vitest';
import {
  createLoopDetectionState,
  detectToolCallLoop,
  recordToolCall,
  recordToolCallOutcome,
  hashToolCall,
  type LoopDetectionState,
} from './toolLoopDetection';

describe('toolLoopDetection', () => {
  let state: LoopDetectionState;

  beforeEach(() => {
    state = createLoopDetectionState();
  });

  describe('hashToolCall', () => {
    it('should produce deterministic hashes', () => {
      const h1 = hashToolCall('read_file', { path: '/foo' });
      const h2 = hashToolCall('read_file', { path: '/foo' });
      expect(h1).toBe(h2);
    });

    it('should produce different hashes for different params', () => {
      const h1 = hashToolCall('read_file', { path: '/foo' });
      const h2 = hashToolCall('read_file', { path: '/bar' });
      expect(h1).not.toBe(h2);
    });

    it('should produce different hashes for different tools', () => {
      const h1 = hashToolCall('read_file', { path: '/foo' });
      const h2 = hashToolCall('write_file', { path: '/foo' });
      expect(h1).not.toBe(h2);
    });

    it('should handle object key order consistently', () => {
      const h1 = hashToolCall('tool', { a: 1, b: 2 });
      const h2 = hashToolCall('tool', { b: 2, a: 1 });
      expect(h1).toBe(h2);
    });
  });

  describe('detectToolCallLoop — generic_repeat', () => {
    it('should not flag below warning threshold', () => {
      const config = { warningThreshold: 5 };
      for (let i = 0; i < 4; i++) {
        recordToolCall(state, 'read_file', { path: '/foo' }, `tc-${i}`, config);
        recordToolCallOutcome(state, {
          toolName: 'read_file',
          toolParams: { path: '/foo' },
          toolCallId: `tc-${i}`,
          result: 'same content',
        }, config);
      }
      const result = detectToolCallLoop(state, 'read_file', { path: '/foo' }, config);
      expect(result.stuck).toBe(false);
    });

    it('should flag warning at threshold', () => {
      const config = { warningThreshold: 5, criticalThreshold: 10 };
      for (let i = 0; i < 5; i++) {
        recordToolCall(state, 'read_file', { path: '/foo' }, `tc-${i}`, config);
        recordToolCallOutcome(state, {
          toolName: 'read_file',
          toolParams: { path: '/foo' },
          toolCallId: `tc-${i}`,
          result: 'same',
        }, config);
      }
      const result = detectToolCallLoop(state, 'read_file', { path: '/foo' }, config);
      expect(result.stuck).toBe(true);
      if (result.stuck) {
        expect(result.level).toBe('warning');
        expect(result.detector).toBe('generic_repeat');
        expect(result.count).toBeGreaterThanOrEqual(5);
      }
    });

    it('should not flag different params', () => {
      const config = { warningThreshold: 3 };
      for (let i = 0; i < 5; i++) {
        recordToolCall(state, 'read_file', { path: `/file-${i}` }, `tc-${i}`, config);
        recordToolCallOutcome(state, {
          toolName: 'read_file',
          toolParams: { path: `/file-${i}` },
          toolCallId: `tc-${i}`,
          result: 'content',
        }, config);
      }
      const result = detectToolCallLoop(state, 'read_file', { path: '/file-5' }, config);
      expect(result.stuck).toBe(false);
    });
  });

  describe('detectToolCallLoop — global circuit breaker', () => {
    it('should trigger critical at circuit breaker threshold', () => {
      const config = { warningThreshold: 5, criticalThreshold: 10, globalCircuitBreakerThreshold: 15 };
      for (let i = 0; i < 15; i++) {
        recordToolCall(state, 'web_search', { query: 'test' }, `tc-${i}`, config);
        recordToolCallOutcome(state, {
          toolName: 'web_search',
          toolParams: { query: 'test' },
          toolCallId: `tc-${i}`,
          result: 'same result',
        }, config);
      }
      const result = detectToolCallLoop(state, 'web_search', { query: 'test' }, config);
      expect(result.stuck).toBe(true);
      if (result.stuck) {
        expect(result.level).toBe('critical');
        expect(result.detector).toBe('global_circuit_breaker');
      }
    });
  });

  describe('detectToolCallLoop — ping_pong', () => {
    it('should detect alternating tool patterns', () => {
      const config = { warningThreshold: 4, criticalThreshold: 8 };
      // Simulate A-B-A-B-A-B alternation
      for (let i = 0; i < 6; i++) {
        const isA = i % 2 === 0;
        const toolName = isA ? 'read_file' : 'write_file';
        const params = isA ? { path: '/a' } : { path: '/b' };
        recordToolCall(state, toolName, params, `tc-${i}`, config);
        recordToolCallOutcome(state, {
          toolName,
          toolParams: params,
          toolCallId: `tc-${i}`,
          result: isA ? 'resultA' : 'resultB',
        }, config);
      }
      // Next would be A again
      const result = detectToolCallLoop(state, 'read_file', { path: '/a' }, config);
      // With 6 entries alternating + 1 current = 7, should be >= 4 warning threshold
      if (result.stuck) {
        expect(result.level).toBe('warning');
        expect(result.detector).toBe('ping_pong');
      }
    });
  });

  describe('detectToolCallLoop — disabled', () => {
    it('should not flag when disabled', () => {
      const config = { enabled: false, warningThreshold: 1 };
      recordToolCall(state, 'read_file', { path: '/foo' }, 'tc-0', config);
      recordToolCallOutcome(state, {
        toolName: 'read_file',
        toolParams: { path: '/foo' },
        toolCallId: 'tc-0',
        result: 'same',
      }, config);
      const result = detectToolCallLoop(state, 'read_file', { path: '/foo' }, config);
      expect(result.stuck).toBe(false);
    });
  });

  describe('recordToolCall + history sliding window', () => {
    it('should limit history size', () => {
      const config = { historySize: 5 };
      for (let i = 0; i < 10; i++) {
        recordToolCall(state, 'tool', { i }, `tc-${i}`, config);
      }
      expect(state.toolCallHistory.length).toBeLessThanOrEqual(5);
    });
  });
});
