/**
 * NUMBER and TEXT field input prompt.
 *
 * Renders a compact single-line input widget that matches the design mock
 * (screen-05 / FakeInput component), using raw-mode key capture to display
 * typed characters live inside the input row — no readline echo, no double
 * cursor artifact.
 *
 * Design reference (full-flow.html FakeInput):
 *   ┌──────────────────────────────────────────────┐  ← COL_CYAN border, active
 *   │ ›  typed text█                               │  ← COL_DIM ›, COL_BASE text
 *   └──────────────────────────────────────────────┘
 *    Enter to confirm · ? for help                    ← dim hint
 *
 * After submission, the widget renders as "inactive" (COL_BORDER border) with
 * the confirmed value, then freezes in the scroll history.
 *
 * Keyboard controls (raw mode):
 *   Printable chars  → appended to buffer; box redraws live
 *   Backspace        → removes the last character; box redraws
 *   Enter            → validates; on success freezes box and resolves
 *   ?                → toggles inline help panel below the input
 *   Ctrl+C / Ctrl+D  → exits process
 *
 * @module builder/prompts/field_prompt
 */

import * as readline from 'node:readline';
import {
  COL_ORANGE, COL_YELLOW, COL_MUTED, COL_DIM, COL_CYAN, COL_BASE,
  COL_BORDER, COL_GREEN, COL_BG_ACTIVE, COL_BG_PANEL, COL_BG_ROW,
} from '../layout/colors.js';
import {
  fg, bold, italic, dim, FieldTypeBadge, RequiredBadge, padEnd, visibleLength, bg,
} from '../layout/components.js';

// ─── Shared readline for non-TTY (piped / script) mode ───────────────────────

/** Singleton readline interface reused across all sequential fieldPrompt calls. */
let _sharedRl = null;

function _getSharedRl() {
  if (!_sharedRl || _sharedRl.closed) {
    _sharedRl = readline.createInterface({
      input:  process.stdin,
      output: null,        // don't write prompt text — we handle output ourselves
      terminal: false,
    });
    // Close when stdin ends (e.g. end of piped script)
    _sharedRl.once('close', () => { _sharedRl = null; });
  }
  return _sharedRl;
}

/**
 * Read one line from the shared non-TTY readline interface, validate it, and
 * resolve with the effective value.  Renders a submitted widget to stdout.
 */
function _readLineNonTTY({ required, fieldType, defaultValue }) {
  return new Promise((resolve) => {
    const rl = _getSharedRl();
    rl.once('line', (raw) => {
      const trimmed = raw.trim();
      const value   = trimmed !== ''
        ? trimmed
        : (defaultValue !== null && defaultValue !== undefined && defaultValue !== '')
          ? String(defaultValue)
          : '';

      // In non-TTY we cannot reprompt — just surface what we have
      const final = (value === '' || (fieldType === 'NUMBER' && isNaN(Number(value))))
        ? ''
        : value;

      process.stdout.write(renderSubmittedInput(final) + '\n');
      resolve(final);
    });
  });
}

// ─── Render helpers ───────────────────────────────────────────────────────────

/**
 * Render the field label line.
 *
 * Format:  <bold orange label>  <FieldTypeBadge>  <RequiredBadge>
 *
 * @param {string}  label
 * @param {string}  fieldType
 * @param {boolean} required
 * @returns {string}
 */
export function renderFieldLabel(label, fieldType, required) {
  const lbl  = bold(fg(label, COL_ORANGE));
  const type = FieldTypeBadge(fieldType);
  const req  = RequiredBadge(required);
  return `${lbl}  ${type}  ${req}`;
}

/**
 * Render the unit / default hint line beneath the label.
 *
 * @param {string|null} unit
 * @param {*}           defaultValue
 * @returns {string}
 */
export function renderFieldMeta(unit, defaultValue) {
  const parts = [];
  if (unit) parts.push(`Unit: ${fg(unit, COL_YELLOW)}`);
  if (defaultValue !== null && defaultValue !== undefined && defaultValue !== '')
    parts.push(`Default: ${fg(String(defaultValue), COL_MUTED)}`);
  if (parts.length === 0) return '';
  return parts.map(p => dim(p)).join('   ');
}

/**
 * Render an optional catalog note in dim italic.
 *
 * @param {string|null} note
 * @returns {string}
 */
export function renderFieldNote(note) {
  if (!note) return '';
  return italic(dim(`Note: ${note}`));
}

/**
 * Render the single-line input widget.
 *
 * Matches the design mock FakeInput component exactly:
 *  - Active:   COL_CYAN border, COL_BG_ACTIVE background
 *  - Inactive: COL_BORDER border, dimmer background #252a33
 *
 * The full widget is 3 printable lines: top border, mid content, bottom border —
 * but since we're in a terminal with box-drawing chars we use a *single* ruled
 * line instead: a filled row bounded by the design's rounded corners.
 *
 * For terminal rendering we approximate the mock's `padding: "5px 10px"` as
 * a single content row with:
 *   ╭──────────────────────────────────────────────────╮   ← top (COL_CYAN or DIM)
 *   │ ›  <typed text>█  <padding>                      │   ← mid
 *   ╰──────────────────────────────────────────────────╯   ← bottom
 *    Enter to confirm · ? for help                         ← hint (dim)
 *
 * @param {string}  [buffer='']     Currently typed characters.
 * @param {string}  [errorMsg='']   One-line error message (shown below hint when set).
 * @param {boolean} [active=true]   Active state (cyan) vs inactive (dim).
 * @param {number}  [width=50]      Total box width.
 * @returns {string}  3 or 4 lines joined by \n.
 */
export function renderFakeInput(buffer = '', errorMsg = '', active = true, width = 50) {
  const borderColor = active ? COL_CYAN : COL_BORDER;
  const b = (s) => fg(s, borderColor);
  const inner = width - 2;         // visible chars between │ and │
  const maxText = inner - 5;       // room for ' › ' (3) + cursor (1) + left pad (1)

  // Show tail of buffer if it overflows
  const displayBuf = buffer.length > maxText
    ? '…' + buffer.slice(-(maxText - 1))
    : buffer;

  const prefix  = fg('› ', COL_DIM);
  const text    = fg(displayBuf, COL_BASE);
  const cursor  = active ? fg('█', COL_CYAN) : '';
  const content = ` ${prefix}${text}${cursor}`;
  const padded  = padEnd(content, inner);

  const bgColor = active ? COL_BG_ACTIVE : COL_BG_PANEL;

  const top  = bg(b('╭') + b('─'.repeat(inner)) + b('╮'), bgColor);
  const mid  = bg(b('│') + padded + b('│'), bgColor);
  const bot  = bg(b('╰') + b('─'.repeat(inner)) + b('╯'), bgColor);
  const hint = dim(' Enter to confirm · ? for help');

  const lines = [top, mid, bot, hint];
  if (errorMsg) lines.push(fg(`  ✗ ${errorMsg}`, COL_ORANGE));
  return lines.join('\n');
}

/**
 * Render an inactive "submitted" version of the input widget.
 * Shows the confirmed value inside the box with a dim border and a ✓ prefix.
 *
 * @param {string} value   Confirmed value to display.
 * @param {number} [width=50]
 * @returns {string}
 */
export function renderSubmittedInput(value, width = 50) {
  const b = (s) => fg(s, COL_BORDER);
  const inner   = width - 2;
  const display = `  ${fg('✓', COL_GREEN)}  ${fg(value || dim('(skipped)'), value ? COL_BASE : COL_DIM)}`;
  const padded  = padEnd(display, inner);

  const bgColor = COL_BG_ROW;

  const top     = bg(b('╭') + b('─'.repeat(inner)) + b('╮'), bgColor);
  const mid     = bg(b('│') + padded + b('│'), bgColor);
  const bot     = bg(b('╰') + b('─'.repeat(inner)) + b('╯'), bgColor);
  return [top, mid, bot].join('\n');
}

/**
 * Render the inline help panel for a field (yellow-bordered box).
 *
 * @param {object}      opts
 * @param {string}      opts.label
 * @param {string}      opts.fieldType
 * @param {boolean}     opts.required
 * @param {string|null} [opts.unit]
 * @param {*}           [opts.defaultValue]
 * @param {string|null} [opts.note]
 * @returns {string}
 */
export function renderInlineHelp(opts) {
  const {
    label,
    fieldType,
    required,
    unit         = null,
    defaultValue = null,
    note         = null,
  } = opts;

  const border = (s) => fg(s, COL_YELLOW);
  const width  = 52;
  const inner  = width - 2;

  const titleText = ` ? Help: ${label} `;
  const dashRight = Math.max(0, inner - 2 - titleText.length);
  const top = border('╭') + border('──') + bold(fg(titleText, COL_YELLOW))
            + border('─'.repeat(dashRight)) + border('╮');
  const bot = border('╰') + border('─'.repeat(inner)) + border('╯');

  const row = (k, v) => {
    const kStr    = fg(k.padEnd(10), COL_MUTED);
    const vStr    = fg(String(v ?? '—'), COL_BASE);
    const content = `  ${kStr} ${vStr}`;
    return border('│') + padEnd(content, inner) + border('│');
  };

  const rows = [
    row('Key:', label),
    row('Type:', fieldType),
    row('Required:', required ? 'yes' : 'no'),
  ];
  if (unit != null)
    rows.push(row('Unit:', unit));
  if (defaultValue !== null && defaultValue !== undefined)
    rows.push(row('Default:', String(defaultValue)));
  if (note)
    rows.push(row('Note:', note));

  return [top, ...rows, bot].join('\n');
}

// ─── ANSI cursor helpers ──────────────────────────────────────────────────────

/** Move cursor up N lines and clear to end of screen. */
function clearLines(n) {
  if (n > 0) process.stdout.write(`\x1b[${n}A\x1b[J`);
}

// ─── Core prompt ──────────────────────────────────────────────────────────────

/**
 * Prompt the user for a NUMBER or TEXT field value using raw-mode key capture.
 *
 * Matches the design mock FieldBlock visual: label row → unit/default meta →
 * note → compact single-line input widget. After a valid Enter the widget is
 * replaced by its "submitted" (inactive) variant showing the confirmed value.
 *
 * @param {object}       opts
 * @param {string}       opts.label
 * @param {string}       opts.fieldType     'NUMBER' | 'TEXT'
 * @param {boolean}      opts.required
 * @param {string|null}  [opts.unit]
 * @param {*}            [opts.defaultValue]
 * @param {string|null}  [opts.note]
 * @param {object|null}  [opts.rl]          Unused — kept for API compatibility.
 * @returns {Promise<string>}
 */
export async function fieldPrompt(opts) {
  const {
    label,
    fieldType,
    required,
    unit         = null,
    defaultValue = null,
    note         = null,
  } = opts;

  // ── Print the static header lines (label + meta + note) ───────────────────
  const labelLine = renderFieldLabel(label, fieldType, required);
  const metaLine  = renderFieldMeta(unit, defaultValue);
  const noteLine  = renderFieldNote(note);

  const header = ['', labelLine];
  if (metaLine) header.push(metaLine);
  if (noteLine) header.push(noteLine);
  process.stdout.write(header.join('\n') + '\n');

  // ── Non-TTY (piped / script) path: shared readline, no live redraws ─────────
  if (!process.stdin.isTTY) {
    return _readLineNonTTY({ required, fieldType, defaultValue, label });
  }

  // ── TTY live raw-mode input ────────────────────────────────────────────────
  let buffer   = '';
  let errorMsg = '';
  let helpOpen = false;

  // Initial widget render
  const widget0 = renderFakeInput(buffer, '', true);
  process.stdout.write(widget0 + '\n');
  let drawnLines = widget0.split('\n').length - 1;

  const { stdin } = process;
  const wasRaw = stdin.isRaw;
  if (stdin.isTTY) stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding('utf8');

  const redraw = () => {
    clearLines(drawnLines);
    const widget = renderFakeInput(buffer, errorMsg, true);
    const parts  = [widget];
    if (helpOpen) {
      const helpBlock = renderInlineHelp({ label, fieldType, required, unit, defaultValue, note });
      parts.push('', helpBlock);
    }
    const text   = parts.join('\n') + '\n';
    drawnLines   = text.split('\n').length - 1;
    process.stdout.write(text);
  };

  return new Promise((resolve) => {
    const cleanup = () => {
      stdin.removeListener('data', onData);
      stdin.pause();
      if (stdin.isTTY) stdin.setRawMode(wasRaw ?? false);
    };

    const onData = (key) => {
      // Ctrl+C / Ctrl+D → propagate interrupt
      if (key === '\x03' || key === '\x04') {
        cleanup();
        process.exit(130);
      }

      // Enter → validate and resolve
      if (key === '\r' || key === '\n') {
        const trimmed = buffer.trim();
        const value   = trimmed !== ''
          ? trimmed
          : (defaultValue !== null && defaultValue !== undefined && defaultValue !== '')
            ? String(defaultValue)
            : '';

        if (value === '' && required) {
          errorMsg = 'This field is required.';
          redraw();
          return;
        }

        if (fieldType === 'NUMBER' && value !== '' && isNaN(Number(value))) {
          errorMsg = `Expected a number, got: "${value}"`;
          buffer   = '';
          redraw();
          return;
        }

        // Valid — replace live widget with submitted (inactive) widget
        cleanup();
        clearLines(drawnLines);
        process.stdout.write(renderSubmittedInput(value) + '\n');
        resolve(value);
        return;
      }

      // Toggle help panel
      if (key === '?') {
        helpOpen = !helpOpen;
        redraw();
        return;
      }

      // Backspace
      if (key === '\x7f' || key === '\x08') {
        buffer   = buffer.slice(0, -1);
        errorMsg = '';
        redraw();
        return;
      }

      // Printable char (ASCII or multi-byte UTF-8)
      if (key >= ' ' || key.charCodeAt(0) > 127) {
        buffer  += key;
        errorMsg = '';
        redraw();
        return;
      }
      // Ignore ESC sequences (arrow keys etc.)
    };

    stdin.on('data', onData);
  });
}
