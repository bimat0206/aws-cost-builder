/**
 * Tests for main.js startup UI — pure render helpers.
 *
 * Exercises the exported/testable UI surface of the extracted CLI UI modules:
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
import { MODE_OPTIONS } from '../../cli/mode_options.js';
import { printModeStart, statusLine } from '../../cli/ui.js';

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

import {
  COL_CYAN, COL_ORANGE, COL_YELLOW, COL_GREEN,
} from '../../builder/layout/colors.js';

// ─── statusLine tests ─────────────────────────────────────────────────────────

describe('statusLine()', () => {
  it('ok level uses ✓ icon', () => {
    statusLine('ok', 'done');
    expect(strip(errBuf)).toContain('[✓]');
  });

  it('info level uses i icon', () => {
    statusLine('info', 'note');
    expect(strip(errBuf)).toContain('[i]');
  });

  it('warn level uses ! icon', () => {
    statusLine('warn', 'caution');
    expect(strip(errBuf)).toContain('[!]');
  });

  it('error level uses ✗ icon', () => {
    statusLine('error', 'fail');
    expect(strip(errBuf)).toContain('[✗]');
  });

  it('includes the message text', () => {
    statusLine('ok', 'operation complete');
    expect(strip(errBuf)).toContain('operation complete');
  });

  it('ok uses COL_GREEN colour', () => {
    statusLine('ok', 'x');
    expect(hasFg(errBuf, COL_GREEN)).toBe(true);
  });

  it('info uses COL_CYAN colour', () => {
    statusLine('info', 'x');
    expect(hasFg(errBuf, COL_CYAN)).toBe(true);
  });

  it('warn uses COL_YELLOW colour', () => {
    statusLine('warn', 'x');
    expect(hasFg(errBuf, COL_YELLOW)).toBe(true);
  });

  it('all levels produce output ending with newline', () => {
    for (const level of ['ok', 'info', 'warn', 'error']) {
      errBuf = '';
      statusLine(level, 'x');
      expect(errBuf.endsWith('\n')).toBe(true);
    }
  });
});

// ─── MODE_OPTIONS completeness ───────────────────────────────────────────────

describe('MODE_OPTIONS', () => {
  it('has exactly 4 mode entries (no build or explore mode)', () => {
    expect(MODE_OPTIONS).toHaveLength(4);
  });

  it('does NOT contain build mode', () => {
    const ids = MODE_OPTIONS.map((m) => m.id);
    expect(ids).not.toContain('build');
  });

  it('contains all expected mode ids', () => {
    const ids = MODE_OPTIONS.map((m) => m.id);
    for (const id of ['run', 'dryRun', 'promote', 'exportArchive']) {
      expect(ids).toContain(id);
    }
  });

  it('every mode has a non-empty label', () => {
    for (const m of MODE_OPTIONS) {
      expect(m.label.length).toBeGreaterThan(0);
    }
  });

  it('every mode has a badge in format "Mode X"', () => {
    for (const m of MODE_OPTIONS) {
      expect(m.badge).toMatch(/^Mode [B-E]$/);
    }
  });

  it('mode ids are unique', () => {
    const ids = MODE_OPTIONS.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('run mode uses COL_GREEN', () => {
    const run = MODE_OPTIONS.find((m) => m.id === 'run');
    expect(run?.color).toBe(COL_GREEN);
  });

  it('exportArchive mode uses COL_CYAN', () => {
    const m = MODE_OPTIONS.find((m) => m.id === 'exportArchive');
    expect(m?.color).toBe(COL_CYAN);
  });
});

// ─── printModeStart tests ─────────────────────────────────────────────────────

describe('printModeStart()', () => {
  it('contains the mode label for run', () => {
    printModeStart('run');
    expect(strip(outBuf)).toContain('Runner');
  });

  it('contains the badge for run', () => {
    printModeStart('run');
    expect(strip(outBuf)).toContain('Mode B');
  });

  it('contains the ◆ diamond glyph', () => {
    printModeStart('run');
    expect(strip(outBuf)).toContain('◆');
  });

  it('applies COL_ORANGE to the ◆ glyph', () => {
    printModeStart('run');
    expect(hasFg(outBuf, COL_ORANGE)).toBe(true);
  });

  it('returns empty string for unknown mode id', () => {
    printModeStart('unknown');
    expect(outBuf).toBe('');
  });

  it('contains separator dashes', () => {
    printModeStart('promote');
    expect(strip(outBuf)).toContain('──');
  });

  it('all valid mode ids produce non-empty output', () => {
    for (const m of MODE_OPTIONS) {
      outBuf = '';
      printModeStart(m.id);
      expect(outBuf.length).toBeGreaterThan(0);
    }
  });
});
