/**
 * SELECT/COMBOBOX option selection strategy.
 */

/**
 * Normalize option labels for tolerant matching across UI variants.
 * @param {string} value
 * @returns {string}
 */
function normalize(value) {
  return String(value || '').replace(/[^a-z0-9]+/g, '').trim().toLowerCase();
}

/**
 * Try to click a custom option inside a Cloudscape dropdown.
 * @param {import('playwright').Page} page
 * @param {string} value
 * @returns {Promise<boolean>}
 */
async function clickCustomOption(page, value) {
  // Strategy 1: ARIA option by exact accessible name
  try {
    const option = page.getByRole('option', { name: value, exact: true }).first();
    await option.waitFor({ state: 'visible', timeout: 1200 });
    await option.click();
    return true;
  } catch {}

  // Strategy 2: visible role option by substring text
  try {
    const option = page.locator('[role="option"]:visible').filter({ hasText: value }).first();
    await option.waitFor({ state: 'visible', timeout: 1200 });
    await option.click();
    return true;
  } catch {}

  // Strategy 3: normalized match against role='option' / data-value entries
  const target = normalize(value);
  const candidates = page.locator('[role="option"]:visible, [data-value]:visible');
  
  try {
    await candidates.first().waitFor({ state: 'visible', timeout: 2500 });
  } catch {}
  
  const count = await candidates.count().catch(() => 0);
  for (let i = 0; i < count; i++) {
    const option = candidates.nth(i);
    try {
      const text = (await option.innerText().catch(() => '')) || '';
      const dataValue = (await option.getAttribute('data-value').catch(() => '')) || '';
      
      if (target === normalize(text) || target === normalize(dataValue)) {
        await option.click();
        return true;
      }
    } catch {
      continue;
    }
  }

  return false;
}

/**
 * Select an option by label in a native select or custom Cloudscape dropdown.
 * @param {import('playwright').Page} page
 * @param {import('playwright').ElementHandle} element
 * @param {string} value
 * @returns {Promise<void>}
 */
export async function fillSelect(page, element, value) {
  const text = String(value ?? '');

  // Native select path.
  try {
    if (typeof element.selectOption === 'function') {
      const res = await element.selectOption({ label: text });
      if (res && res.length > 0) return;
    }
  } catch {}

  // Custom dropdown path.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await element.scrollIntoViewIfNeeded({ timeout: 1000 }).catch(() => {});
      await element.click({ timeout: 2000, force: true }).catch(() => {});
      await page.waitForTimeout(300);

      if (await clickCustomOption(page, text)) return;

      // Some Cloudscape dropdowns open via keyboard interaction.
      await element.press('ArrowDown').catch(() => {});
      await page.waitForTimeout(250);
      
      if (await clickCustomOption(page, text)) return;
    } catch {}
  }

  throw new Error(`SELECT option '${text}' not found in visible dropdown options.`);
}

/**
 * Click, type, and choose an option in a COMBOBOX.
 * @param {import('playwright').Page} page
 * @param {import('playwright').ElementHandle} element
 * @param {string} value
 * @returns {Promise<void>}
 */
export async function fillCombobox(page, element, value) {
  const text = String(value ?? '');
  
  // Fallback for cases where locator anchored to nearby label/description is handled in findElement tier 4
  await element.click();
  await element.fill(text);
  await page.waitForTimeout(300);

  // Prefer selecting an explicit option if dropdown opens.
  try {
    const option = page.getByRole('option', { name: text, exact: false }).first();
    await option.waitFor({ state: 'visible', timeout: 1000 });
    await option.click();
  } catch {
    // Some comboboxes accept Enter on typed value.
    const currentValue = await element.inputValue().catch(() => '');
    if (!currentValue.toLowerCase().includes(text.toLowerCase())) {
      await element.press('Enter');
    }
  }

  const finalValue = await element.inputValue().catch(() => '');
  if (!finalValue.toLowerCase().includes(text.toLowerCase())) {
    throw new Error(`COMBOBOX value '${text}' not applied. Final value: '${finalValue}'.`);
  }
}
