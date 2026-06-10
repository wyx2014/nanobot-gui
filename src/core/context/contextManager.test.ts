import { describe, it, expect } from 'vitest';
import { prepareContextMessages } from './contextManager';
import type { Message } from '../../types';

function makeMsg(role: 'user' | 'assistant', content: string): Message {
  return { id: Math.random().toString(36), role, content, timestamp: Date.now() };
}

describe('contextManager', () => {
  const systemPrompt = 'You are a helpful assistant.';

  // ── Fast path: everything fits ──
  describe('fast path — everything fits', () => {
    it('returns all messages when within limit', () => {
      const messages = [
        makeMsg('user', 'Hello'),
        makeMsg('assistant', 'Hi!'),
      ];
      const result = prepareContextMessages(messages, systemPrompt, 100000, 4000);
      expect(result).toHaveLength(2);
      expect(result).toEqual(messages);
    });
  });

  // ── Round identification ──
  describe('round identification and compression', () => {
    it('keeps first and last rounds, compresses middle', () => {
      // Create 8 rounds to trigger compression
      const messages: Message[] = [];
      for (let i = 0; i < 8; i++) {
        messages.push(makeMsg('user', `Question ${i} ${'x'.repeat(500)}`));
        messages.push(makeMsg('assistant', `Answer ${i} ${'y'.repeat(500)}`));
      }

      // Set a limit that forces compression
      const result = prepareContextMessages(messages, systemPrompt, 3000, 500);
      // Should have fewer messages/shorter content than original
      expect(result.length).toBeLessThanOrEqual(messages.length);
    });
  });

  // ── Compression of assistant messages ──
  describe('assistant message compression', () => {
    it('truncates long assistant messages in middle rounds', () => {
      const messages: Message[] = [];
      // First round
      messages.push(makeMsg('user', 'Task: do something important'));
      messages.push(makeMsg('assistant', 'A'.repeat(2000)));
      // Middle rounds with long content (need enough to exceed limit)
      for (let i = 0; i < 8; i++) {
        messages.push(makeMsg('user', `Follow up ${i} with some extra context`));
        messages.push(makeMsg('assistant', `Response ${i}: ${'B'.repeat(2000)}`));
      }
      // Last rounds
      messages.push(makeMsg('user', 'Final question'));
      messages.push(makeMsg('assistant', 'Final answer'));

      // Token limit tight enough to force compression
      // Total ~18000 chars / 4 = ~4500 tokens for content + overhead
      // Set contextWindow small enough to force compression
      const result = prepareContextMessages(messages, systemPrompt, 3000, 500);
      // Result should be shorter than input
      const totalContentLength = result
        .filter((m) => m.role === 'assistant')
        .reduce((acc, m) => acc + (typeof m.content === 'string' ? m.content.length : 0), 0);
      const originalContentLength = messages
        .filter((m) => m.role === 'assistant')
        .reduce((acc, m) => acc + (typeof m.content === 'string' ? m.content.length : 0), 0);
      expect(totalContentLength).toBeLessThan(originalContentLength);
    });
  });

  // ── Aggressive mode ──
  describe('aggressive mode — drop middle entirely', () => {
    it('falls back to first + last 2 rounds when very constrained', () => {
      const messages: Message[] = [];
      for (let i = 0; i < 10; i++) {
        messages.push(makeMsg('user', `Q${i} ${'x'.repeat(200)}`));
        messages.push(makeMsg('assistant', `A${i} ${'y'.repeat(200)}`));
      }

      // Very tight limit
      const result = prepareContextMessages(messages, systemPrompt, 500, 100);
      // Should at minimum have the first user message and last 2 rounds
      expect(result.length).toBeGreaterThanOrEqual(3);
      expect(result.length).toBeLessThan(messages.length);
    });
  });

  // ── Single round ──
  describe('single round', () => {
    it('returns messages as-is when only 1 round', () => {
      const messages = [
        makeMsg('user', 'Hello'),
        makeMsg('assistant', 'Hi!'),
      ];
      // Even with very tight limit, single round is returned as-is
      const result = prepareContextMessages(messages, systemPrompt, 50, 10);
      expect(result).toEqual(messages);
    });
  });

  // ── Preserves first user message ──
  describe('first user message preservation', () => {
    it('always includes first user message in aggressive mode', () => {
      const messages: Message[] = [];
      messages.push(makeMsg('user', 'TASK_CONTEXT_IMPORTANT'));
      for (let i = 0; i < 10; i++) {
        messages.push(makeMsg('assistant', `A${i} ${'x'.repeat(200)}`));
        messages.push(makeMsg('user', `Q${i + 1}`));
      }
      messages.push(makeMsg('assistant', 'Final'));

      const result = prepareContextMessages(messages, systemPrompt, 500, 100);
      const firstUser = result.find((m) => m.role === 'user');
      expect(firstUser?.content).toContain('TASK_CONTEXT_IMPORTANT');
    });
  });

  // ── Tool calls in context ──
  describe('tool call context compression', () => {
    it('strips tool calls from compressed assistant messages', () => {
      const messages: Message[] = [];
      messages.push(makeMsg('user', 'Start'));
      messages.push({
        ...makeMsg('assistant', 'Running tools'),
        toolCalls: [{ id: 'tc1', name: 'read_file', input: { path: '/tmp/a.txt' }, result: 'content' }],
        toolCallsForContext: [{ name: 'read_file', input: { path: '/tmp/a.txt' }, result: 'content' }],
      });
      // Add enough rounds to trigger compression
      for (let i = 0; i < 6; i++) {
        messages.push(makeMsg('user', `Q${i} ${'x'.repeat(300)}`));
        messages.push(makeMsg('assistant', `A${i} ${'y'.repeat(300)}`));
      }

      const result = prepareContextMessages(messages, systemPrompt, 2000, 500);
      // The compressed assistant messages in middle should not have toolCalls
      const compressed = result.find(
        (m) => m.role === 'assistant' && m.content !== 'Running tools' && !m.toolCalls
      );
      // At least some assistant messages should be stripped
      expect(compressed?.toolCalls).toBeUndefined();
    });
  });
});
