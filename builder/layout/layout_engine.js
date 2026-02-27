/**
 * Layout engine — split-screen TUI layout management.
 *
 * Manages two rendering modes:
 *
 * SPLIT MODE (terminal width ≥ MIN_SPLIT_WIDTH AND stdout is a TTY):
 *   ┌── YAML Preview (YAML_PANEL_WIDTH chars) ──┐  ┌── Prompt (flex) ──┐
 *   │  live YAML lines, syntax-highlighted       │  │  wizard prompts   │
 *   └───────────────────────────────────────────┘  └───────────────────┘
 *
 * SINGLE-COLUMN MODE (narrow terminal OR non-TTY):
 *   Full-width sequential output — prompts print directly; no live panels.
 *
 * The engine uses raw ANSI escape sequences to manage a two-pane layout
 * painted in the terminal's alternate screen buffer.  When `promptWithPause`
 * is called the live panels are cleared so the underlying prompt library can
 * write freely to stdout; they are redrawn after the prompt resolves.
 *
 * No external TUI library is required — only Node.js built-ins.
 *
 * @module builder/layout/layout_engine
 */

import { MIN_SPLIT_WIDTH, YAML_PANEL_WIDTH, COL_YAML, COL_PROMPT, COL_CYAN, COL_MAGENTA, COL_DIM, COL_BASE } from './colors.js';
import { fg, bold, visibleLength, padEnd, RESET } from './components.js';

// ─── ANSI escape helpers ──────────────────────────────────────────────────────

const ESC = '\x1b';

/** Move cursor to absolute position (1-based row, col). */
const moveTo = (row, col) => `${ESC}[${row};${col}H`;

/** Save cursor position. */
const saveCursor = () => `${ESC}[s`;

/** Restore cursor position. */
const restoreCursor = () => `${ESC}[u`;

/** Clear from cursor to end of line. */
const clearEOL = () => `${ESC}[K`;

/** Clear from cursor to end of screen. */
const clearEOS = () => `${ESC}[J`;

/** Clear entire screen and move to top-left. */
const clearScreen = () => `${ESC}[2J${ESC}[H`;

/** Enter alternate screen buffer. */
const enterAlt = () => `${ESC}[?1049h`;

/** Leave alternate screen buffer. */
const leaveAlt = () => `${ESC}[?1049l`;

/** Hide cursor. */
const hideCursor = () => `${ESC}[?25l`;

/** Show cursor. */
const showCursor = () => `${ESC}[?25h`;

/** Move cursor to column 1 of current row. */
const col1 = () => `${ESC}[1G`;

// ─── Box-drawing helpers ──────────────────────────────────────────────────────

/**
 * Draw a titled panel box.
 *
 * Returns an array of strings, one per line, suitable for writing to stdout.
 * Lines include trailing RESET so they don't bleed colour into adjacent panels.
 *
 * @param {string}   title      - Panel title (plain text).
 * @param {string[]} lines      - Content lines (may contain ANSI codes).
 * @param {number}   width      - Total panel width in characters.
 * @param {string}   borderHex  - Hex colour for border glyphs.
 * @param {string}   titleHex   - Hex colour for the title text.
 * @returns {string[]}
 */
function buildPanel(title, lines, width, borderHex, titleHex) {
  const border = (s) => fg(s, borderHex);
  const tw     = width - 4; // space inside "╭──<title>──╮"

  // Top border: ╭── Title ──────╮
  const titleFormatted = bold(fg(` ${title} `, titleHex));
  const titleVis       = visibleLength(titleFormatted);
  const dashRight      = Math.max(0, tw - titleVis);
  const topLine = border('╭') + border('──') + titleFormatted + border('─'.repeat(dashRight)) + border('╮');

  // Content lines — pad each to `width - 2` visible chars
  const innerWidth = width - 2;
  const contentLines = lines.map(line => {
    const padded = padEnd(line, innerWidth);
    return border('│') + padded.substring(0, innerWidth + (padded.length - visibleLength(padded))) + border('│');
  });

  // Bottom border
  const bottomLine = border('╰') + border('─'.repeat(width - 2)) + border('╯');

  return [topLine, ...contentLines, bottomLine];
}

// ─── LayoutEngine ─────────────────────────────────────────────────────────────

export class LayoutEngine {
  constructor() {
    /** @type {string[]} Lines currently displayed in the YAML preview panel. */
    this._previewLines = [];
    /** @type {string} Footer metadata for YAML preview panel. */
    this._previewFooter = '';

    /** @type {string} Content currently displayed in the prompt panel. */
    this._promptContent = '';

    /** @type {boolean} Whether the layout is currently active (started). */
    this._active = false;

    /** @type {boolean} Whether the live panels are currently suspended for prompting. */
    this._paused = false;

    /** @type {string[]} Messages queued to print above panels on next redraw. */
    this._scrollback = [];

    /** Cache terminal width at start() time to avoid mid-run layout shifts. */
    this._termWidth = 0;
    this._termHeight = 0;
  }

  // ─── Mode detection ─────────────────────────────────────────────────────────

  /**
   * Returns true when the terminal supports split-screen layout:
   *   - stdout is a TTY
   *   - terminal width is at least MIN_SPLIT_WIDTH columns
   *
   * @returns {boolean}
   */
  isSplitMode() {
    const isTTY   = Boolean(process.stdout.isTTY);
    const columns = process.stdout.columns ?? 0;
    return isTTY && columns >= MIN_SPLIT_WIDTH;
  }

  /**
   * Whether stdout supports colour / ANSI sequences.
   * @returns {boolean}
   */
  isColorEnabled() {
    if (process.env.NO_COLOR)    return false;
    if (process.env.FORCE_COLOR) return true;
    return Boolean(process.stdout.isTTY);
  }

  // ─── Lifecycle ───────────────────────────────────────────────────────────────

  /**
   * Initialize the layout engine.
   *
   * In split mode: snapshot terminal dimensions, enter alternate screen buffer,
   * hide cursor, and draw the initial (empty) panel layout.
   *
   * In single-column or non-TTY mode: no-op — output is sequential.
   */
  start() {
    if (this._active) return;
    this._active = true;

    if (!this.isSplitMode()) return;

    this._termWidth  = process.stdout.columns  ?? 80;
    this._termHeight = process.stdout.rows      ?? 24;

    // Handle terminal resize
    process.stdout.on('resize', () => this._onResize());

    this._write(enterAlt());
    this._write(hideCursor());
    this._write(clearScreen());
    this._render();
  }

  /**
   * Tear down the layout engine.
   *
   * Leaves the alternate screen buffer, restores cursor visibility, and
   * flushes any queued scrollback messages to regular stdout.
   */
  stop() {
    if (!this._active) return;
    this._active = false;

    if (!this.isSplitMode()) return;

    this._write(showCursor());
    this._write(leaveAlt());

    // Flush scrollback to normal terminal output
    for (const msg of this._scrollback) {
      process.stdout.write(msg + '\n');
    }
    this._scrollback = [];
  }

  // ─── Content updates ─────────────────────────────────────────────────────────

  /**
   * Update the YAML preview panel (left pane, fixed width).
   *
   * @param {string[]|{lines?: string[], footer?: string}} preview
   */
  updatePreview(preview) {
    if (Array.isArray(preview)) {
      this._previewLines = preview;
      this._previewFooter = '';
    } else if (preview && typeof preview === 'object') {
      this._previewLines = Array.isArray(preview.lines) ? preview.lines : [];
      this._previewFooter = preview.footer ? String(preview.footer) : '';
    } else {
      this._previewLines = [];
      this._previewFooter = '';
    }
    if (this._active && !this._paused && this.isSplitMode()) {
      this._render();
    }
  }

  /**
   * Update the prompt panel (right pane, flex width).
   *
   * @param {string} content  - Multi-line string for the prompt panel (may contain ANSI codes).
   */
  updatePrompt(content) {
    this._promptContent = content ?? '';
    if (this._active && !this._paused && this.isSplitMode()) {
      this._render();
    }
  }

  // ─── Scrollback / EventLog ───────────────────────────────────────────────────

  /**
   * Print a transient event message that persists in the terminal scroll history.
   *
   * In split mode: messages are queued and written above the alternate-screen
   * panels; they appear in the scroll buffer when the user exits the wizard.
   * In single-column / non-TTY mode: messages are written directly to stdout.
   *
   * @param {string} message  - Formatted message string (may contain ANSI codes).
   */
  printAbove(message) {
    if (!this._active || !this.isSplitMode()) {
      process.stdout.write(message + '\n');
      return;
    }
    if (this._paused) {
      process.stdout.write(message + '\n');
      return;
    }
    // In split mode, accumulate — flush when stop() is called.
    this._scrollback.push(message);
  }

  // ─── Prompt pause / resume ───────────────────────────────────────────────────

  /**
   * Pause the live panel rendering, run an async prompt function, then
   * resume rendering.
   *
   * Use this to hand control to readline-based prompts (e.g. enquirer,
   * node:readline) without the live panel overwriting their output.
   *
   * @template T
   * @param {() => Promise<T>} fn  - Async function that renders a prompt and
   *                                  resolves with the user's answer.
   * @returns {Promise<T>}
   */
  async promptWithPause(fn) {
    if (!this._active || !this.isSplitMode()) {
      // Non-split mode: run the prompt directly.
      return fn();
    }

    this._paused = true;

    // Leave alternate screen so the prompt can write normally.
    this._write(showCursor());
    this._write(leaveAlt());

    let result;
    try {
      result = await fn();
    } finally {
      // Re-enter alternate screen and redraw.
      this._write(enterAlt());
      this._write(hideCursor());
      this._write(clearScreen());
      this._paused = false;
      this._render();
    }

    return result;
  }

  // ─── Internals ────────────────────────────────────────────────────────────────

  /**
   * Write a string directly to stdout.
   * @param {string} str
   */
  _write(str) {
    process.stdout.write(str);
  }

  /** Handle terminal resize event. */
  _onResize() {
    this._termWidth  = process.stdout.columns  ?? 80;
    this._termHeight = process.stdout.rows      ?? 24;
    if (this._active && !this._paused && this.isSplitMode()) {
      this._write(clearScreen());
      this._render();
    }
  }

  /**
   * Compute the widths of the two panes given current terminal width.
   *
   * @returns {{ previewWidth: number, promptWidth: number }}
   */
  _paneWidths() {
    const total        = this._termWidth || (process.stdout.columns ?? 80);
    const previewWidth = YAML_PANEL_WIDTH;
    const gap          = 2; // space between panes
    const promptWidth  = Math.max(20, total - previewWidth - gap);
    return { previewWidth, promptWidth };
  }

  /**
   * Full re-render of both panels into the alternate screen buffer.
   *
   * Draws the YAML preview (left) and prompt (right) side by side using
   * absolute cursor positioning.
   */
  _render() {
    if (!this.isSplitMode()) return;

    const { previewWidth, promptWidth } = this._paneWidths();
    const termHeight = this._termHeight || (process.stdout.rows ?? 24);
    
    // YAML panel is 75% height
    const previewHeight = Math.floor(termHeight * 0.75);
    const previewInnerHeight = Math.max(1, previewHeight - 2);
    
    // Prompt panel fills available height (minus 1 for safety/footer area)
    const promptHeight = termHeight - 1;
    const promptInnerHeight = Math.max(1, promptHeight - 2);

    // ── Build YAML preview panel lines ──────────────────────────────────────
    const previewBodyHeight = previewInnerHeight;
    const totalPreviewLines = this._previewLines.length;
    const activeLineIdx = this._previewLines.findIndex((line) => stripAnsi(line).includes('▶'));
    const maxOffset = Math.max(0, totalPreviewLines - previewBodyHeight);
    const targetOffset = activeLineIdx < 0 ? 0 : activeLineIdx - Math.floor(previewBodyHeight / 2);
    const scrollOffset = Math.max(0, Math.min(targetOffset, maxOffset));

    const previewContent = this._previewLines
      .slice(scrollOffset, scrollOffset + previewBodyHeight)
      .map((line, idx) => {
        const number = fg(String(scrollOffset + idx + 1).padStart(3), COL_DIM);
        return `${number} ${line}`;
      });
    while (previewContent.length < previewInnerHeight) previewContent.push('');

    const previewPanel = buildPanel(
      'YAML Preview',
      previewContent,
      previewWidth,
      COL_YAML,
      COL_YAML,
    );

    // ── Build prompt panel lines ─────────────────────────────────────────────
    const promptRaw     = this._promptContent.split('\n');
    const promptContent = promptRaw.slice(0, promptInnerHeight);
    while (promptContent.length < promptInnerHeight) promptContent.push('');

    const promptPanel = buildPanel(
      'Prompt',
      promptContent,
      promptWidth,
      COL_PROMPT,
      COL_PROMPT,
    );

    // ── Build Footer Line (Requirement 4.5) ──────────────────────────────────
    const activeLineNo = activeLineIdx >= 0 ? activeLineIdx + 1 : 1;
    const footerMeta = this._previewFooter ? ` · ${this._previewFooter}` : '';
    const footerLine = fg(
      `Line ${activeLineNo}/${Math.max(1, totalPreviewLines)}${footerMeta}`,
      COL_DIM,
    );

    // ── Write panels side by side using absolute positioning ────────────────
    let out = '';
    out += moveTo(1, 1);

    // Draw YAML panel (left)
    for (let row = 0; row < previewPanel.length; row++) {
      out += moveTo(row + 1, 1);
      out += previewPanel[row] + RESET;
    }

    // Draw Footer below YAML panel
    out += moveTo(previewPanel.length + 1, 2);
    out += padEnd(footerLine, previewWidth - 2) + RESET;

    // Draw Prompt panel (right)
    for (let row = 0; row < promptPanel.length; row++) {
      out += moveTo(row + 1, previewWidth + 3);
      out += promptPanel[row] + RESET;
    }

    // Clear any leftover lines below the panels
    const maxHeight = Math.max(previewPanel.length + 1, promptPanel.length);
    out += moveTo(maxHeight + 1, 1) + clearEOS();

    this._write(out);
  }
}

// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[[0-9;]*m/g;

/**
 * Strip ANSI sequences from a string.
 *
 * @param {string} text
 * @returns {string}
 */
function stripAnsi(text) {
  return String(text ?? '').replace(ANSI_RE, '');
}
