/**
 * SELECT and RADIO list prompt.
 *
 * Renders a keyboard-navigable vertical list of options using the design
 * system glyphs and colours:
 *
 *   ● selected item   COL_GREEN + COL_BG_ACTIVE background + left border char
 *   ○ unselected item COL_DIM
 *
 * The prompt is implemented as a static text renderer that accepts a numeric
 * cursor position and redraws when the user presses arrow keys or number keys.
 * It operates entirely through stdin raw-mode key events without any external
 * TUI library.
 *
 * Keyboard controls:
 *   ↑ / k   — move cursor up
 *   ↓ / j   — move cursor down
 *   Enter   — confirm selection
 *   1–9     — jump to item N (1-indexed)
 *
 * All render helpers are exported for unit testing.
 *
 * @module builder/prompts/select_prompt
 */

import {
  COL_GREEN, COL_DIM, COL_BG_ACTIVE, COL_MUTED, COL_CYAN, COL_ORANGE, COL_BASE,
} from '../layout/colors.js';
import { fg, bg, bold, dim, padEnd } from '../layout/components.js';

// ─── Render helpers ───────────────────────────────────────────────────────────

/**
 * Render one option row of a select list.
 *
 * Selected row:   ● <label>  (COL_GREEN, COL_BG_ACTIVE background, leading │)
 * Unselected row: ○ <label>  (COL_DIM)
 *
 * @param {string}  label      - Option text.
 * @param {boolean} selected   - Whether this is the current cursor row.
 * @param {number}  idx        - 0-based index (shown as dim prefix number).
 * @returns {string}
 */
export function renderOptionRow(label, selected, idx) {
  const num = dim(String(idx + 1).padStart(2) + '. ');
  const rail = selected ? fg('▌ ', COL_GREEN) : fg('│ ', COL_DIM);
  if (selected) {
    const glyph = fg('\u25CF ', COL_GREEN);           // ● filled circle
    const text  = bold(fg(label, COL_BASE));
    const row   = `${rail}${num}${glyph}${text}`;
    return bg(padEnd(row, 60), COL_BG_ACTIVE);
  }
  const glyph = fg('\u25CB ', COL_DIM);               // ○ empty circle
  const text  = fg(label, COL_MUTED);
  return `${rail}${num}${glyph}${text}`;
}

/**
 * Render the complete select-list block for a given cursor position.
 *
 * @param {string[]} options    - All option labels.
 * @param {number}   cursor     - 0-based index of the currently selected item.
 * @returns {string}  Multi-line string; one line per option + nav hint.
 */
export function renderSelectList(options, cursor, descriptions = {}) {
  const rows = [];
  for (let idx = 0; idx < options.length; idx++) {
    const opt = options[idx];
    const isSelected = idx === cursor;
    rows.push(renderOptionRow(opt, isSelected, idx));
    const description = descriptions[opt];
    if (description) {
      const descText = dim(`      ${description}`);
      rows.push(isSelected ? bg(padEnd(descText, 60), COL_BG_ACTIVE) : descText);
    }
  }
  const hint = dim('\n \u2191\u2193 to move \u00B7 Enter to select \u00B7 1-9 to jump');
  return rows.join('\n') + hint;
}

// ─── ANSI cursor control ──────────────────────────────────────────────────────

/** Move cursor up N lines and clear to end of screen. */
function clearLines(n) {
  if (n <= 0) return;
  process.stdout.write(`\x1b[${n}A\x1b[J`);
}

// ─── Core prompt ──────────────────────────────────────────────────────────────

/**
 * Prompt the user to choose one option from a list.
 *
 * Renders the list in-place and redraws on each keypress.  Returns the
 * selected label string.
 *
 * @param {object}       opts
 * @param {string}       opts.label        - Field label shown as a header.
 * @param {string[]}     opts.options      - Non-empty array of option strings.
 * @param {string|null}  [opts.defaultValue] - Pre-select this option if present.
 * @returns {Promise<string>}
 */
export async function selectPrompt(opts) {
  const {
    label,
    options,
    defaultValue = null,
    descriptions = {},
  } = opts;

  if (!options || options.length === 0) {
    throw new Error(`selectPrompt: options array is empty for field "${label}"`);
  }

  // Determine initial cursor position from defaultValue
  let cursor = 0;
  if (defaultValue != null) {
    const idx = options.indexOf(String(defaultValue));
    if (idx !== -1) cursor = idx;
  }

  // Print label header
  process.stdout.write('\n' + bold(fg(label, COL_ORANGE)) + '\n');

  // Draw initial list
  const listText = () => renderSelectList(options, cursor, descriptions);
  const initial = listText() + '\n';
  process.stdout.write(initial);
  let renderedLines = initial.split('\n').length - 1;

  // Switch stdin to raw mode for key detection
  const { stdin } = process;
  const wasRaw = stdin.isRaw;
  if (stdin.isTTY) stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding('utf8');

  return new Promise((resolve) => {
    const onData = (key) => {
      // Ctrl+C / Ctrl+D → propagate interrupt
      if (key === '\x03' || key === '\x04') {
        cleanup();
        process.exit(130);
      }

      // Enter → confirm
      if (key === '\r' || key === '\n') {
        cleanup();
        // Erase the list, print confirmation
        clearLines(renderedLines);
        const chosen = options[cursor];
        process.stdout.write(
          dim('Selected: ') + fg(chosen, COL_GREEN) + '\n',
        );
        resolve(chosen);
        return;
      }

      // Arrow up / k
      if (key === '\x1b[A' || key === 'k') {
        cursor = (cursor - 1 + options.length) % options.length;
      }
      // Arrow down / j
      else if (key === '\x1b[B' || key === 'j') {
        cursor = (cursor + 1) % options.length;
      }
      // Number key 1–9
      else if (key >= '1' && key <= '9') {
        const n = parseInt(key, 10) - 1;
        if (n < options.length) cursor = n;
      }
      else {
        return; // ignore other keys
      }

      // Redraw
      clearLines(renderedLines);
      const newText = listText() + '\n';
      renderedLines = newText.split('\n').length - 1;
      process.stdout.write(newText);
    };

    const cleanup = () => {
      stdin.removeListener('data', onData);
      stdin.pause();
      if (stdin.isTTY) stdin.setRawMode(wasRaw ?? false);
    };

    stdin.on('data', onData);
  });
}
