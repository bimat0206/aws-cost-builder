/**
 * Calculator group creation and selection.
 *
 * Manages creating or targeting named groups in the AWS Calculator.
 * Emits EVT-GRP-01 log event on group creation/selection.
 *
 * @module automation/navigation/group_manager
 */

import { withRetry } from '../../core/retry/retry_wrapper.js';

const MODULE = 'automation/navigation/group_manager';

/**
 * Format and print a structured log line.
 * @param {string} level
 * @param {string} eventType
 * @param {Object} fields
 */
function logEvent(level, eventType, fields = {}) {
  const ts = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const fieldStr = Object.entries({ event_type: eventType, ...fields })
    .map(([k, v]) => `${k}=${v}`)
    .join(' ');
  process.stderr.write(`${ts} | ${level.padEnd(8)} | ${MODULE.padEnd(30)} | ${fieldStr}\n`);
}

// ─── Group management ─────────────────────────────────────────────────────────

/**
 * Check if a group with the given name exists.
 * @param {import('playwright').Page} page
 * @param {string} groupName
 * @returns {Promise<boolean>}
 */
async function groupExists(page, groupName) {
  // Look for group element with matching name
  const groupSelector = `[data-testid="group-name"]:has-text("${groupName}")`;
  const element = await page.$(groupSelector);
  return element !== null;
}

/**
 * Create a new group in the AWS Calculator.
 * @param {import('playwright').Page} page
 * @param {string} groupName
 * @returns {Promise<void>}
 */
async function createGroup(page, groupName) {
  logEvent('INFO', 'EVT-GRP-01', { name: groupName, status: 'creating' });

  // Click the "Add group" button
  const addGroupButton = await page.$('[data-testid="add-group-button"],button:has-text("Add group")');
  if (!addGroupButton) {
    throw new Error('Could not find "Add group" button');
  }
  await addGroupButton.click();
  await page.waitForTimeout(500);

  // Enter group name
  const nameInput = await page.$('[data-testid="group-name-input"], input[placeholder*="group name" i]');
  if (!nameInput) {
    throw new Error('Could not find group name input');
  }
  await nameInput.fill(groupName);
  await page.waitForTimeout(300);

  // Click create/confirm button
  const createButton = await page.$('[data-testid="create-group-confirm"], button:has-text("Create"), button:has-text("Add")');
  if (!createButton) {
    throw new Error('Could not find create group confirm button');
  }
  await createButton.click();
  await page.waitForTimeout(500);

  logEvent('INFO', 'EVT-GRP-01', { name: groupName, status: 'created' });
}

/**
 * Select/target an existing group.
 * @param {import('playwright').Page} page
 * @param {string} groupName
 * @returns {Promise<void>}
 */
async function selectGroup(page, groupName) {
  logEvent('INFO', 'EVT-GRP-01', { name: groupName, status: 'selecting' });

  // Click on the group to select it
  const groupSelector = `[data-testid="group-item"]:has-text("${groupName}")`;
  const groupElement = await page.$(groupSelector);
  if (!groupElement) {
    throw new Error(`Group not found: ${groupName}`);
  }
  await groupElement.click();
  await page.waitForTimeout(300);

  logEvent('INFO', 'EVT-GRP-01', { name: groupName, status: 'selected' });
}

/**
 * Create or target a named group in the AWS Calculator.
 *
 * If the group exists, selects it. Otherwise, creates it.
 * Wrapped in retry logic for resilience.
 *
 * @param {import('playwright').Page} page
 * @param {string} groupName
 * @returns {Promise<void>}
 * @throws {Error} If group creation/selection fails after retries
 */
export async function ensureGroup(page, groupName) {
  await withRetry(
    async () => {
      const exists = await groupExists(page, groupName);

      if (exists) {
        await selectGroup(page, groupName);
      } else {
        await createGroup(page, groupName);
      }
    },
    {
      stepName: 'ensure-group',
      maxRetries: 2,
      delayMs: 1500,
    }
  );
}

/**
 * Get the current active group name.
 * @param {import('playwright').Page} page
 * @returns {Promise<string|null>}
 */
export async function getCurrentGroup(page) {
  try {
    // Look for the active/highlighted group
    const activeGroup = await page.$('[data-testid="group-item"][aria-selected="true"], .group-item.active');
    if (activeGroup) {
      const nameElement = await activeGroup.$('[data-testid="group-name"]');
      if (nameElement) {
        return await nameElement.textContent();
      }
    }
    return null;
  } catch (error) {
    logEvent('ERROR', 'EVT-GRP-02', { error: error.message });
    return null;
  }
}

/**
 * Delete a group by name.
 * @param {import('playwright').Page} page
 * @param {string} groupName
 * @returns {Promise<void>}
 */
export async function deleteGroup(page, groupName) {
  logEvent('INFO', 'EVT-GRP-03', { name: groupName, status: 'deleting' });

  try {
    // Find the group
    const groupSelector = `[data-testid="group-item"]:has-text("${groupName}")`;
    const groupElement = await page.$(groupSelector);
    if (!groupElement) {
      logEvent('ERROR', 'EVT-GRP-03', { name: groupName, error: 'not_found' });
      return;
    }

    // Click delete/menu button
    const menuButton = await groupElement.$('[data-testid="group-menu-button"], .group-actions button');
    if (menuButton) {
      await menuButton.click();
      await page.waitForTimeout(300);

      // Click delete option
      const deleteOption = await page.$('[data-testid="delete-group-option"], button:has-text("Delete")');
      if (deleteOption) {
        await deleteOption.click();
        await page.waitForTimeout(500);

        // Confirm deletion
        const confirmButton = await page.$('[data-testid="confirm-delete"], button:has-text("Delete")');
        if (confirmButton) {
          await confirmButton.click();
          await page.waitForTimeout(500);
        }
      }
    }

    logEvent('INFO', 'EVT-GRP-03', { name: groupName, status: 'deleted' });
  } catch (error) {
    logEvent('ERROR', 'EVT-GRP-03', { name: groupName, error: error.message });
    throw error;
  }
}
