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
  // Look for group element with matching name using text search
  try {
    const groupItem = page.getByText(groupName, { exact: true }).first();
    await groupItem.waitFor({ state: 'visible', timeout: 1500 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Select root estimate to ensure we're at top-level.
 * @param {import('playwright').Page} page
 * @returns {Promise<boolean>}
 */
async function selectRootEstimate(page) {
  const selectors = [
    page.getByText('My Estimate', { exact: false }).first(),
    page.getByRole('treeitem', { name: /^My Estimate$/i }).first(),
  ];

  for (const locator of selectors) {
    try {
      await locator.waitFor({ state: 'visible', timeout: 1200 });
      await locator.click();
      return true;
    } catch {
      continue;
    }
  }
  return false;
}

/**
 * Find the "Create group" button using text search.
 * @param {import('playwright').Page} page
 * @returns {Promise<import('playwright').Locator>}
 */
async function findCreateGroupButton(page) {
  // Use text-based search like Python's find_button
  const button = page.getByRole('button', { name: /Create group/i }).first();
  await button.waitFor({ state: 'visible', timeout: 2000 });
  return button;
}

/**
 * Find the group name input field.
 * @param {import('playwright').Page} page
 * @returns {Promise<import('playwright').Locator>}
 */
async function findGroupNameInput(page) {
  // Try label-based search first
  const labels = ['Group name', 'Group name e.g., "My service group"'];
  for (const label of labels) {
    try {
      const input = page.getByLabel(label, { exact: false }).first();
      await input.waitFor({ state: 'visible', timeout: 1000 });
      return input;
    } catch {
      continue;
    }
  }

  // Fallback to placeholder-based search
  const placeholders = ['e.g., "My service group"', 'Group name'];
  for (const placeholder of placeholders) {
    try {
      const input = page.getByPlaceholder(placeholder).first();
      await input.waitFor({ state: 'visible', timeout: 1000 });
      return input;
    } catch {
      continue;
    }
  }

  throw new Error('Group name input not found in Create group flow');
}

/**
 * Create a new group in the AWS Calculator.
 * Matches Python's ensure_group_exists logic.
 * @param {import('playwright').Page} page
 * @param {string} groupName
 * @returns {Promise<void>}
 */
async function createGroup(page, groupName) {
  logEvent('INFO', 'EVT-GRP-01', { name: groupName, status: 'creating' });

  // Ensure we're at root estimate level
  await selectRootEstimate(page);

  // Find and click "Create group" button
  const createGroupButton = await findCreateGroupButton(page);
  await createGroupButton.click();
  await page.waitForTimeout(500);

  // Enter group name
  const nameInput = await findGroupNameInput(page);
  await nameInput.fill(groupName);
  await page.waitForTimeout(300);

  // Find and click confirm button (various possible labels)
  const confirmButtons = [
    page.getByRole('button', { name: /Create/i }).first(),
    page.getByRole('button', { name: /Add/i }).first(),
    page.getByText('Create', { exact: true }).first(),
  ];

  let confirmed = false;
  for (const button of confirmButtons) {
    try {
      await button.waitFor({ state: 'visible', timeout: 1000 });
      await button.click();
      confirmed = true;
      break;
    } catch {
      continue;
    }
  }

  if (!confirmed) {
    throw new Error('Could not find create group confirm button');
  }

  await page.waitForTimeout(500);

  // Verify group was created
  const exists = await groupExists(page, groupName);
  if (!exists) {
    throw new Error(`Group '${groupName}' was not created successfully`);
  }

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

  // Click on the group to select it using text search
  try {
    const groupElement = page.getByText(groupName, { exact: true }).first();
    await groupElement.waitFor({ state: 'visible', timeout: 1500 });
    await groupElement.click();
    await page.waitForTimeout(300);

    logEvent('INFO', 'EVT-GRP-01', { name: groupName, status: 'selected' });
  } catch (error) {
    throw new Error(`Group not found: ${groupName}`);
  }
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
