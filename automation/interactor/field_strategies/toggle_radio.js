/**
 * TOGGLE/RADIO click strategies.
 */

/**
 * Click a TOGGLE only when aria-checked differs from desired state.
 * @param {import('playwright').ElementHandle} element
 * @param {string} value - "true" or "false"
 * @returns {Promise<void>}
 */
export async function fillToggle(element, value) {
  const wanted = ['true', '1', 'yes', 'y', 'on'].includes(String(value ?? '').toLowerCase());
  const current = await element.evaluate((el) => {
    if (el.getAttribute('aria-checked') != null) {
      return el.getAttribute('aria-checked') === 'true';
    }
    if (typeof el.checked === 'boolean') {
      return el.checked;
    }
    return false;
  });

  if (current !== wanted) {
    await element.click();
  }
}

/**
 * Click the target option label for a RADIO control.
 * @param {import('playwright').Page} page
 * @param {string} value
 * @returns {Promise<void>}
 */
export async function fillRadio(page, value) {
  const text = String(value ?? '');
  const selectors = [
    `[role="radio"][aria-label="${text}"]`,
    `[role="radio"]:has-text("${text}")`,
    `label:has-text("${text}")`,
    `text="${text}"`,
  ];

  for (const selector of selectors) {
    const node = await page.$(selector).catch(() => null);
    if (node) {
      await node.click();
      return;
    }
  }

  throw new Error(`Unable to locate radio option "${text}"`);
}
