/**
 * Two-phase toggle prompt (S3-style section selector).
 *
 * ## Phase 1 — Section checklist
 *
 * Renders a full-screen checklist of all `sections` with `◆`/`◇` glyphs.
 * The user can toggle items with Space and confirm with Enter.
 *
 * Visual (per row):
 *   ◆ Enabled Section     (COL_YELLOW diamond, COL_GREEN label, COL_BG_ACTIVE background)
 *   ◇ Disabled Section    (COL_DIM diamond and label)
 *
 * Header: "Select Feature Sections · Phase 1 of 2 — N enabled"
 * Hint:   "Space/click to toggle · Enter to confirm and begin Phase 2"
 *
 * ## Phase 2 — Enabled sections list
 *
 * Returns the array of enabled section names so the calling wizard can
 * iterate over them.  The Phase 2 UI (phase indicator bar + field prompts)
 * is rendered by the wizard layer; this module only returns the selection.
 *
 * ## Keyboard controls (Phase 1)
 *   ↑ / k   — move cursor up
 *   ↓ / j   — move cursor down
 *   Space   — toggle selection at cursor
 *   Enter   — confirm and return selected sections
 *   a       — select all
 *   n       — deselect all
 *
 * All render helpers are exported for unit testing.
 *
 * @module builder/prompts/toggle_prompt
 */

import {
  COL_YELLOW, COL_GREEN, COL_DIM, COL_BG_ACTIVE, COL_ORANGE, COL_CYAN, COL_MUTED,
} from '../layout/colors.js';
import { fg, bg, bold, dim, padEnd, DiamondHeader } from '../layout/components.js';

// ─── Render helpers ───────────────────────────────────────────────────────────

/**
 * Render the Phase 1 header.
 *
 * @param {number} enabledCount
 * @param {number} totalCount
 * @returns {string}
 */
export function renderToggleHeader(enabledCount, totalCount) {
  const count = fg(`${enabledCount} enabled`, enabledCount > 0 ? COL_GREEN : COL_DIM);
  const subtitle = `Phase 1 of 2 · ${count}`;
  return DiamondHeader('Select Feature Sections', subtitle);
}

/**
 * Render one toggle row.
 *
 * @param {string}  label     - Section name.
 * @param {boolean} enabled   - Whether this section is currently toggled on.
 * @param {boolean} isCursor  - Whether the cursor is on this row.
 * @returns {string}
 */
export function renderToggleRow(label, enabled, isCursor) {
  const glyph = enabled ? fg('\u25C6', COL_YELLOW) : fg('\u25C7', COL_DIM); // ◆ ◇
  const rail = enabled ? fg('▌ ', COL_GREEN) : fg('│ ', COL_DIM);
  const text  = enabled ? bold(fg(` ${label}`, COL_GREEN)) : fg(` ${label}`, COL_DIM);
  const row   = `  ${rail}${glyph}${text}`;
  return isCursor ? bg(padEnd(row, 60), COL_BG_ACTIVE) : row;
}

/**
 * Render the full Phase 1 checklist block.
 *
 * @param {string[]} sections   - All section names.
 * @param {Set<string>} enabled - Currently enabled section names.
 * @param {number}   cursor     - 0-based cursor row index.
 * @returns {string}
 */
export function renderToggleList(sections, enabled, cursor, descriptions = {}) {
  const header = renderToggleHeader(enabled.size, sections.length);
  const rows   = [];
  for (let i = 0; i < sections.length; i++) {
    const sectionName = sections[i];
    const isCursor = i === cursor;
    rows.push(renderToggleRow(sectionName, enabled.has(sectionName), isCursor));
    if (descriptions[sectionName]) {
      const descText = dim(`      ${descriptions[sectionName]}`);
      rows.push(isCursor ? bg(padEnd(descText, 60), COL_BG_ACTIVE) : descText);
    }
  }
  const hint   = dim('\n Space to toggle · Enter to confirm · a = all · n = none');
  return [header, '', ...rows, hint].join('\n');
}

// ─── Phase 2 indicator bar ────────────────────────────────────────────────────

/**
 * Render the Phase 2 indicator bar that appears above field prompts when
 * iterating selected sections.
 *
 * Displays an orange-bordered box listing enabled sections as pills:
 *   ╭─ Phase 2 of 2 · Enabled ──────────────────╮
 *   │  ◆ S3 Standard  ·  ◆ S3 Standard-IA  …   │
 *   ╰────────────────────────────────────────────╯
 *
 * Per design mock §screen-09.
 *
 * @param {string[]} enabledSections - Ordered list of enabled section names.
 * @param {number}   [currentSection=1] - 1-based index of current active section.
 * @param {number}   [totalSections]    - Total number of enabled sections.
 * @returns {string}
 */
export function renderPhase2Bar(enabledSections, currentSection = 1, totalSections) {
  const total = totalSections ?? enabledSections.length;
  const border  = (s) => fg(s, COL_ORANGE);
  const width   = 60;
  const inner   = width - 2;

  // Title line
  const titleText = ` Phase 2 of 2 · Enabled `;
  const dashRight = Math.max(0, inner - 2 - titleText.length);
  const top = border('╭') + border('──') + bold(fg(titleText, COL_ORANGE))
            + border('─'.repeat(dashRight)) + border('╮');
  const bot = border('╰') + border('─'.repeat(inner)) + border('╯');

  // Pills row: ◆ Name  ·  ◆ Name  (current section in COL_CYAN)
  const pills = enabledSections.map((name, idx) => {
    const isActive = idx === currentSection - 1;
    const glyph = fg('◆', isActive ? COL_CYAN : COL_YELLOW);
    const label = isActive ? bold(fg(name, COL_CYAN)) : fg(name, COL_MUTED);
    return `${glyph} ${label}`;
  });
  const pillRow = pills.join(fg('  ·  ', COL_DIM));
  const mid = border('│') + ' ' + padEnd(pillRow, inner - 1) + border('│');

  // Progress hint
  const hint = dim(`    Section ${currentSection} of ${total}`);

  return [top, mid, bot, hint].join('\n');
}


// ─── ANSI cursor helpers ──────────────────────────────────────────────────────

function clearLines(n) {
  if (n > 0) process.stdout.write(`\x1b[${n}A\x1b[J`);
}

// ─── Core prompt ──────────────────────────────────────────────────────────────

/**
 * Run the two-phase toggle prompt.
 *
 * Phase 1 lets the user toggle sections on/off interactively.
 * Phase 2 is handled by the caller — this function returns the list of
 * enabled section names so the wizard can iterate over them.
 *
 * @param {object}    opts
 * @param {string[]}  opts.sections          - All available section names (non-empty).
 * @param {Set<string>|string[]} [opts.defaultEnabled] - Initially-enabled sections.
 * @returns {Promise<string[]>}  Ordered list of enabled section names.
 */
export async function togglePrompt(opts) {
  const { sections, defaultEnabled, descriptions = {} } = opts;

  if (!sections || sections.length === 0) {
    return [];
  }

  // Initialise enabled set
  const enabled = new Set(
    defaultEnabled
      ? (defaultEnabled instanceof Set ? [...defaultEnabled] : defaultEnabled)
      : [],
  );

  let cursor = 0;

  // Draw initial list
  const render = () => renderToggleList(sections, enabled, cursor, descriptions);
  const initial = '\n' + render() + '\n';
  process.stdout.write(initial);
  // lines = header + blank + N section rows + blank + hint + trailing newline
  let drawnLines = initial.split('\n').length - 1;

  const { stdin } = process;
  const wasRaw = stdin.isRaw;
  if (stdin.isTTY) stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding('utf8');

  return new Promise((resolve) => {
    const onData = (key) => {
      if (key === '\x03' || key === '\x04') {        // Ctrl+C / Ctrl+D
        cleanup();
        process.exit(130);
      }

      if (key === '\r' || key === '\n') {            // Enter → confirm
        cleanup();
        clearLines(drawnLines);
        const selected = sections.filter(s => enabled.has(s));
        const summary  = selected.length > 0
          ? fg(`${selected.length} section(s) enabled`, COL_GREEN)
          : fg('No sections enabled', COL_DIM);
        process.stdout.write(dim('Phase 1 complete: ') + summary + '\n');
        resolve(selected);
        return;
      }

      if (key === ' ') {                             // Space → toggle
        const s = sections[cursor];
        if (enabled.has(s)) enabled.delete(s);
        else                enabled.add(s);
      } else if (key === '\x1b[A' || key === 'k') { // ↑
        cursor = (cursor - 1 + sections.length) % sections.length;
      } else if (key === '\x1b[B' || key === 'j') { // ↓
        cursor = (cursor + 1) % sections.length;
      } else if (key === 'a') {                      // all
        sections.forEach(s => enabled.add(s));
      } else if (key === 'n') {                      // none
        enabled.clear();
      } else {
        return;
      }

      clearLines(drawnLines);
      const newText = render() + '\n';
      drawnLines = newText.split('\n').length - 1;
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
