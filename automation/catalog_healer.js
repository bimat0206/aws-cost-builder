/**
 * Catalog healer — auto-corrects stale selectors.
 *
 * Matches Python's catalog_healer.py logic:
 * - Detects when catalog selectors are stale
 * - Auto-discovers new selectors via DOM scanning
 * - Updates catalog in-memory with corrected selectors
 * - Logs corrections for later catalog updates
 *
 * @module automation/catalog_healer
 */

import { logEvent as sharedLogEvent } from '../core/index.js';

// ─── Logging helpers ──────────────────────────────────────────────────────────

const MODULE = 'automation/catalog_healer';

/**
 * Format and print a structured log line.
 * @param {string} level
 * @param {string} eventType
 * @param {Object} fields
 */
function logEvent(level, eventType, fields = {}) {
  sharedLogEvent(level, MODULE, eventType, fields);
}

// ─── Selector discovery ───────────────────────────────────────────────────────

/**
 * Discover selector for an element by its label.
 * @param {import('playwright').Page} page
 * @param {string} label
 * @returns {Promise<string | null>}
 */
export async function discoverSelectorByLabel(page, label) {
  try {
    // Try aria-label first
    const ariaSelector = `[aria-label*="${escapeCssString(label)}" i]`;
    const ariaCandidates = page.locator(ariaSelector);
    if (await ariaCandidates.count() > 0) {
      return ariaSelector;
    }

    // Try role + name
    const roles = ['checkbox', 'switch', 'radio', 'spinbutton', 'combobox', 'textbox'];
    for (const role of roles) {
      const roleCandidates = page.getByRole(role, { name: label, exact: false });
      if (await roleCandidates.count() > 0) {
        const element = await roleCandidates.first().elementHandle();
        if (element) {
          return await generateSelector(element);
        }
      }
    }

    // Try text content
    const textCandidates = page.getByText(label, { exact: false });
    if (await textCandidates.count() > 0) {
      const element = await textCandidates.first().elementHandle();
      if (element) {
        // Find nearest control
        const control = await findNearestControl(element);
        if (control) {
          return await generateSelector(control);
        }
      }
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Generate a stable CSS selector for an element.
 * @param {import('playwright').ElementHandle} element
 * @returns {Promise<string>}
 */
export async function generateSelector(element) {
  try {
    const selector = await element.evaluate((el) => {
      // Prefer id
      if (el.id) {
        return `#${CSS.escape(el.id)}`;
      }

      // Prefer data-testid
      const testId = el.getAttribute('data-testid');
      if (testId) {
        return `[data-testid="${CSS.escape(testId)}"]`;
      }

      // Use tag + class + nth-child
      let selector = el.tagName.toLowerCase();

      const className = el.className?.toString().trim();
      if (className) {
        const classes = className.split(/\s+/).slice(0, 2).filter(Boolean);
        for (const cls of classes) {
          selector += `.${CSS.escape(cls)}`;
        }
      }

      // Add nth-child for uniqueness
      const parent = el.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter(
          (sibling) => sibling.tagName === el.tagName
        );
        if (siblings.length > 1) {
          const index = siblings.indexOf(el) + 1;
          selector += `:nth-child(${index})`;
        }
      }

      return selector;
    });

    return selector || 'unknown';
  } catch {
    return 'unknown';
  }
}

/**
 * Find nearest interactive control from a text element.
 * @param {import('playwright').ElementHandle} textElement
 * @returns {Promise<import('playwright').ElementHandle | null>}
 */
async function findNearestControl(textElement) {
  try {
    const control = await textElement.evaluateHandle((el) => {
      const parent = el.parentElement;
      if (!parent) return null;

      const selectors = [
        'input:not([type="hidden"])',
        'select',
        'textarea',
        '[role="combobox"]',
        '[role="switch"]',
        '[role="checkbox"]',
        '[role="radio"]',
        '[role="spinbutton"]',
      ];

      for (const selector of selectors) {
        const control = parent.querySelector(selector);
        if (control) return control;
      }

      // Look in next sibling
      const next = el.nextElementSibling;
      if (next) {
        for (const selector of selectors) {
          const control = next.querySelector(selector);
          if (control) return control;
        }
      }

      return null;
    });

    return control;
  } catch {
    return null;
  }
}

/**
 * Escape CSS string for safe use in selectors.
 * @param {string} value
 * @returns {string}
 */
function escapeCssString(value) {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

// ─── Catalog healer ───────────────────────────────────────────────────────────

/**
 * Catalog healer — detects and corrects stale selectors.
 * Matches Python's CatalogHealer.
 */
export class CatalogHealer {
  /**
   * @param {import('playwright').Page} page
   * @param {string} serviceName
   */
  constructor(page, serviceName) {
    this.page = page;
    this.serviceName = serviceName;
    /** @type {Map<string, string>} */
    this.corrections = new Map();
    /** @type {string[]} */
    this.healedDimensions = [];
  }

  /**
   * Attempt to heal a dimension with a stale selector.
   * @param {string} dimensionKey
   * @param {string} staleSelector
   * @returns {Promise<string | null>} - New selector or null if healing failed
   */
  async healDimension(dimensionKey, staleSelector) {
    logEvent('INFO', 'EVT-HEL-01', {
      dimension: dimensionKey,
      old_selector: staleSelector,
      step: 'attempting_heal',
    });

    // Try to discover new selector
    const newSelector = await discoverSelectorByLabel(this.page, dimensionKey);

    if (newSelector) {
      // Verify the new selector works
      try {
        const candidates = this.page.locator(newSelector);
        const count = await candidates.count();
        if (count > 0) {
          await candidates.first().waitForElementState('visible', { timeout: 2000 });

          // Record correction
          this.corrections.set(staleSelector, newSelector);
          this.healedDimensions.push(dimensionKey);

          logEvent('INFO', 'EVT-HEL-02', {
            dimension: dimensionKey,
            new_selector: newSelector,
            status: 'healed',
          });

          return newSelector;
        }
      } catch {
        // Selector didn't work
      }
    }

    logEvent('WARN', 'EVT-HEL-03', {
      dimension: dimensionKey,
      status: 'heal_failed',
    });

    return null;
  }

  /**
   * Get all corrections made.
   * @returns {Map<string, string>}
   */
  getCorrections() {
    return new Map(this.corrections);
  }

  /**
   * Get healed dimension keys.
   * @returns {string[]}
   */
  getHealedDimensions() {
    return [...this.healedDimensions];
  }

  /**
   * Get corrections count.
   * @returns {number}
   */
  getCorrectionsCount() {
    return this.corrections.size;
  }

  /**
   * Export corrections for catalog update.
   * @returns {object}
   */
  exportCorrections() {
    return {
      serviceName: this.serviceName,
      healedAt: new Date().toISOString(),
      corrections: Array.from(this.corrections.entries()).map(([oldSel, newSel]) => ({
        old_selector: oldSel,
        new_selector: newSel,
      })),
      healedDimensions: this.healedDimensions,
    };
  }
}
