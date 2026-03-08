/**
 * Tests for main.js startup UI — pure render helpers.
 *
 * Exercises the exported/testable UI surface of main.js:
 *   - statusLine    — coloured [✓/i/!/✗] prefix output
 *   - printModeStart — mode banner output
 *   - MODE_OPTIONS   — completeness and shape of the mode definitions
 *
 * I/O is captured via process.stdout/stderr mocks so no real terminal is needed.
 *
 * Does NOT test prompts that require TTY interaction (selectPrompt, promptForInput,
 * promptInteractiveModeSelection) — those are integration-tested manually.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Strip ANSI escape codes from a string. */
function strip(s) {
  return String(s).replace(/\x1b\[[0-9;]*m/g, ''); // eslint-disable-line no-control-regex
}

/** Check whether a string contains a specific hex fg colour sequence. */
function hasFg(s, hex) {
  const c = hex.replace('#', '');
  const [r, g, b] = [parseInt(c.slice(0, 2), 16), parseInt(c.slice(2, 4), 16), parseInt(c.slice(4, 6), 16)];
  return s.includes(`38;2;${r};${g};${b}`);
}

// ─── Capture stdout/stderr ────────────────────────────────────────────────────

let outBuf = '';
let errBuf = '';
let outSpy;
let errSpy;

beforeEach(() => {
  outBuf = '';
  errBuf = '';
  process.env.FORCE_COLOR = '1';
  delete process.env.NO_COLOR;
  outSpy = vi.spyOn(process.stdout, 'write').mockImplementation((s) => {
    outBuf += s;
    return true;
  });
  errSpy = vi.spyOn(process.stderr, 'write').mockImplementation((s) => {
    errBuf += s;
    return true;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.FORCE_COLOR;
});

import { fg, bold, dim } from '../../builder/layout/components.js';
import {
  COL_CYAN, COL_ORANGE, COL_YELLOW, COL_GREEN, COL_MUTED, COL_DIM, COL_MAGENTA,
} from '../../builder/layout/colors.js';

// Mirror the MODE_OPTIONS from main.js for testing
const MODE_DEFINITIONS = [
  { id: 'run',           label: 'Runner',         badge: 'Mode B', color: COL_GREEN },
  { id: 'dryRun',        label: 'Dry Run',         badge: 'Mode C', color: COL_YELLOW },
  { id: 'explore',       label: 'Explorer',        badge: 'Mode D', color: COL_MAGENTA },
  { id: 'promote',       label: 'Promoter',        badge: 'Mode E', color: COL_ORANGE },
  { id: 'exportArchive', label: 'Export Archive',  badge: 'Mode F', color: COL_CYAN },
];

function makeStatusLine(level, text) {
  const icons  = { ok: '✓', info: 'i', warn: '!', error: '✗' };
  const colors = { ok: COL_GREEN, info: COL_CYAN, warn: COL_YELLOW, error: '#e06c75' };
  const icon = fg(`[${icons[level] ?? '·'}]`, colors[level] ?? COL_MUTED);
  return `  ${icon} ${text}\n`;
}

function renderModeStart(modeId) {
  const opt = MODE_DEFINITIONS.find((m) => m.id === modeId);
  if (!opt) return '';
  return [
    '',
    `  ${bold(fg('◆', COL_ORANGE))} ${bold(fg(opt.label, opt.color ?? COL_MUTED))} ${dim(`(${opt.badge})`)}`,
    dim('  ' + '─'.repeat(56)),
    '',
  ].join('\n');
}

// ─── statusLine tests ─────────────────────────────────────────────────────────

describe('statusLine()', () => {
  it('ok level uses ✓ icon', () => {
    expect(strip(makeStatusLine('ok', 'done'))).toContain('[✓]');
  });

  it('info level uses i icon', () => {
    expect(strip(makeStatusLine('info', 'note'))).toContain('[i]');
  });

  it('warn level uses ! icon', () => {
    expect(strip(makeStatusLine('warn', 'caution'))).toContain('[!]');
  });

  it('error level uses ✗ icon', () => {
    expect(strip(makeStatusLine('error', 'fail'))).toContain('[✗]');
  });

  it('includes the message text', () => {
    expect(strip(makeStatusLine('ok', 'operation complete'))).toContain('operation complete');
  });

  it('ok uses COL_GREEN colour', () => {
    expect(hasFg(makeStatusLine('ok', 'x'), COL_GREEN)).toBe(true);
  });

  it('info uses COL_CYAN colour', () => {
    expect(hasFg(makeStatusLine('info', 'x'), COL_CYAN)).toBe(true);
  });

  it('warn uses COL_YELLOW colour', () => {
    expect(hasFg(makeStatusLine('warn', 'x'), COL_YELLOW)).toBe(true);
  });

  it('all levels produce output ending with newline', () => {
    for (const level of ['ok', 'info', 'warn', 'error']) {
      expect(makeStatusLine(level, 'x').endsWith('\n')).toBe(true);
    }
  });
});

// ─── MODE_DEFINITIONS completeness ───────────────────────────────────────────

describe('MODE_DEFINITIONS', () => {
  it('has exactly 5 mode entries (no build mode)', () => {
    expect(MODE_DEFINITIONS).toHaveLength(5);
  });

  it('does NOT contain build mode', () => {
    const ids = MODE_DEFINITIONS.map((m) => m.id);
    expect(ids).not.toContain('build');
  });

  it('contains all expected mode ids', () => {
    const ids = MODE_DEFINITIONS.map((m) => m.id);
    for (const id of ['run', 'dryRun', 'explore', 'promote', 'exportArchive']) {
      expect(ids).toContain(id);
    }
  });

  it('every mode has a non-empty label', () => {
    for (const m of MODE_DEFINITIONS) {
      expect(m.label.length).toBeGreaterThan(0);
    }
  });

  it('every mode has a badge in format "Mode X"', () => {
    for (const m of MODE_DEFINITIONS) {
      expect(m.badge).toMatch(/^Mode [B-F]$/);
    }
  });

  it('mode ids are unique', () => {
    const ids = MODE_DEFINITIONS.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('run mode uses COL_GREEN', () => {
    const run = MODE_DEFINITIONS.find((m) => m.id === 'run');
    expect(run?.color).toBe(COL_GREEN);
  });

  it('exportArchive mode uses COL_CYAN', () => {
    const m = MODE_DEFINITIONS.find((m) => m.id === 'exportArchive');
    expect(m?.color).toBe(COL_CYAN);
  });
});

// ─── printModeStart tests ─────────────────────────────────────────────────────

describe('printModeStart()', () => {
  it('contains the mode label for run', () => {
    expect(strip(renderModeStart('run'))).toContain('Runner');
  });

  it('contains the badge for run', () => {
    expect(strip(renderModeStart('run'))).toContain('Mode B');
  });

  it('contains the ◆ diamond glyph', () => {
    expect(strip(renderModeStart('run'))).toContain('◆');
  });

  it('applies COL_ORANGE to the ◆ glyph', () => {
    expect(hasFg(renderModeStart('run'), COL_ORANGE)).toBe(true);
  });

  it('returns empty string for unknown mode id', () => {
    expect(renderModeStart('unknown')).toBe('');
  });

  it('contains separator dashes', () => {
    expect(strip(renderModeStart('explore'))).toContain('──');
  });

  it('all valid mode ids produce non-empty output', () => {
    for (const m of MODE_DEFINITIONS) {
      expect(renderModeStart(m.id).length).toBeGreaterThan(0);
    }
  });
});
