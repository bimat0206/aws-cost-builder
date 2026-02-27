/**
 * SELECT/COMBOBOX option selection strategy.
 */

/**
 * Select an option by label in a SELECT element.
 * @param {import('playwright').ElementHandle} element
 * @param {string} value
 * @returns {Promise<void>}
 */
export async function fillSelect(element, value) {
  const text = String(value ?? '');
  if (typeof element.selectOption !== 'function') {
    throw new Error('Element does not support selectOption()');
  }

  // Try by label first, then by option value.
  const byLabel = await element.selectOption({ label: text }).catch(() => []);
  if (Array.isArray(byLabel) && byLabel.length > 0) return;

  const byValue = await element.selectOption({ value: text }).catch(() => []);
  if (Array.isArray(byValue) && byValue.length > 0) return;

  throw new Error(`Unable to select option "${text}"`);
}

/**
 * Click, type, and choose an option in a COMBOBOX.
 * @param {import('playwright').ElementHandle} element
 * @param {string} value
 * @returns {Promise<void>}
 */
export async function fillCombobox(element, value) {
  const text = String(value ?? '');
  await element.click();

  if (typeof element.fill === 'function') {
    await element.fill(text);
  } else if (typeof element.type === 'function') {
    await element.type(text, { delay: 10 });
  } else {
    await element.evaluate((el, next) => {
      if ('value' in el) {
        el.value = next;
        el.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }, text);
  }

  if (typeof element.press === 'function') {
    await element.press('Enter');
  }
}
