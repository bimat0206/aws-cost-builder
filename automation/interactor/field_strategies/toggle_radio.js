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
      const child = page.locator(selector).first();
      await child.waitFor({ state: 'attached', timeout: 500 }).catch(() => {});
      const count = await child.count().catch(() => 0);
      if (count > 0) {
        await child.waitFor({ state: 'visible', timeout: 1000 }).catch(() => {});
        return await child.elementHandle() || locator;
      }
    } catch {}
  }

  const escapedKey = escapeCssString(dimensionKey);
  try {
    const direct = page.locator(`
      input[type='checkbox'][aria-label*="${escapedKey}" i], 
      [role='switch'][aria-label*="${escapedKey}" i], 
      [role='checkbox'][aria-label*="${escapedKey}" i], 
      button[aria-pressed][aria-label*="${escapedKey}" i], 
      button[aria-expanded][aria-label*="${escapedKey}" i]
    `).first();
    await direct.waitFor({ state: 'attached', timeout: 500 }).catch(() => {});
    const count = await direct.count().catch(() => 0);
    if (count > 0) {
      await direct.waitFor({ state: 'visible', timeout: 1000 }).catch(() => {});
      return await direct.elementHandle() || locator;
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
  
  // Cloudscape + Native fallback selectors
  const selectors = [
    `[role="radio"][aria-label*="${escapeCssString(text)}" i]`,
    `label:has-text("${escapeCssString(text)}") + input[type="radio"]`,
    `input[type="radio"][value="${escapeCssString(text)}" i]`,
    `[role="radio"]:has-text("${escapeCssString(text)}")`,
  ];

  for (const selector of selectors) {
    try {
      const node = page.locator(selector).first();
      await node.waitFor({ state: 'attached', timeout: 500 }).catch(() => {});
      const count = await node.count().catch(() => 0);
      if (count > 0) {
        await node.waitFor({ state: 'visible', timeout: 1500 }).catch(() => {});
        await node.scrollIntoViewIfNeeded().catch(() => {});
        await node.click();
        return;
      }
    } catch {}
  }

  // Final fallback using getByText proximity up tree
  try {
    const node = page.getByText(text, { exact: false }).first();
    await node.waitFor({ state: 'visible', timeout: 1000 }).catch(() => {});
    const radio = node.locator('xpath=./ancestor-or-self::label//input[type="radio"] | ./ancestor-or-self::*[@role="radio"]').first();
    const count = await radio.count().catch(() => 0);
    if (count > 0) {
      await radio.scrollIntoViewIfNeeded().catch(() => {});
      await radio.click();
      return;
    }
  } catch {}

  throw new Error(`[E-FIELD-003] RADIO option '${text}' for dimension '${dimensionKey}' not found.`);
}
