import { createModuleLogger } from '../../../core/logger/index.js';
import { categorizeError } from '../../../core/errors.js';

const logger = createModuleLogger('automation/core/retry/retry_wrapper');

/**
 * A wrapper to retry async operations that might fail due to transient UI issues.
 * Matches the python implementation `retry_wrapper`.
 * @param {Function} asyncFn - The async function to execute.
 * @param {Object} opts - Retry options.
 * @param {string} opts.stepName - Identifying name for the step (for logging).
 * @param {number} [opts.maxRetries=2] - Maximum number of retries.
 * @param {number} [opts.delayMs=1000] - Base delay between retries.
 * @returns {Promise<any>}
 */
export async function withRetry(asyncFn, opts = {}) {
  const stepName = opts.stepName || 'unknown-step';
  const maxRetries = opts.maxRetries ?? 2;
  const baseDelay = opts.delayMs ?? 1000;

  let attempt = 1;
  while (true) {
    try {
      return await asyncFn();
    } catch (error) {
      const { category, isRetriable } = categorizeError(error);

      if (!isRetriable || attempt > maxRetries) {
        if (attempt > 1) {
          logger.error('retry_exhausted', {
            event_id: 'EVT-RTY-02',
            step: stepName,
            attempts: attempt,
            max_retries: maxRetries,
            category,
            error,
          });
        }
        throw error;
      }

      const delay = baseDelay * Math.pow(1.5, attempt - 1);
      logger.warn('retry_attempt', {
        event_id: 'EVT-RTY-01',
        step: stepName,
        attempt,
        max_retries: maxRetries,
        delay_ms: delay,
        category,
        error,
      });
      
      // Exponential backoff
      await new Promise(resolve => setTimeout(resolve, delay));
      
      attempt++;
    }
  }
}
