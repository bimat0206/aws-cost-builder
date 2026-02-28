/**
 * Field interactor — dispatch fill by field_type with verification.
 *
 * Matches Python's field_interactor.py logic:
 * - Fill/select/click based on field_type
 * - Verify value was accepted
 * - Capture screenshot on failure
 * - Return detailed result object
 */

import { withRetry } from '../../core/retry/retry_wrapper.js';
import { fillNumberText } from './field_strategies/number_text.js';
import { fillSelect, fillCombobox } from './field_strategies/select_combobox.js';
import { fillToggle, fillRadio } from './field_strategies/toggle_radio.js';
import { fillInstanceSearch } from './field_strategies/instance_search.js';

/**
 * @typedef {Object} DimensionFillResult
 * @property {string} dimensionKey
 * @property {'success'|'skipped'|'failed'} status
 * @property {string} message
 * @property {number} retriesUsed
 * @property {string|null} screenshot
 * @property {string} [inferredFieldType]
 * @property {boolean} [verified]
 */

/**
 * Verify a field value was accepted.
 * @param {import('playwright').ElementHandle} element
 * @param {string} fieldType
 * @param {string} expectedValue
 * @returns {Promise<boolean>}
 */
export async function verifyFieldValue(element, fieldType, expectedValue) {
  try {
    const normalizedType = String(fieldType ?? 'TEXT').toUpperCase();
    
    if (normalizedType === 'TOGGLE') {
      // Verify toggle state
      const isChecked = await element.evaluate((el) => {
        if (el.tagName.toLowerCase() === 'input') {
          return /** @type {HTMLInputElement} */ (el).checked;
        }
        return el.getAttribute('aria-checked') === 'true';
      });
      const expectedChecked = String(expectedValue).toLowerCase() === 'true' || expectedValue === '1';
      return isChecked === expectedChecked;
    }
    
    if (normalizedType === 'RADIO') {
      // Verify radio is selected
      const isSelected = await element.evaluate((el) => {
        if (el.tagName.toLowerCase() === 'input') {
          return /** @type {HTMLInputElement} */ (el).checked;
        }
        return el.getAttribute('aria-checked') === 'true';
      });
      return isSelected;
    }
    
    if (normalizedType === 'SELECT') {
      // Verify selected option
      const selectedValue = await element.evaluate((el) => {
        if (el.tagName.toLowerCase() === 'select') {
          return /** @type {HTMLSelectElement} */ (el).value;
        }
        return el.getAttribute('data-value') || el.textContent;
      });
      return selectedValue && selectedValue.toLowerCase().includes(String(expectedValue).toLowerCase());
    }
    
    if (normalizedType === 'NUMBER' || normalizedType === 'TEXT') {
      // Verify input value
      const inputValue = await element.evaluate((el) => {
        return /** @type {HTMLInputElement|HTMLTextAreaElement} */ (el).value;
      });
      return String(inputValue) === String(expectedValue);
    }
    
    // For COMBOBOX and other types, assume success if no error
    return true;
  } catch {
    return false;
  }
}

/**
 * Fill a located DOM element with a resolved value based on field_type.
 * Includes verification and screenshot on failure.
 *
 * @param {import('playwright').ElementHandle} element
 * @param {string} fieldType
 * @param {string} value
 * @param {object} [opts]
 * @param {import('playwright').Page} [opts.page]
 * @param {string} [opts.dimensionKey]
 * @param {boolean} [opts.required]
 * @param {number} [opts.maxRetries]
 * @param {string} [opts.screenshotsDir]
 * @param {string} [opts.runId]
 * @param {string} [opts.groupName]
 * @param {string} [opts.serviceName]
 * @returns {Promise<DimensionFillResult>}
 */
export async function fillDimension(element, fieldType, value, opts = {}) {
  const {
    page = null,
    dimensionKey = 'unknown',
    required = true,
    maxRetries = 2,
    screenshotsDir = null,
    runId = null,
    groupName = null,
    serviceName = null,
  } = opts;

  let retriesUsed = 0;
  const normalizedType = String(fieldType ?? 'TEXT').toUpperCase();

  /**
   * Capture screenshot on failure.
   * @returns {Promise<string|null>}
   */
  const captureScreenshot = async () => {
    if (!page || !screenshotsDir || !runId || !groupName || !serviceName) {
      return null;
    }
    try {
      const { buildScreenshotPath } = await import('../../core/emitter/screenshot_manager.js');
      const screenshotPath = buildScreenshotPath(
        screenshotsDir,
        runId,
        groupName,
        serviceName,
        `fill_fail_${dimensionKey}`
      );
      await page.screenshot({ path: screenshotPath });
      return screenshotPath;
    } catch {
      return null;
    }
  };

  const runOnce = async () => {
    retriesUsed += 1;
    
    switch (normalizedType) {
      case 'NUMBER':
      case 'TEXT':
        await fillNumberText(element, value, normalizedType);
        break;
      case 'SELECT':
        if (!page) throw new Error('SELECT interaction requires page in opts');
        await fillSelect(page, element, value);
        break;
      case 'COMBOBOX':
        if (!page) throw new Error('COMBOBOX interaction requires page in opts');
        await fillCombobox(page, element, value);
        break;
      case 'TOGGLE':
        if (!page) throw new Error('TOGGLE interaction requires page in opts');
        await fillToggle(page, element, dimensionKey, value);
        break;
      case 'RADIO':
        if (!page) throw new Error('RADIO interaction requires page in opts');
        await fillRadio(page, dimensionKey, value);
        break;
      case 'INSTANCE_SEARCH':
        if (!page) throw new Error('INSTANCE_SEARCH interaction requires page in opts');
        await fillInstanceSearch(page, element, value);
        break;
      default:
        // Graceful fallback for unknown types.
        await fillNumberText(element, value, normalizedType);
    }
    
    // Skip verification for INSTANCE_SEARCH since it's a complex table select
    if (normalizedType !== 'INSTANCE_SEARCH') {
      const verified = await verifyFieldValue(element, fieldType, value);
      if (!verified) {
        throw new Error(`Value verification failed for ${dimensionKey}: expected "${value}"`);
      }
    }
  };

  try {
    await withRetry(
      async () => {
        await runOnce();
      },
      {
        stepName: `fill-dimension-${dimensionKey}`,
        maxRetries,
        delayMs: 1500,
        required,
      },
    );

    return {
      dimensionKey,
      status: 'success',
      message: `Filled ${dimensionKey} (${normalizedType})`,
      retriesUsed: Math.max(0, retriesUsed - 1),
      screenshot: null,
      inferredFieldType: fieldType,
      verified: true,
    };
  } catch (error) {
    const screenshotPath = await captureScreenshot();
    
    if (!required) {
      return {
        dimensionKey,
        status: 'skipped',
        message: `Skipped optional ${dimensionKey}: ${error.message}`,
        retriesUsed: Math.max(0, retriesUsed - 1),
        screenshot: null,
        inferredFieldType: fieldType,
        verified: false,
      };
    }
    return {
      dimensionKey,
      status: 'failed',
      message: `Failed to fill ${dimensionKey}: ${error.message}`,
      retriesUsed: Math.max(0, retriesUsed - 1),
      screenshot: screenshotPath,
      inferredFieldType: fieldType,
      verified: false,
    };
  }
}
