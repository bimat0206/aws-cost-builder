/**
 * YAML syntax highlighter for the live preview panel.
 *
 * Takes a single raw YAML line (as produced by serializeToYaml) and returns
 * an ANSI-coloured version following the design-system colour contract:
 *
 *   Line ending with ":"          → key only   → COL_BLUE  (block key / header)
 *   Value starts with '"' or "'"  → string     → key COL_BLUE  + value COL_GREEN
 *   Value is a bare number        → numeric    → key COL_BLUE  + value COL_YELLOW
 *   Value is "true" or "false"    → boolean    → key COL_BLUE  + value COL_MAGENTA
 *   Value is "?"                  → unanswered → key COL_BLUE  + value COL_DIM
 *   Otherwise (list item "-", …)  → structural → COL_DIM   (muted)
 *
 * Active line: receives a leading "▶ " glyph in COL_CYAN, bold cyan key text,
 * and a COL_BG_ACTIVE background painted across the whole visible line.
 *
 * The module is pure (no I/O, no state) and never throws — invalid or empty
 * input is returned unchanged (plain text fallback).
 *
 * @module builder/preview/highlighter
 */

import {
  COL_BLUE,
  COL_GREEN,
  COL_YELLOW,
  COL_MAGENTA,
  COL_DIM,
  COL_CYAN,
  COL_BASE,
  COL_BG_ACTIVE,
} from '../layout/colors.js';
import { fg, bg, bold } from '../layout/components.js';

const MAX_PREVIEW_KEY_LENGTH = 50;

// ─── Internal: ANSI colour helpers already live in components.js ──────────────
// We reuse fg(), bg(), and bold() from there rather than re-implementing ANSI
// escape assembly.  Those helpers handle NO_COLOR / FORCE_COLOR automatically.

// ─── YAML line classifier ─────────────────────────────────────────────────────

/**
 * @typedef {'key-only' | 'string' | 'number' | 'boolean' | 'unanswered' | 'structural'} LineKind
 */

/**
 * Split a raw YAML line into its key portion and value portion.
 *
 * Returns `{ key, value }` where `key` includes any leading indentation and
 * the colon, and `value` is the trimmed text after the first colon-space.
 * When there is no value portion, `value` is an empty string.
 *
 * @param {string} line  Raw YAML line (no newline).
 * @returns {{ key: string, value: string }}
 */
export function splitKeyValue(line) {
  // Match: optional indent + non-colon chars + ": " + rest
  const match = line.match(/^([ \t]*(?:[^:\n]+)?:\s?)(.*)$/);
  if (!match) return { key: line, value: '' };
  return { key: match[1], value: match[2].trim() };
}

/**
 * Classify the semantic kind of a raw YAML line so the highlighter knows
 * which colour rule to apply.
 *
 * Classification rules (evaluated in order):
 *  1. Empty or whitespace-only          → 'structural'
 *  2. Starts with "#"                   → 'structural'  (comment)
 *  3. Is a list item ("  - …")          → 'structural'
 *  4. Has no ": " and ends with ":"     → 'key-only'    (mapping header)
 *  5. Value is exactly "?"              → 'unanswered'
 *  6. Value is "true" or "false"        → 'boolean'
 *  7. Value is parseable as a number    → 'number'
 *  8. Value starts with '"' or "'"      → 'string'
 *  9. Otherwise                         → 'structural'
 *
 * @param {string} line
 * @returns {LineKind}
 */
export function classifyLine(line) {
  if (!line || !line.trim()) return 'structural';
  const trimmed = line.trim();

  // Comment
  if (trimmed.startsWith('#')) return 'structural';

  // List item
  if (trimmed.startsWith('- ') || trimmed === '-') return 'structural';

  // Key-only (block header): ends with ":" with no value following
  const colonIdx = line.indexOf(':');
  if (colonIdx === -1) return 'structural';

  const afterColon = line.slice(colonIdx + 1).trim();

  if (afterColon === '') return 'key-only';

  // Now classify by value
  if (afterColon === '?') return 'unanswered';
  if (afterColon === 'true' || afterColon === 'false') return 'boolean';
  if (!isNaN(Number(afterColon)) && afterColon !== '') return 'number';
  if (afterColon.startsWith('"') || afterColon.startsWith("'")) return 'string';

  // bare unquoted string or other structural element
  return 'structural';
}

// ─── Core highlight function ──────────────────────────────────────────────────

/**
 * Apply syntax highlighting to a single raw YAML line.
 *
 * @param {string}  line      - Raw YAML line text (no newline character).
 * @param {boolean} [isActive=false] - Whether this line is the currently-active
 *                                     dimension prompt line.
 * @returns {string}  ANSI-coloured string ready for terminal output.
 */
export function highlightLine(line, isActive = false) {
  if (typeof line !== 'string') return String(line ?? '');

  const kind = classifyLine(line);
  let rendered = applyColour(line, kind, isActive);

  if (isActive) {
    rendered = paintActiveLine(rendered, line, kind);
  }

  return rendered;
}

// ─── Colour application ───────────────────────────────────────────────────────

/**
 * Apply colour codes to a line based on its classified kind.
 *
 * @param {string}   line
 * @param {LineKind} kind
 * @param {boolean}  isActive
 * @returns {string}
 */
function applyColour(line, kind, isActive) {
  switch (kind) {
    case 'key-only':
      // Entire line is just the key → COL_BLUE
      return isActive
        ? bold(fg(truncateKeySegment(line), COL_CYAN))
        : fg(truncateKeySegment(line), COL_BLUE);

    case 'string':
    case 'number':
    case 'boolean':
    case 'unanswered': {
      const { key, value } = splitKeyValue(line);
      const truncatedKey = truncateKeySegment(key);
      const keyColour   = isActive ? COL_CYAN : COL_BLUE;
      const valueColour = valueColourFor(kind);
      const keyPart     = isActive ? bold(fg(truncatedKey, keyColour)) : fg(truncatedKey, keyColour);
      const valPart     = fg(value, valueColour);
      return `${keyPart}${valPart}`;
    }

    case 'structural':
    default:
      return fg(line, COL_DIM);
  }
}

/**
 * Truncate YAML keys in preview rendering only.
 * Keys longer than 50 chars are cut to 47 chars + ellipsis.
 *
 * @param {string} keySegment
 * @returns {string}
 */
function truncateKeySegment(keySegment) {
  const match = keySegment.match(/^(\s*)([^:]+)(:\s*)$/);
  if (!match) return keySegment;

  const [, indent, rawKey, suffix] = match;
  if (rawKey.length <= MAX_PREVIEW_KEY_LENGTH) return keySegment;
  const truncated = `${rawKey.slice(0, MAX_PREVIEW_KEY_LENGTH - 3)}…`;
  return `${indent}${truncated}${suffix}`;
}

/**
 * Return the colour constant for a line's value segment.
 *
 * @param {LineKind} kind
 * @returns {string}
 */
function valueColourFor(kind) {
  switch (kind) {
    case 'string':     return COL_GREEN;
    case 'number':     return COL_YELLOW;
    case 'boolean':    return COL_MAGENTA;
    case 'unanswered': return COL_DIM;
    default:           return COL_BASE;
  }
}

// ─── Active line decoration ───────────────────────────────────────────────────

/**
 * Decorate an already-coloured line for the active state:
 *   - Prepend "▶ " glyph in COL_CYAN
 *   - Wrap the entire line in COL_BG_ACTIVE background
 *
 * @param {string}   coloured  - ANSI-coloured rendition of the line.
 * @param {string}   raw       - Original uncoloured line (used for fallback).
 * @param {LineKind} kind
 * @returns {string}
 */
function paintActiveLine(coloured, raw, kind) {
  const glyph = fg('▶ ', COL_CYAN);
  return bg(`${glyph}${coloured}`, COL_BG_ACTIVE);
}
