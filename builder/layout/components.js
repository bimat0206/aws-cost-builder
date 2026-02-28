/**
 * Shared TUI components — DiamondHeader, Breadcrumb, ProgBar, Badge.
 *
 * All colour values are imported from colors.js; none are hardcoded here.
 * All functions return plain strings containing ANSI escape sequences for
 * colour and style.  They are safe to pass to console.log / process.stdout.write
 * or concatenate into larger output strings.
 *
 * When stdout is not a TTY (e.g. CI pipe, test runner), colour sequences are
 * suppressed automatically so output remains machine-readable.
 *
 * @module builder/layout/components
 */

import {
  COL_YELLOW,
  COL_ORANGE,
  COL_CYAN,
  COL_GREEN,
  COL_MUTED,
  COL_DIM,
  COL_BASE,
  COL_BORDER,
  COL_SECTION,
  FIELD_TYPE_COLORS,
  COL_BG_ROW,
} from './colors.js';

// ─── ANSI 24-bit (truecolor) helpers ─────────────────────────────────────────

/**
 * Parse a "#rrggbb" hex string into [r, g, b] integers.
 * Returns [255, 255, 255] for any invalid input so rendering never crashes.
 *
 * @param {string} hex
 * @returns {[number, number, number]}
 */
export function hexToRgb(hex) {
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

/**
 * Wrap `text` in ANSI italic.
 *
 * @param {string} text
 * @returns {string}
 */
export function italic(text) {
  if (!isColorEnabled()) return text;
  return `\x1b[3m${text}\x1b[23m`;
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

// ─── Component: DiamondHeader ─────────────────────────────────────────────────

/**
 * Render a section-transition header with a ◆ glyph in COL_YELLOW and
 * a yellow/orange bordered title line.
 *
 * Visual example (TTY):
 *   ◆ Compute · Section 1 of 3
 *
 * @param {string} title  - The header text, e.g. "Project Setup · Step 1 of 3".
 * @returns {string}      - Single line string with ANSI codes.
 */
export function DiamondHeader(title) {
  const subtitle = arguments.length > 1 ? arguments[1] : null;
  const heading = TextInlineHeader(title, subtitle);
  const innerWidth = Math.max(24, Math.min(74, visibleLength(heading) + 2));
  const border = (s) => fg(s, COL_SECTION);

  const top = border('╭' + '─'.repeat(innerWidth) + '╮');
  const mid = border('│') + bg(padEnd(` ${heading}`, innerWidth), COL_BG_ROW) + border('│');
  const bot = border('╰' + '─'.repeat(innerWidth) + '╯');

  return [top, mid, bot].join('\n');
}

/**
 * Render the inline text used inside DiamondHeader.
 *
 * @param {string} title
 * @param {string|null} subtitle
 * @returns {string}
 */
function TextInlineHeader(title, subtitle) {
  const diamond = bold(fg('◆', COL_YELLOW));
  const text = bold(fg(` ${title}`, COL_YELLOW));
  if (!subtitle) return `${diamond}${text}`;
  const sub = fg(` · ${subtitle}`, COL_DIM);
  return `${diamond}${text}${sub}`;
}

// ─── Component: Breadcrumb ────────────────────────────────────────────────────

/**
 * Render a breadcrumb path display such as "Group: Frontend › Service: EC2".
 *
 * Each part is rendered in COL_MUTED; separators use the `›` glyph in COL_DIM.
 *
 * @param {string[]} parts  - Ordered path segments, e.g. ["Group: Frontend", "Service: EC2"].
 * @returns {string}        - Single line string with ANSI codes.
 */
export function Breadcrumb(parts) {
  if (Array.isArray(parts) && parts.length === 0) return '';
  if (!Array.isArray(parts)) return '';

  const sep = fg(' › ', COL_DIM);
  return parts
    .map((p) => renderBreadcrumbPart(p))
    .join(sep);
}

/**
 * @param {string} part
 * @returns {string}
 */
function renderBreadcrumbPart(part) {
  if (typeof part !== 'string') return fg(String(part ?? ''), COL_MUTED);
  const idx = part.indexOf(':');
  if (idx === -1) return fg(part, COL_MUTED);

  const label = part.slice(0, idx + 1).trim() + ' ';
  const value = part.slice(idx + 1).trim();
  return `${bold(fg(label, COL_DIM))}${fg(value, COL_MUTED)}`;
}

// ─── Component: ProgBar ───────────────────────────────────────────────────────

/**
 * Render a compact progress bar.
 *
 * Format:
 *   [4/19]  ████████░░░░░░░░░░░░░░░░  (21%)
 *
 * The filled portion uses `█` in COL_CYAN; empty uses `░` in COL_DIM.
 * The counter and percentage are rendered in COL_MUTED.
 *
 * @param {number} current  - Fields completed so far (1-based).
 * @param {number} total    - Total fields in the section.
 * @param {number} [width=24]  - Number of bar characters (default 24).
 * @returns {string}
 */
export function ProgBar(current, total, widthOrOptions = 24) {
  const opts = typeof widthOrOptions === 'object' && widthOrOptions !== null
    ? widthOrOptions
    : { width: widthOrOptions };
  const width = Math.max(12, opts.width ?? 24);

  const safeTotal   = Math.max(1, total);
  const safeCurrent = Math.min(Math.max(0, current), safeTotal);
  const fraction    = safeCurrent / safeTotal;
  const filled      = Math.round(fraction * width);
  const empty       = width - filled;
  const pct         = Math.round(fraction * 100);

  const sectionCurrent = opts.sectionCurrent ?? null;
  const sectionTotal = opts.sectionTotal ?? null;
  const sectionLabel = (sectionCurrent && sectionTotal)
    ? `Section ${sectionCurrent} of ${sectionTotal}`
    : 'Section';

  // Label line: left-aligned section label, right-aligned counter.
  // Total visible width is fixed at 48 chars so it matches the bar line.
  const ROW_WIDTH = 48;
  const labelStr = fg(sectionLabel, COL_DIM);
  const counter  = fg(`[${safeCurrent}/${safeTotal}]`, COL_CYAN);
  const top      = padEnd(labelStr, ROW_WIDTH - visibleLength(counter)) + counter;

  // Bar line: bar glyphs + percentage, padded to same ROW_WIDTH.
  const bar      = fg('█'.repeat(filled), COL_CYAN) + fg('░'.repeat(empty), COL_BORDER);
  const pctStr   = fg(` (${pct}%)`, COL_DIM);
  const barLine  = padEnd(bar + pctStr, ROW_WIDTH);

  return `${top}\n${barLine}`;
}

// ─── Component: Badge ─────────────────────────────────────────────────────────

/**
 * Render an inline coloured badge with square brackets.
 *
 * Example output (TTY): [NUMBER] with the text in the given hex colour.
 *
 * @param {string} text   - Badge label, e.g. "NUMBER", "required", "optional".
 * @param {string} color  - Hex colour string, e.g. COL_CYAN.
 * @returns {string}
 */
export function Badge(text, color) {
  return fg(`[${text}]`, color);
}

// ─── Convenience: FieldTypeBadge ──────────────────────────────────────────────

/**
 * Render a field-type badge using the standard FIELD_TYPE_COLORS mapping.
 *
 * @param {'NUMBER'|'TEXT'|'SELECT'|'COMBOBOX'|'TOGGLE'|'RADIO'} fieldType
 * @returns {string}
 */
export function FieldTypeBadge(fieldType) {
  const color = FIELD_TYPE_COLORS[fieldType] ?? COL_DIM;
  return Badge(fieldType, color);
}

// ─── Convenience: RequiredBadge ───────────────────────────────────────────────

/**
 * Render a required / optional badge.
 *
 * @param {boolean} required
 * @returns {string}
 */
export function RequiredBadge(required) {
  return required
    ? Badge('required', COL_ORANGE)
    : Badge('optional', COL_DIM);
}

// ─── Convenience: StatusIcon ─────────────────────────────────────────────────

/**
 * Return a coloured status icon string.
 *
 * | marker  | meaning  | colour     |
 * |---------|----------|------------|
 * | ✓       | success  | COL_GREEN  |
 * | !       | warning  | COL_YELLOW |
 * | ✗       | failure  | COL_ORANGE |
 * | ?       | info     | COL_CYAN   |
 *
 * @param {'success'|'warning'|'failure'|'info'} type
 * @returns {string}
 */
export function StatusIcon(type) {
  switch (type) {
    // Short aliases (used by section_flow, main.js)
    case 'ok':      return fg('✓', COL_GREEN);
    case 'warn':    return fg('!', COL_YELLOW);
    case 'error':   return fg('✗', COL_ORANGE);
    // Canonical names
    case 'success': return fg('✓', COL_GREEN);
    case 'warning': return fg('!', COL_YELLOW);
    case 'failure': return fg('✗', COL_ORANGE);
    case 'info':    return fg('ℹ', COL_CYAN);
    default:        return fg('·', COL_DIM);
  }
}

// ─── Convenience: EventMessage ────────────────────────────────────────────────

/**
 * Format an event log message for display above the live TUI panel via
 * LayoutEngine.printAbove().
 *
 * Examples:
 *   [✓] Section 'Compute' completed — 8 fields set
 *   [!] Override applied to InstanceType
 *   [✗] Failed to fill StorageClass — retrying
 *   [?] Help: Number of instances
 *
 * @param {'success'|'warning'|'failure'|'info'} type
 * @param {string} message
 * @returns {string}
 */
export function EventMessage(type, message) {
  const icon = StatusIcon(type);
  return `[${icon}] ${fg(message, COL_BASE)}`;
}
