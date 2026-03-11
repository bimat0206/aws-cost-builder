/**
 * Shared ANSI/TUI primitives used by the active CLI layout runtime.
 *
 * All colour values are imported from colors.js; none are hardcoded here.
 * Exported functions return plain strings containing ANSI escape sequences for
 * colour and style. They are safe to pass to console.log / process.stdout.write
 * or concatenate into larger output strings.
 *
 * When stdout is not a TTY (e.g. CI pipe, test runner), colour sequences are
 * suppressed automatically so output remains machine-readable.
 *
 * @module builder/layout/components
 */

import {
  COL_DIM,
} from './colors.js';

// ─── ANSI 24-bit (truecolor) helpers ─────────────────────────────────────────

/**
 * Parse a "#rrggbb" hex string into [r, g, b] integers.
 * Returns [255, 255, 255] for any invalid input so rendering never crashes.
 *
 * @param {string} hex
 * @returns {[number, number, number]}
 */
function hexToRgb(hex) {
  if (typeof hex !== 'string') return [255, 255, 255];
  const clean = hex.replace(/^#/, '');
  if (clean.length !== 6) return [255, 255, 255];
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  if (isNaN(r) || isNaN(g) || isNaN(b)) return [255, 255, 255];
  return [r, g, b];
}

/** Returns true when the current stdout supports colour output. */
function isColorEnabled() {
  // Respect NO_COLOR convention (https://no-color.org/)
  if (process.env.NO_COLOR) return false;
  if (process.env.FORCE_COLOR) return true;
  return Boolean(process.stdout.isTTY);
}

/**
 * Wrap `text` in ANSI 24-bit foreground colour sequence.
 * Falls back to plain text in non-colour environments.
 *
 * @param {string} text
 * @param {string} hexColor  - e.g. "#56b6c2"
 * @returns {string}
 */
export function fg(text, hexColor) {
  if (!isColorEnabled()) return text;
  const [r, g, b] = hexToRgb(hexColor);
  return `\x1b[38;2;${r};${g};${b}m${text}\x1b[39m`;
}

/**
 * Wrap `text` in ANSI 24-bit background colour sequence.
 * Falls back to plain text in non-colour environments.
 *
 * @param {string} text
 * @param {string} hexColor  - e.g. "#2c313c"
 * @returns {string}
 */
export function bg(text, hexColor) {
  if (!isColorEnabled()) return text;
  const [r, g, b] = hexToRgb(hexColor);
  return `\x1b[48;2;${r};${g};${b}m${text}\x1b[49m`;
}

/**
 * Wrap `text` in ANSI bold.
 * Falls back to plain text in non-colour environments.
 *
 * @param {string} text
 * @returns {string}
 */
export function bold(text) {
  if (!isColorEnabled()) return text;
  return `\x1b[1m${text}\x1b[22m`;
}

/**
 * Wrap `text` in ANSI dim/faint style.
 *
 * @param {string} text
 * @returns {string}
 */
export function dim(text) {
  if (!isColorEnabled()) return text;
  return `\x1b[2m${text}\x1b[22m`;
}

/** Reset all ANSI attributes. */
export const RESET = '\x1b[0m';

// ─── Visible-length helper ────────────────────────────────────────────────────

/**
 * Return the visible (printable) character count of a string by stripping
 * all ANSI escape sequences.  Used when right-padding strings to a fixed width.
 *
 * @param {string} str
 * @returns {number}
 */
export function visibleLength(str) {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1b\[[0-9;]*m/g, '').length;
}

/**
 * Right-pad a string (which may contain ANSI sequences) to `width` visible
 * characters using the pad character (default space).
 *
 * @param {string} str
 * @param {number} width
 * @param {string} [padChar=' ']
 * @returns {string}
 */
export function padEnd(str, width, padChar = ' ') {
  const vLen = visibleLength(str);
  const needed = Math.max(0, width - vLen);
  return str + padChar.repeat(needed);
}
