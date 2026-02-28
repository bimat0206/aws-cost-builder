/**
 * TOGGLE/RADIO click strategies.
 */

/**
 * Read toggle state across checkbox/switch/button implementations.
 * @param {import('playwright').ElementHandle} locator
 * @returns {Promise<boolean | null>}
 */
async function readToggleState(locator) {
  try {
    const isChecked = await locator.isChecked().catch(() => null);
    if (typeof isChecked === 'boolean') return isChecked;
  } catch {}

  const attrs = ['aria-checked', 'aria-pressed', 'aria-expanded', 'data-checked', 'data-selected'];
  
  for (const attr of attrs) {
    try {
      const raw = await locator.getAttribute(attr);
      if (raw === null) continue;

      const normalized = raw.trim().toLowerCase();
      if (['true', '1', 'on', 'yes', 'mixed'].includes(normalized)) return true;
      if (['false', '0', 'off', 'no'].includes(normalized)) return false;
    } catch {
      continue;
    }
  }

  return null;
}

/**
 * Return true if the element itself looks like a toggle control.
 * @param {import('playwright').ElementHandle} locator
 * @returns {Promise<boolean>}
 */
async function isToggleLike(locator) {
  try {
    return await locator.evaluate(
      `(el) => el.matches("input[type='checkbox'], input[type='radio'], [role='switch'], [role='checkbox'], button[aria-pressed], button[aria-expanded]")`
    );
  } catch {
    return false;
  }
}

/**
 * Escape CSS string.
 * @param {string} value 
 * @returns {string}
 */
function escapeCssString(value) {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/**
 * Resolve an actionable toggle control for the requested dimension.
 * @param {import('playwright').Page} page
 * @param {import('playwright').ElementHandle} locator
 * @param {string} dimensionKey
 * @returns {Promise<import('playwright').ElementHandle>}
 */
async function resolveToggleTarget(page, locator, dimensionKey) {
  if (await isToggleLike(locator)) {
    return locator;
  }

  const selectors = [
    "input[type='checkbox']",
    "input[type='radio']",
    "[role='switch']",
    "[role='checkbox']",
    "button[aria-pressed]",
    "button[aria-expanded]",
  ];

  for (const selector of selectors) {
    try {
      const child = await locator.$(selector);
      if (child) {
        await child.waitForElementState('visible', { timeout: 1000 });
        return child;
      }
    } catch {}
  }

  const escapedKey = escapeCssString(dimensionKey);
  try {
    const direct = await page.$(`
      input[type='checkbox'][aria-label*="${escapedKey}" i], 
      [role='switch'][aria-label*="${escapedKey}" i], 
      [role='checkbox'][aria-label*="${escapedKey}" i], 
      button[aria-pressed][aria-label*="${escapedKey}" i], 
      button[aria-expanded][aria-label*="${escapedKey}" i]
    `);
    if (direct) {
      await direct.waitForElementState('visible', { timeout: 1000 }).catch(() => {});
      return direct;
    }
  } catch {}

  return locator;
}

/**
 * Set a toggle control to checked/on (truthy) or unchecked/off (falsy).
 * @param {import('playwright').Page} page
 * @param {import('playwright').ElementHandle} element
 * @param {string} dimensionKey
 * @param {string} value - "true" or "false"
 * @returns {Promise<void>}
 */
export async function fillToggle(page, element, dimensionKey, value) {
  const wantChecked = ['true', 'yes', '1', 'on', 'enabled'].includes(String(value ?? '').toLowerCase());

  const target = await resolveToggleTarget(page, element, dimensionKey);
  const current = await readToggleState(target);

  if (current === null) {
    // Unknown state: avoid toggling optional controls off accidentally.
    if (wantChecked) {
      await target.click();
    }
    return;
  }

  if (current !== wantChecked) {
    await target.click();
  }
}

/**
 * Click a radio button whose label matches *value*.
 * @param {import('playwright').Page} page
 * @param {string} dimensionKey
 * @param {string} value
 * @returns {Promise<void>}
 */
export async function fillRadio(page, dimensionKey, value) {
  const text = String(value ?? '');
  
  // Try to locate the radio by its label text within a fieldset
  try {
    const selector = `input[type='radio'][value='${text}']`;
    const radio = page.locator(selector).first();
    await radio.waitFor({ state: 'visible', timeout: 2000 });
    await radio.click();
    return;
  } catch {}

  // Fallback
  const selectors = [
    `[role="radio"][aria-label="${text}"]`,
    `[role="radio"]:has-text("${text}")`,
    `label:has-text("${text}")`,
    `text="${text}"`,
  ];

  for (const selector of selectors) {
    try {
      const node = await page.$(selector);
      if (node) {
        await node.click();
        return;
      }
    } catch {}
  }

  throw new Error(`[E-FIELD-003] RADIO option '${text}' for dimension '${dimensionKey}' not found.`);
}
