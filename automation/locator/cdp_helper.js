/**
 * CDP Runtime.evaluate helpers.
 *
 * Provides Chrome DevTools Protocol helpers for:
 * - Retrieving Find-in-Page selection bounding rect
 * - Querying DOM elements within a vertical band
 *
 * @module automation/locator/cdp_helper
 */

// ─── CDP Session helpers ──────────────────────────────────────────────────────

/**
 * Get or create a CDP session for the page.
 * @param {import('playwright').Page} page
 * @returns {Promise<import('playwright').CDPSession>}
 */
async function getCDPSession(page) {
  const context = page.context();
  // Playwright v1.x uses context.newCDPSession
  return await context.newCDPSession(page);
}

// ─── Selection bounding rect ──────────────────────────────────────────────────

/**
 * Retrieve the bounding rect of the current Find-in-Page selection via CDP.
 *
 * Uses window.getSelection() to get the current selection range and returns
 * its bounding rectangle coordinates.
 *
 * @param {import('playwright').Page} page
 * @returns {Promise<{ top: number, bottom: number, left: number, right: number, width: number, height: number }|null>}
 *   Returns null if no selection exists
 */
export async function getSelectionBoundingRect(page) {
  try {
    const cdpSession = await getCDPSession(page);

    // Evaluate JavaScript to get selection bounding rect
    const result = await cdpSession.send('Runtime.evaluate', {
      expression: `
        (function() {
          const selection = window.getSelection();
          if (!selection || selection.rangeCount === 0) {
            return null;
          }
          const range = selection.getRangeAt(0);
          const rect = range.getBoundingClientRect();
          if (!rect || rect.width === 0 || rect.height === 0) {
            return null;
          }
          return {
            top: rect.top,
            bottom: rect.bottom,
            left: rect.left,
            right: rect.right,
            width: rect.width,
            height: rect.height
          };
        })()
      `,
      returnByValue: true,
    });

    return result.result.value;
  } catch (error) {
    // If CDP fails, try fallback via page.evaluate
    try {
      return await page.evaluate(() => {
        const selection = window.getSelection();
        if (!selection || selection.rangeCount === 0) {
          return null;
        }
        const range = selection.getRangeAt(0);
        const rect = range.getBoundingClientRect();
        if (!rect || rect.width === 0 || rect.height === 0) {
          return null;
        }
        return {
          top: rect.top,
          bottom: rect.bottom,
          left: rect.left,
          right: rect.right,
          width: rect.width,
          height: rect.height,
        };
      });
    } catch {
      return null;
    }
  }
}

// ─── Query controls in band ───────────────────────────────────────────────────

/**
 * Query interactive DOM controls within a vertical band around a match.
 *
 * Searches for form controls (inputs, selects, buttons, etc.) within
 * ±bandPx pixels of the match's vertical position.
 *
 * Priority order for element types:
 * 1. input[type=number]
 * 2. input[type=text]
 * 3. select
 * 4. [role=combobox]
 * 5. [role=spinbutton]
 * 6. [role=switch]
 * 7. [role=radio]
 * 8. [role=listbox]
 * 9. textarea
 * 10. [contenteditable]
 *
 * @param {import('playwright').Page} page
 * @param {number} matchTop - Vertical position of the match (pixels from top)
 * @param {number} bandPx - Half-height of the search band (default: 150px)
 * @returns {Promise<Array<{ selector: string, top: number, fieldType: string, label?: string }>>}
 */
export async function queryControlsInBand(page, matchTop, bandPx = 150) {
  try {
    const cdpSession = await getCDPSession(page);

    // Evaluate JavaScript to find controls in the vertical band
    const result = await cdpSession.send('Runtime.evaluate', {
      expression: `
        (function(matchTop, bandPx) {
          const minTop = matchTop - bandPx;
          const maxTop = matchTop + bandPx;

          // Selector priority order
          const selectors = [
            'input[type="number"]',
            'input[type="text"]',
            'select',
            '[role="combobox"]',
            '[role="spinbutton"]',
            '[role="switch"]',
            '[role="radio"]',
            '[role="listbox"]',
            'textarea',
            '[contenteditable="true"]',
            '[contenteditable]'
          ];

          const prioritizedResults = [];

          for (const selector of selectors) {
            const elements = document.querySelectorAll(selector);
            const selectorMatches = [];
            
            for (const el of elements) {
              const rect = el.getBoundingClientRect();
              const isVisible = rect.width > 0 && rect.height > 0;
              const isInBand = rect.top >= minTop && rect.top <= maxTop;

              if (isVisible && isInBand) {
                // Get associated label if any
                let label = null;
                const id = el.id;
                if (id) {
                  const labelEl = document.querySelector('label[for="' + id + '"]');
                  if (labelEl) {
                    label = labelEl.textContent.trim();
                  }
                }
                // Check for wrapping label
                if (!label) {
                  const parentLabel = el.closest('label');
                  if (parentLabel) {
                    label = parentLabel.textContent.trim();
                  }
                }
                // Check aria-label
                if (!label && el.getAttribute('aria-label')) {
                  label = el.getAttribute('aria-label');
                }
                // Check placeholder
                if (!label && el.placeholder) {
                  label = el.placeholder;
                }

                selectorMatches.push({
                  selector: el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (el.className ? '.' + el.className.split(' ').join('.') : ''),
                  top: rect.top,
                  fieldType: el.type || el.tagName.toLowerCase(),
                  label: label
                });
              }
            }
            
            // Sort matches for THIS selector by proximity to matchTop
            selectorMatches.sort((a, b) => Math.abs(a.top - matchTop) - Math.abs(b.top - matchTop));
            
            // Push all matches for this high-priority selector
            prioritizedResults.push(...selectorMatches);
          }

          return prioritizedResults;
        })(${matchTop}, ${bandPx})
      `,
      returnByValue: true,
    });

    return result.result.value || [];
  } catch (error) {
    // Fallback via page.evaluate
    try {
      return await page.evaluate((params) => {
        const { matchTop, bandPx } = params;
        const minTop = matchTop - bandPx;
        const maxTop = matchTop + bandPx;

        const selectors = [
          'input[type="number"]',
          'input[type="text"]',
          'select',
          '[role="combobox"]',
          '[role="spinbutton"]',
          '[role="switch"]',
          '[role="radio"]',
          '[role="listbox"]',
          'textarea',
          '[contenteditable="true"]',
          '[contenteditable]',
        ];

        const prioritizedResults = [];

        for (const selector of selectors) {
          const elements = document.querySelectorAll(selector);
          const selectorMatches = [];
          
          for (const el of elements) {
            const rect = el.getBoundingClientRect();
            const isVisible = rect.width > 0 && rect.height > 0;
            const isInBand = rect.top >= minTop && rect.top <= maxTop;

            if (isVisible && isInBand) {
              let label = null;
              const id = el.id;
              if (id) {
                const labelEl = document.querySelector('label[for="' + id + '"]');
                if (labelEl) {
                  label = labelEl.textContent.trim();
                }
              }
              if (!label) {
                const parentLabel = el.closest('label');
                if (parentLabel) {
                  label = parentLabel.textContent.trim();
                }
              }
              if (!label && el.getAttribute('aria-label')) {
                label = el.getAttribute('aria-label');
              }
              if (!label && el.placeholder) {
                label = el.placeholder;
              }

              selectorMatches.push({
                selector: el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (el.className ? '.' + el.className.split(' ').join('.') : ''),
                top: rect.top,
                fieldType: el.type || el.tagName.toLowerCase(),
                label: label,
              });
            }
          }
          
          // Sort matches for THIS selector by proximity
          selectorMatches.sort((a, b) => Math.abs(a.top - matchTop) - Math.abs(b.top - matchTop));
          
          // Push all matches for this high-priority selector
          prioritizedResults.push(...selectorMatches);
        }

        return prioritizedResults;
      }, { matchTop, bandPx });
    } catch {
      return [];
    }
  }
}

// ─── Additional CDP helpers ───────────────────────────────────────────────────

/**
 * Scroll the page to bring an element into view.
 * @param {import('playwright').Page} page
 * @param {number} y - Vertical position to scroll to
 * @returns {Promise<void>}
 */
export async function scrollToPosition(page, y) {
  await page.evaluate((scrollY) => {
    window.scrollTo({ top: scrollY, behavior: 'smooth' });
  }, y);
  await page.waitForTimeout(300);
}

/**
 * Get the viewport height.
 * @param {import('playwright').Page} page
 * @returns {Promise<number>}
 */
export async function getViewportHeight(page) {
  return await page.evaluate(() => window.innerHeight);
}

/**
 * Check if an element is currently visible in the viewport.
 * @param {import('playwright').Page} page
 * @param {import('playwright').ElementHandle} element
 * @returns {Promise<boolean>}
 */
export async function isElementInViewport(page, element) {
  return await element.evaluate((el) => {
    const rect = el.getBoundingClientRect();
    const viewportHeight = window.innerHeight;
    return rect.top >= 0 && rect.bottom <= viewportHeight;
  });
}
