/**
 * core/retry/retry_wrapper.js
 *
 * Async step retry decorator.
 * MAX_RETRIES = 2, linear 1500ms delay between attempts.
 * Distinguishes retriable vs non-retriable errors by error name.
 * Emits EVT-RTY-01 (retry_attempt) and EVT-RTY-02 (retry_exhausted) log events.
 */

import { logEvent as sharedLogEvent } from '../logger/logger.js';

export const MAX_RETRIES = 2;
export const RETRY_DELAY_MS = 1500;

const MODULE = 'core/retry/retry_wrapper';

// ─── Non-retriable error names ────────────────────────────────────────────────

const NON_RETRIABLE_NAMES = new Set([
  'BrowserCrashError',
  'AutomationFatalError',
  'ArtifactWriteError',
  'OSError',
  'ProfileNotFoundError',
  'ProfilePermissionError',
  'ProfileEncodingError',
  'ProfileValidationError',
  'ResolutionError',
]);

// ─── Error classes ────────────────────────────────────────────────────────────

export class RetryExhaustedError extends Error {
  /**
   * @param {string} stepName
   * @param {number} maxRetries
   * @param {Error} lastError
   */
  constructor(stepName, maxRetries, lastError) {
    super(`Step "${stepName}" failed after ${maxRetries + 1} attempt(s): ${lastError?.message}`);
    this.name = 'RetryExhaustedError';
    this.stepName = stepName;
    this.maxRetries = maxRetries;
    this.lastError = lastError;
  }
}

export class RetrySkippedError extends Error {
  /**
   * @param {string} stepName
   * @param {number} maxRetries
   * @param {Error} lastError
   */
  constructor(stepName, maxRetries, lastError) {
    super(`Optional step "${stepName}" skipped after ${maxRetries + 1} attempt(s): ${lastError?.message}`);
    this.name = 'RetrySkippedError';
    this.stepName = stepName;
    this.maxRetries = maxRetries;
    this.lastError = lastError;
  }
}

/** @deprecated Use RetryExhaustedError instead */
export class NonRetriableError extends Error {
  constructor(message, cause) {
    super(message);
    this.name = 'NonRetriableError';
    this.retriable = false;
    if (cause !== undefined) this.cause = cause;
  }
}

// ─── Retriability check ───────────────────────────────────────────────────────

/**
 * Returns true when the error should be retried.
 * An error is non-retriable when its name is in the NON_RETRIABLE_NAMES set,
 * or when its `retriable` property is explicitly `false`.
 * @param {unknown} err
 * @returns {boolean}
 */
export function isRetriable(err) {
  if (err === null || err === undefined || typeof err !== 'object') return false;
  if ('retriable' in err && err.retriable === false) return false;
  if ('name' in err && NON_RETRIABLE_NAMES.has(err.name)) return false;
  return true;
}

// ─── Structured logger ────────────────────────────────────────────────────────

function logEvent(level, eventType, fields) {
  sharedLogEvent(level, MODULE, eventType, fields);
}

// ─── Default sleep ────────────────────────────────────────────────────────────

function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── withRetry ────────────────────────────────────────────────────────────────

/**
 * Wraps an async function with retry logic.
 *
 * @template T
 * @param {() => Promise<T>} fn
 * @param {object} [opts]
 * @param {number}   [opts.maxRetries=MAX_RETRIES]
 * @param {number}   [opts.delayMs=RETRY_DELAY_MS]
 * @param {string}   [opts.stepName='unknown']
 * @param {boolean}  [opts.required=true]  - When false, throws RetrySkippedError instead of RetryExhaustedError
 * @param {Function} [opts.sleepFn]        - Injectable sleep for testing
 * @param {Function} [opts.isRetriableFn]  - Injectable retriability check for testing
 * @returns {Promise<T>}
 */
export async function withRetry(fn, opts = {}) {
  const maxRetries    = opts.maxRetries    ?? MAX_RETRIES;
  const delayMs       = opts.delayMs       ?? RETRY_DELAY_MS;
  const stepName      = opts.stepName      ?? 'unknown';
  const required      = opts.required      !== false;
  const sleepFn       = opts.sleepFn       ?? defaultSleep;
  const isRetriableFn = opts.isRetriableFn ?? isRetriable;

  let lastError;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;

      if (!isRetriableFn(err)) {
        throw err;
      }

      const retriesLeft = maxRetries - attempt;

      if (retriesLeft > 0) {
        // EVT-RTY-01
        logEvent('WARNING', 'retry_attempt', {
          step: stepName,
          attempt: attempt + 1,
          delay: delayMs,
          retries_left: retriesLeft,
        });
        await sleepFn(delayMs);
      } else {
        // EVT-RTY-02
        logEvent('ERROR', 'retry_exhausted', {
          step: stepName,
          max_attempts: maxRetries + 1,
        });
      }
    }
  }

  if (required) {
    throw new RetryExhaustedError(stepName, maxRetries, lastError);
  } else {
    throw new RetrySkippedError(stepName, maxRetries, lastError);
  }
}

// ─── withRetryResult ─────────────────────────────────────────────────────────

/**
 * Like withRetry but returns a result object instead of throwing on exhaustion.
 * Non-retriable errors are still re-thrown.
 *
 * @template T
 * @param {() => Promise<T>} fn
 * @param {object} [opts] - Same options as withRetry
 * @returns {Promise<{success: true, value: T} | {success: false, skipped: boolean, error: Error}>}
 */
export async function withRetryResult(fn, opts = {}) {
  try {
    const value = await withRetry(fn, opts);
    return { success: true, value };
  } catch (err) {
    if (err instanceof RetryExhaustedError) {
      return { success: false, skipped: false, error: err };
    }
    if (err instanceof RetrySkippedError) {
      return { success: false, skipped: true, error: err };
    }
    // Non-retriable — propagate
    throw err;
  }
}
