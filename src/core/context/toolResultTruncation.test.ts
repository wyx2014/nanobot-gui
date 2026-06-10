import { describe, it, expect } from 'vitest';
import {
  truncateToolResultText,
  calculateMaxToolResultChars,
  isOversizedToolResult,
  truncateIfOversized,
  HARD_MAX_TOOL_RESULT_CHARS,
} from './toolResultTruncation';

describe('toolResultTruncation', () => {
  describe('truncateToolResultText', () => {
    it('should not truncate short text', () => {
      const text = 'Hello, world!';
      expect(truncateToolResultText(text, 100)).toBe(text);
    });

    it('should truncate long text preserving head', () => {
      const text = 'A'.repeat(10000);
      const result = truncateToolResultText(text, 500, { minKeepChars: 100 });
      expect(result.length).toBeLessThan(text.length);
      expect(result).toContain('⚠️');
      expect(result.startsWith('A')).toBe(true);
    });

    it('should preserve tail when it contains error info', () => {
      const head = 'Line 1\n'.repeat(500);
      const tail = '\nError: something failed\nstack trace here\nexit code 1';
      const text = head + tail;
      const result = truncateToolResultText(text, 1000, { minKeepChars: 100 });
      expect(result).toContain('⚠️');
      // The tail with error info should be preserved
      expect(result).toContain('exit code');
    });

    it('should cut at newline boundaries when possible', () => {
      const lines = Array.from({ length: 100 }, (_, i) => `Line ${i}: some content here`);
      const text = lines.join('\n');
      const result = truncateToolResultText(text, 500, { minKeepChars: 100 });
      // Should end cleanly (no partial lines before the suffix)
      const beforeSuffix = result.split('⚠️')[0];
      expect(beforeSuffix.endsWith('\n') || beforeSuffix.endsWith('...')).toBeTruthy;
    });

    it('should use custom suffix', () => {
      const text = 'A'.repeat(1000);
      const result = truncateToolResultText(text, 500, { suffix: '[TRUNCATED]', minKeepChars: 100 });
      expect(result).toContain('[TRUNCATED]');
    });
  });

  describe('calculateMaxToolResultChars', () => {
    it('should calculate 30% of context window in characters', () => {
      // 200k tokens * 0.3 * 4 chars/token = 240k chars
      const result = calculateMaxToolResultChars(200_000);
      expect(result).toBe(240_000);
    });

    it('should cap at HARD_MAX_TOOL_RESULT_CHARS', () => {
      // 2M tokens * 0.3 * 4 = 2.4M > 400k hard limit
      const result = calculateMaxToolResultChars(2_000_000);
      expect(result).toBe(HARD_MAX_TOOL_RESULT_CHARS);
    });

    it('should handle small context windows', () => {
      const result = calculateMaxToolResultChars(32_000);
      // 32k * 0.3 * 4 = 38400
      expect(result).toBe(38_400);
    });
  });

  describe('isOversizedToolResult', () => {
    it('should return false for short results', () => {
      expect(isOversizedToolResult('short', 200_000)).toBe(false);
    });

    it('should return true for oversized results', () => {
      const bigResult = 'x'.repeat(300_000);
      // 200k tokens → 240k chars max
      expect(isOversizedToolResult(bigResult, 200_000)).toBe(true);
    });
  });

  describe('truncateIfOversized', () => {
    it('should return original text when within limits', () => {
      const { text, truncated } = truncateIfOversized('hello', 200_000);
      expect(text).toBe('hello');
      expect(truncated).toBe(false);
    });

    it('should truncate and flag when oversized', () => {
      const bigText = 'x'.repeat(300_000);
      const { text, truncated } = truncateIfOversized(bigText, 200_000);
      expect(truncated).toBe(true);
      expect(text.length).toBeLessThan(bigText.length);
      expect(text).toContain('⚠️');
    });
  });
});
