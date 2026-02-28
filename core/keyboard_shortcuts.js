/**
 * Keyboard shortcuts configuration for cross-platform automation.
 *
 * Matches Python's keyboard_shortcuts.py logic.
 * Provides OS-appropriate keyboard shortcuts for common actions.
 *
 * @module core/keyboard_shortcuts
 */

/**
 * @typedef {Object} ShortcutDefinition
 * @property {string} darwin - macOS shortcut
 * @property {string} default - Windows/Linux shortcut
 * @property {string} [description]
 */

/**
 * Keyboard shortcuts for common actions.
 * @type {Record<string, ShortcutDefinition>}
 */
export const KEYBOARD_SHORTCUTS = {
  // Find-in-Page
  find_in_page: {
    darwin: 'Meta+f',
    default: 'Control+f',
    description: 'Open browser find dialog',
  },
  
  // Save
  save: {
    darwin: 'Meta+s',
    default: 'Control+s',
    description: 'Save current page',
  },
  
  // Undo
  undo: {
    darwin: 'Meta+z',
    default: 'Control+z',
    description: 'Undo last action',
  },
  
  // Redo
  redo: {
    darwin: 'Meta+Shift+z',
    default: 'Control+y',
    description: 'Redo last undone action',
  },
  
  // Copy
  copy: {
    darwin: 'Meta+c',
    default: 'Control+c',
    description: 'Copy to clipboard',
  },
  
  // Paste
  paste: {
    darwin: 'Meta+v',
    default: 'Control+v',
    description: 'Paste from clipboard',
  },
  
  // Select all
  select_all: {
    darwin: 'Meta+a',
    default: 'Control+a',
    description: 'Select all content',
  },
  
  // Refresh
  refresh: {
    darwin: 'Meta+r',
    default: 'Control+r',
    description: 'Refresh page',
  },
  
  // Hard refresh
  hard_refresh: {
    darwin: 'Meta+Shift+r',
    default: 'Control+Shift+r',
    description: 'Hard refresh (clear cache)',
  },
  
  // Close tab
  close_tab: {
    darwin: 'Meta+w',
    default: 'Control+w',
    description: 'Close current tab',
  },
  
  // New tab
  new_tab: {
    darwin: 'Meta+t',
    default: 'Control+t',
    description: 'Open new tab',
  },
  
  // Next tab
  next_tab: {
    darwin: 'Meta+Alt+ArrowRight',
    default: 'Control+Tab',
    description: 'Switch to next tab',
  },
  
  // Previous tab
  previous_tab: {
    darwin: 'Meta+Alt+ArrowLeft',
    default: 'Control+Shift+Tab',
    description: 'Switch to previous tab',
  },
};

/**
 * Get the OS-appropriate shortcut for an action.
 * @param {string} action - Action name (e.g., 'find_in_page')
 * @returns {string} Keyboard shortcut string
 */
export function getShortcut(action) {
  const shortcut = KEYBOARD_SHORTCUTS[action];
  if (!shortcut) {
    throw new Error(`Unknown keyboard shortcut action: ${action}`);
  }
  
  // Detect platform
  const platform = typeof process !== 'undefined' ? process.platform : 'linux';
  
  if (platform === 'darwin') {
    return shortcut.darwin;
  }
  return shortcut.default;
}

/**
 * Parse a shortcut string into modifiers and key.
 * @param {string} shortcut - Shortcut string (e.g., 'Meta+f')
 * @returns {{ modifiers: string[], key: string }}
 */
export function parseShortcut(shortcut) {
  const parts = shortcut.split('+');
  const key = parts.pop();
  const modifiers = parts;
  
  return { modifiers, key };
}

/**
 * Press a keyboard shortcut on a Playwright page.
 * @param {import('playwright').Page} page
 * @param {string} action - Action name
 * @returns {Promise<void>}
 */
export async function pressShortcut(page, action) {
  const shortcut = getShortcut(action);
  const { modifiers, key } = parseShortcut(shortcut);
  
  // Press modifiers
  for (const modifier of modifiers) {
    await page.keyboard.down(modifier);
  }
  
  // Press key
  await page.keyboard.press(key);
  
  // Release modifiers
  for (const modifier of [...modifiers].reverse()) {
    await page.keyboard.up(modifier);
  }
}
