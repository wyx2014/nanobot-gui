/**
 * Retry with exponential backoff for LLM API calls
 */

import { LLMError } from '../llm/adapter';

export interface RetryConfig {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

const DEFAULT_CONFIG: RetryConfig = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
};

/**
 * Execute a function with exponential backoff retry on retryable errors
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  config: Partial<RetryConfig> = {},
  signal?: AbortSignal,
  onRetry?: (attempt: number, error: LLMError, delayMs: number) => void
): Promise<T> {
  const { maxRetries, baseDelayMs, maxDelayMs } = { ...DEFAULT_CONFIG, ...config };

  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    // Check for cancellation
    if (signal?.aborted) {
      throw new LLMError('Request cancelled', 'cancelled', { retryable: false });
    }

    try {
      return await fn();
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));

      // Don't retry on non-LLMError or non-retryable errors
      if (!(err instanceof LLMError) || !err.retryable) {
        throw err;
      }

      // Don't retry if we've exhausted attempts
      if (attempt >= maxRetries) {
        throw err;
      }

      // Don't retry on user cancellation
      if (err.code === 'cancelled') {
        throw err;
      }

      // Calculate delay with exponential backoff + jitter
      const exponentialDelay = baseDelayMs * Math.pow(2, attempt);
      const jitter = Math.random() * baseDelayMs * 0.5;
      const delay = Math.min(
        err.retryAfterMs ?? (exponentialDelay + jitter),
        maxDelayMs
      );

      // Notify caller about retry
      onRetry?.(attempt + 1, err, delay);

      // Wait before retrying
      await sleep(delay, signal);
    }
  }

  throw lastError;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(new LLMError('Request cancelled', 'cancelled', { retryable: false }));
    };
    const timer = setTimeout(() => {
      if (signal) signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    if (signal) {
      if (signal.aborted) {
        clearTimeout(timer);
        reject(new LLMError('Request cancelled', 'cancelled', { retryable: false }));
        return;
      }
      signal.addEventListener('abort', onAbort, { once: true });
    }
  });
}
