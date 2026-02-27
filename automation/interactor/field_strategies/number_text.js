/**
 * NUMBER/TEXT clear-and-fill strategy.
 */

/**
 * Clear and fill a NUMBER or TEXT input.
 * @param {import('playwright').ElementHandle} element
 * @param {string} value
 * @returns {Promise<void>}
 */
export async function fillNumberText(element, value) {
  const text = String(value ?? '');

  // Primary path for native input/textarea controls.
  try {
    if (typeof element.fill === 'function') {
      await element.fill(text);
      return;
    }
  } catch {
    // fall through to generic path
  }

  // Generic fallback for non-standard controls.
  await element.click();
  if (typeof element.press === 'function') {
    // Use platform-aware modifier for select-all.
    const selectAll = process.platform === 'darwin' ? 'Meta+A' : 'Control+A';
    await element.press(selectAll).catch(() => {});
    await element.press('Backspace').catch(() => {});
  }
  if (typeof element.type === 'function') {
    await element.type(text, { delay: 10 });
    return;
  }

  // Last resort: set value directly.
  await element.evaluate((el, next) => {
    if ('value' in el) {
      el.value = next;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }, text);
}
