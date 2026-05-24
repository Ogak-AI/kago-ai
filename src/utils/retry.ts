// ============================================================
// Kago AI – Retry & Resilience Utilities
// Handles transient failures with exponential backoff.
// ============================================================

import { createLogger } from './logger.js';

const log = createLogger('retry');

export interface RetryOptions {
  /** Maximum number of retry attempts */
  maxRetries: number;
  /** Base delay between retries in ms */
  baseDelayMs: number;
  /** Whether to use exponential backoff */
  exponentialBackoff: boolean;
  /** Maximum delay between retries in ms */
  maxDelayMs: number;
  /** Optional predicate to determine if error is retryable */
  isRetryable?: (error: unknown) => boolean;
}

const DEFAULT_OPTIONS: RetryOptions = {
  maxRetries: 2,
  baseDelayMs: 1000,
  exponentialBackoff: true,
  maxDelayMs: 10000,
};

/**
 * Execute a function with retry logic and exponential backoff.
 * Returns the result on success, or throws the last error on exhaustion.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: Partial<RetryOptions> = {},
): Promise<T> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  let lastError: unknown;

  for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      // Check if error is retryable
      if (opts.isRetryable && !opts.isRetryable(error)) {
        throw error;
      }

      if (attempt < opts.maxRetries) {
        const delay = opts.exponentialBackoff
          ? Math.min(opts.baseDelayMs * Math.pow(2, attempt), opts.maxDelayMs)
          : opts.baseDelayMs;

        log.warn(`Attempt ${attempt + 1}/${opts.maxRetries + 1} failed, retrying in ${delay}ms`, {
          error: error instanceof Error ? error.message : String(error),
        });

        await sleep(delay);
      }
    }
  }

  throw lastError;
}

/**
 * Execute with a timeout. Rejects if the operation exceeds the timeout.
 */
export async function withTimeout<T>(
  fn: () => Promise<T>,
  timeoutMs: number,
  timeoutMessage = 'Operation timed out',
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);

    fn()
      .then((result) => {
        clearTimeout(timer);
        resolve(result);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

/**
 * Sleep for a specified number of milliseconds.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Determine if an HTTP error is retryable (server errors, rate limits).
 */
export function isRetryableHttpError(error: unknown): boolean {
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    // Retry on timeouts, server errors, and rate limits
    if (message.includes('timeout') || message.includes('abort')) return true;
    if (message.includes('429') || message.includes('rate limit')) return true;
    if (message.includes('500') || message.includes('502') || message.includes('503')) return true;
  }
  return false;
}
