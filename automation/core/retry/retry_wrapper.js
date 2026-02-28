import { logEvent } from '../../../core/logger/logger.js';
import { categorizeError } from '../../../core/errors.js';

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
             logEvent('ERROR', 'EVT-RTY-02', { step: stepName, attempts: attempt, error: error.message });
        }
        throw error;
      }

      logEvent('WARN', 'EVT-RTY-01', { step: stepName, attempt, max: maxRetries, error: error.message, category });
      
      // Exponential backoff
      const delay = baseDelay * Math.pow(1.5, attempt - 1);
      await new Promise(resolve => setTimeout(resolve, delay));
      
      attempt++;
    }
  }
}
