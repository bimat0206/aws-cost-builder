/**
 * YAML preview panel — serialize and highlight the in-progress profile.
 *
 * ## Serialization (`serializeToYaml`)
 *
 * Converts a plain `profileState` object into a human-readable YAML string
 * without any external library dependency.  The serializer follows these rules:
 *
 *   - Top-level keys are written in insertion order.
 *   - Strings are double-quoted.
 *   - Numbers and booleans are written bare.
 *   - `null` / `undefined` values are written as `?` (unanswered sentinel).
 *   - Arrays use block-sequence style with two-space indentation per level.
 *   - Objects use block-mapping style with two-space indentation per level.
 *   - Nested objects / arrays are indented by 2 spaces per depth level.
 *
 * ## Highlighting (`highlightYaml`)
 *
 * Splits the serialized YAML into individual lines and calls
 * `highlightLine(line, isActive)` from `highlighter.js` for each.
 * A line is considered "active" when it contains `activeKey + ":"`.
 *
 * ## Scroll (`computeScrollOffset`)
 *
 * Returns the line index that should be the first visible line in the
 * viewport so that the active line lands in the middle third of the panel.
 * Clamped to `[0, max_offset]` so it never scrolls past the end.
 *
 * @module builder/preview/yaml_preview
 */

import { highlightLine } from './highlighter.js';

// ─── serializeToYaml ─────────────────────────────────────────────────────────

/**
 * Serialize a plain-object profile state to a YAML string.
 *
 * The output intentionally mirrors what a minimal `js-yaml` dump would
 * produce, without requiring the dependency at runtime (the preview is
 * cosmetic and not used for saving).
 *
 * Rules:
 *   - null / undefined → bare `?`
 *   - boolean          → `true` / `false`
 *   - number           → bare numeric string
 *   - string           → double-quoted (special chars escaped)
 *   - array            → block sequence, each item prefixed with `- `
 *   - object           → block mapping, keys unquoted, values indented
 *
 * @param {object|null|undefined} profileState
 * @returns {string}  Multi-line YAML string (no trailing newline).
 */
export function serializeToYaml(profileState) {
  if (profileState === null || profileState === undefined) {
    return '?';
  }
  return serializeValue(profileState, 0).trimEnd();
}

// ─── Internal serialization helpers ──────────────────────────────────────────

/**
 * Recursively serialise any JS value at a given indent depth.
 *
 * @param {*}      value
 * @param {number} depth   Nesting depth (root = 0).
 * @returns {string}
 */
function serializeValue(value, depth) {
  if (value === null || value === undefined) return '?';
  if (typeof value === 'boolean') return String(value);
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string') return quoteString(value);
  if (Array.isArray(value)) return serializeArray(value, depth);
  if (typeof value === 'object') return serializeObject(value, depth);
  return quoteString(String(value));
}

/**
 * Wrap a string in double quotes, escaping internal double-quotes and
 * backslashes.  This keeps the serialized YAML unambiguous.
 *
 * @param {string} str
 * @returns {string}
 */
function quoteString(str) {
  const escaped = str.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return `"${escaped}"`;
}

/**
 * Serialize an array as a YAML block sequence.
 *
 * Each element is emitted on its own line preceded by `- `.
 * Nested objects/arrays are serialised inline after the `- ` where possible,
 * or on the next line indented when multi-line.
 *
 * @param {Array}  arr
 * @param {number} depth
 * @returns {string}
 */
function serializeArray(arr, depth) {
  if (arr.length === 0) return '[]';
  const indent = '  '.repeat(depth);
  const lines = arr.map(item => {
    const itemStr = serializeValue(item, depth + 1);
    if (itemStr.includes('\n')) {
      // Multi-line value — put the `- ` on its own line, indent the body
      const indented = itemStr
        .split('\n')
        .map(l => '  ' + l)
        .join('\n');
      return `${indent}- \n${indented}`;
    }
    return `${indent}- ${itemStr}`;
  });
  return lines.join('\n');
}

/**
 * Serialize a plain object as a YAML block mapping.
 *
 * @param {object} obj
 * @param {number} depth
 * @returns {string}
 */
function serializeObject(obj, depth) {
  const indent = '  '.repeat(depth);
  const keys = Object.keys(obj);
  if (keys.length === 0) return '{}';

  const lines = keys.map(key => {
    const rawValue = obj[key];
    const valueStr = serializeValue(rawValue, depth + 1);

    // Scalar on same line: `key: value`
    if (!valueStr.includes('\n')) {
      return `${indent}${key}: ${valueStr}`;
    }

    // Multi-line (object or array): `key:\n  …`
    return `${indent}${key}:\n${valueStr}`;
  });

  return lines.join('\n');
}

// ─── highlightYaml ────────────────────────────────────────────────────────────

/**
 * Split `yamlText` into lines and apply syntax highlighting to each.
 *
 * A line is marked as active when:
 *   - `activeKey` is non-null / non-empty AND
 *   - The line's key portion (text before the first `:`) matches `activeKey`
 *     exactly (trimmed, case-sensitive).
 *
 * Only the first matching line is marked active; subsequent occurrences are
 * highlighted normally.
 *
 * @param {string}      yamlText   - Raw multi-line YAML string.
 * @param {string|null} activeKey  - Dimension key that is currently being
 *                                   prompted (e.g. `"InstanceType"`).
 * @returns {string[]}  Array of ANSI-coloured line strings.
 */
export function highlightYaml(yamlText, activeKey) {
  if (typeof yamlText !== 'string') return [];

  const rawLines = yamlText.split('\n');
  let activeFound = false;

  return rawLines.map(line => {
    const isActive = !activeFound && isActiveLine(line, activeKey);
    if (isActive) activeFound = true;
    return highlightLine(line, isActive);
  });
}

/**
 * Decide whether a raw YAML line corresponds to the currently active key.
 *
 * A line matches when its bare key (leading indent and trailing colon stripped)
 * equals `activeKey` exactly.
 *
 * @param {string}      line
 * @param {string|null} activeKey
 * @returns {boolean}
 */
function isActiveLine(line, activeKey) {
  if (!activeKey) return false;
  const colonIdx = line.indexOf(':');
  if (colonIdx === -1) return false;
  const lineKey = line.slice(0, colonIdx).trim();
  return lineKey === activeKey;
}

// ─── computeScrollOffset ─────────────────────────────────────────────────────

/**
 * Compute the scroll offset (first visible line index) so that the active
 * line appears in the middle third of the viewport.
 *
 * "Middle third" means the active line lands between lines
 * `⌊viewportHeight / 3⌋` and `⌊2 * viewportHeight / 3⌋` of the visible
 * window.  We target the exact middle (`⌊viewportHeight / 2⌋`).
 *
 * The result is clamped to `[0, max(0, lines.length − viewportHeight)]` so
 * the viewport never scrolls past the content.
 *
 * @param {string[]} lines          - Array of (possibly ANSI-coloured) lines.
 * @param {number}   activeLineIdx  - 0-based index of the active line.
 * @param {number}   viewportHeight - Number of lines the panel can display.
 * @returns {number}  0-based index of the first visible line.
 */
export function computeScrollOffset(lines, activeLineIdx, viewportHeight) {
  const totalLines = Array.isArray(lines) ? lines.length : 0;
  const safeViewport = Math.max(1, Math.floor(viewportHeight));
  const safeIdx = Math.max(0, Math.min(Math.floor(activeLineIdx), totalLines - 1));
  const maxOffset = Math.max(0, totalLines - safeViewport);

  // Target: active line lands at the viewport midpoint
  const targetOffset = safeIdx - Math.floor(safeViewport / 2);

  return Math.max(0, Math.min(targetOffset, maxOffset));
}
