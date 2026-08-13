import { describe, expect, it } from 'vitest';
import { initialStreamProtocolState, streamProtocolReducer } from './streamProtocol';

describe('streamProtocolReducer', () => {
  it('tracks a running turn and finalizes it atomically', () => {
    const running = streamProtocolReducer(initialStreamProtocolState, {
      type: 'reset',
      isStreaming: true,
      runStartedAt: 123,
      goalState: { status: 'running' },
    });
    const done = streamProtocolReducer(running, {
      type: 'turn_end',
      goalState: { status: 'completed' },
    });

    expect(running).toMatchObject({ isStreaming: true, runStartedAt: 123 });
    expect(done).toMatchObject({
      isStreaming: false,
      runStartedAt: null,
      goalState: { status: 'completed' },
    });
  });

  it('does not discard an error while stream status updates arrive', () => {
    const error = { kind: 'connection_lost', message: 'offline' } as never;
    const withError = streamProtocolReducer(initialStreamProtocolState, { type: 'error', value: error });
    const streaming = streamProtocolReducer(withError, { type: 'streaming', value: true });

    expect(streaming.streamError).toBe(error);
    expect(streaming.isStreaming).toBe(true);
  });

  it('keeps the turn running while stop is pending and clears it on terminal status', () => {
    const running = streamProtocolReducer(initialStreamProtocolState, {
      type: 'streaming',
      value: true,
    });
    const stopping = streamProtocolReducer(running, {
      type: 'stopping',
      value: true,
    });
    const done = streamProtocolReducer(stopping, {
      type: 'streaming',
      value: false,
    });

    expect(stopping).toMatchObject({ isStreaming: true, isStopping: true });
    expect(done).toMatchObject({ isStreaming: false, isStopping: false });
  });
});
