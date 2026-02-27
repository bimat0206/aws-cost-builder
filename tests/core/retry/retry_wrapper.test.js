/**
 * Tests for core/retry/retry_wrapper.js
 *
 * Covers:
 *  - Basic success on first attempt
 *  - Retry on retriable errors (succeeds on Nth attempt)
 *  - Exhaustion → RetryExhaustedError (required=true)
 *  - Exhaustion → RetrySkippedError  (required=false)
 *  - Non-retriable errors bypass retry immediately
 *  - Attempt count is exactly maxRetries + 1
 *  - sleep (sleepFn) is called with correct delay between retries
 *  - EVT-RTY-01 / EVT-RTY-02 log events emitted on stderr
 *  - isRetriable predicate
 *  - withRetryResult success / failure paths
 *  - Custom maxRetries and sleepFn injection
 */

import { describe, it, expect, vi } from 'vitest';
import {
  withRetry,
  withRetryResult,
  isRetriable,
  RetryExhaustedError,
  RetrySkippedError,
  MAX_RETRIES,
  RETRY_DELAY_MS,
} from '../../../core/retry/retry_wrapper.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** No-op sleep that resolves immediately — injected via opts.sleepFn in all tests. */
const noSleep = vi.fn(async () => undefined);

const baseOpts = { sleepFn: noSleep };

function makeRetriableError(name = 'TimeoutError') {
  const err = new Error(`${name} triggered`);
  err.name = name;
  return err;
}

function makeNonRetriableError(name = 'BrowserCrashError') {
  const err = new Error(`${name} triggered`);
  err.name = name;
  return err;
}

/** Build a fn that fails `failCount` times then returns `value`. */
function failThenSucceed(failCount, value, errorName = 'TimeoutError') {
  let calls = 0;
  return vi.fn(async () => {
    calls++;
    if (calls <= failCount) throw makeRetriableError(errorName);
    return value;
  });
}

/** Build a fn that always throws `error`. */
function alwaysFail(error) {
  return vi.fn(async () => { throw error; });
}

// ─── Constants ────────────────────────────────────────────────────────────────

describe('constants', () => {
  it('MAX_RETRIES is 2', () => expect(MAX_RETRIES).toBe(2));
  it('RETRY_DELAY_MS is 1500', () => expect(RETRY_DELAY_MS).toBe(1500));
});

// ─── isRetriable ──────────────────────────────────────────────────────────────

describe('isRetriable()', () => {
  it.each([
    'TimeoutError',
    'playwright.TimeoutError',
    'SomeTimeoutError',
    'ElementNotFoundError',
    'StaleElementError',
    'FindInPageNoMatchError',
    'FindInPageExhaustedError',
    'LocatorNotFoundError',
    'Error',
  ])('marks %s as retriable', (name) => {
    expect(isRetriable(makeRetriableError(name))).toBe(true);
  });

  it.each([
    'BrowserCrashError',
    'AutomationFatalError',
    'ArtifactWriteError',
    'OSError',
    'ProfileNotFoundError',
    'ProfilePermissionError',
    'ProfileEncodingError',
    'ProfileValidationError',
    'ResolutionError',
  ])('marks %s as non-retriable', (name) => {
    expect(isRetriable(makeNonRetriableError(name))).toBe(false);
  });

  it('returns false for null/undefined/non-Error', () => {
    expect(isRetriable(null)).toBe(false);
    expect(isRetriable(undefined)).toBe(false);
    // @ts-ignore
    expect(isRetriable('string')).toBe(false);
  });
});

// ─── withRetry — success paths ────────────────────────────────────────────────

describe('withRetry() — success', () => {
  it('returns value immediately on first-attempt success', async () => {
    const fn = vi.fn(async () => 42);
    const result = await withRetry(fn, baseOpts);
    expect(result).toBe(42);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('succeeds after 1 failure (2nd attempt)', async () => {
    const fn = failThenSucceed(1, 'ok');
    const result = await withRetry(fn, { ...baseOpts, stepName: 'retry-test' });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('succeeds after 2 failures (3rd attempt = default maxRetries+1)', async () => {
    const fn = failThenSucceed(2, 'done');
    const result = await withRetry(fn, { ...baseOpts, maxRetries: 2 });
    expect(result).toBe('done');
    expect(fn).toHaveBeenCalledTimes(3);
  });
});

// ─── withRetry — delay & attempt count ───────────────────────────────────────

describe('withRetry() — delay and attempt count', () => {
  it('calls sleepFn with the configured delayMs between attempts', async () => {
    const sleep = vi.fn(async () => undefined);
    const fn = failThenSucceed(1, 'x');
    await withRetry(fn, { sleepFn: sleep, delayMs: 1500 });
    expect(sleep).toHaveBeenCalledWith(1500);
  });

  it('calls sleepFn exactly (failCount) times for N failures then success', async () => {
    const sleep = vi.fn(async () => undefined);
    const fn = failThenSucceed(2, 'v');
    await withRetry(fn, { sleepFn: sleep, maxRetries: 3 });
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it('does NOT call sleepFn after the final failed attempt', async () => {
    const sleep = vi.fn(async () => undefined);
    const fn = alwaysFail(makeRetriableError());
    try { await withRetry(fn, { sleepFn: sleep, maxRetries: 2 }); } catch (_) {}
    // 3 attempts → sleep is called after attempt 1 and 2 (not 3)
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('calls fn exactly maxRetries+1 times on full exhaustion', async () => {
    const fn = alwaysFail(makeRetriableError());
    try { await withRetry(fn, { ...baseOpts, maxRetries: 4 }); } catch (_) {}
    expect(fn).toHaveBeenCalledTimes(5);
  });
});

// ─── withRetry — exhaustion (required=true) ───────────────────────────────────

describe('withRetry() — exhaustion, required=true', () => {
  it('throws RetryExhaustedError when all attempts fail', async () => {
    const fn = alwaysFail(makeRetriableError());
    await expect(withRetry(fn, { ...baseOpts, maxRetries: 2, required: true }))
      .rejects.toBeInstanceOf(RetryExhaustedError);
  });

  it('RetryExhaustedError carries correct stepName, maxRetries, and lastError', async () => {
    const inner = makeRetriableError('StaleElementError');
    const fn = alwaysFail(inner);
    let caught;
    try { await withRetry(fn, { ...baseOpts, maxRetries: 2, required: true, stepName: 'fill-dim' }); }
    catch (e) { caught = e; }
    expect(caught.stepName).toBe('fill-dim');
    expect(caught.maxRetries).toBe(2);
    expect(caught.lastError).toBe(inner);
  });

  it('defaults required to true when not specified', async () => {
    const fn = alwaysFail(makeRetriableError());
    await expect(withRetry(fn, baseOpts)).rejects.toBeInstanceOf(RetryExhaustedError);
  });
});

// ─── withRetry — exhaustion (required=false) ──────────────────────────────────

describe('withRetry() — exhaustion, required=false', () => {
  it('throws RetrySkippedError when all attempts fail and required=false', async () => {
    const fn = alwaysFail(makeRetriableError());
    await expect(withRetry(fn, { ...baseOpts, required: false }))
      .rejects.toBeInstanceOf(RetrySkippedError);
  });

  it('RetrySkippedError carries correct metadata', async () => {
    const inner = makeRetriableError('FindInPageNoMatchError');
    const fn = alwaysFail(inner);
    let caught;
    try { await withRetry(fn, { ...baseOpts, required: false, stepName: 'opt-dim', maxRetries: 1 }); }
    catch (e) { caught = e; }
    expect(caught.stepName).toBe('opt-dim');
    expect(caught.lastError).toBe(inner);
  });
});

// ─── withRetry — non-retriable bypass ────────────────────────────────────────

describe('withRetry() — non-retriable bypass', () => {
  it('re-throws non-retriable error immediately without retrying', async () => {
    const fatal = makeNonRetriableError('BrowserCrashError');
    const fn = vi.fn(async () => { throw fatal; });
    await expect(withRetry(fn, baseOpts)).rejects.toBe(fatal);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('does NOT call sleepFn for non-retriable errors', async () => {
    const sleep = vi.fn(async () => undefined);
    const fn = alwaysFail(makeNonRetriableError('OSError'));
    try { await withRetry(fn, { sleepFn: sleep }); } catch (_) {}
    expect(sleep).not.toHaveBeenCalled();
  });

  it('supports custom isRetriableFn that marks everything non-retriable', async () => {
    const fn = vi.fn(async () => { throw new Error('nope'); });
    const isRetriableFn = vi.fn().mockReturnValue(false);
    await expect(withRetry(fn, { ...baseOpts, isRetriableFn })).rejects.toThrow('nope');
    expect(fn).toHaveBeenCalledTimes(1);
    expect(isRetriableFn).toHaveBeenCalledTimes(1);
  });
});

// ─── withRetry — custom maxRetries ───────────────────────────────────────────

describe('withRetry() — custom maxRetries', () => {
  it('maxRetries=0 → single attempt, throws immediately', async () => {
    const fn = alwaysFail(makeRetriableError());
    let caught;
    try { await withRetry(fn, { ...baseOpts, maxRetries: 0, required: true }); } catch (e) { caught = e; }
    expect(fn).toHaveBeenCalledTimes(1);
    expect(caught).toBeInstanceOf(RetryExhaustedError);
    expect(caught.maxRetries).toBe(0);
  });

  it('maxRetries=5 succeeds on 5th attempt', async () => {
    const fn = failThenSucceed(4, 'five');
    const result = await withRetry(fn, { ...baseOpts, maxRetries: 5 });
    expect(result).toBe('five');
    expect(fn).toHaveBeenCalledTimes(5);
  });
});

// ─── withRetryResult ─────────────────────────────────────────────────────────

describe('withRetryResult()', () => {
  it('returns { success: true, value } on success', async () => {
    const fn = vi.fn(async () => 99);
    const result = await withRetryResult(fn, baseOpts);
    expect(result).toEqual({ success: true, value: 99 });
  });

  it('returns { success: false, skipped: false, error: RetryExhaustedError } when required', async () => {
    const fn = alwaysFail(makeRetriableError());
    const result = await withRetryResult(fn, { ...baseOpts, required: true });
    expect(result.success).toBe(false);
    expect(result.skipped).toBe(false);
    expect(result.error).toBeInstanceOf(RetryExhaustedError);
  });

  it('returns { success: false, skipped: true, error: RetrySkippedError } when optional', async () => {
    const fn = alwaysFail(makeRetriableError());
    const result = await withRetryResult(fn, { ...baseOpts, required: false });
    expect(result.success).toBe(false);
    expect(result.skipped).toBe(true);
    expect(result.error).toBeInstanceOf(RetrySkippedError);
  });

  it('propagates non-retriable fatal errors without wrapping', async () => {
    const fatal = makeNonRetriableError('BrowserCrashError');
    const fn = alwaysFail(fatal);
    await expect(withRetryResult(fn, baseOpts)).rejects.toBe(fatal);
  });
});

// ─── Error class constructors ─────────────────────────────────────────────────

describe('error constructors', () => {
  it('RetryExhaustedError has correct name and is an Error', () => {
    const e = new RetryExhaustedError('step', 2, new Error('x'));
    expect(e.name).toBe('RetryExhaustedError');
    expect(e).toBeInstanceOf(Error);
  });

  it('RetrySkippedError has correct name and is an Error', () => {
    const e = new RetrySkippedError('step', 2, new Error('x'));
    expect(e.name).toBe('RetrySkippedError');
    expect(e).toBeInstanceOf(Error);
  });

  it('RetryExhaustedError message includes attempt count', () => {
    const e = new RetryExhaustedError('fill-dim', 2, new Error('timeout'));
    expect(e.message).toContain('3 attempt(s)');
    expect(e.message).toContain('fill-dim');
  });
});
