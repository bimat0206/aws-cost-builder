/**
 * Tests for builder/layout/components.js
 *
 * Covers:
 *  - fg / bg / bold / dim: ANSI sequence wrapping + colour suppression
 *  - visibleLength: strips ANSI sequences correctly
 *  - padEnd: pads to exact visible width
 *  - RESET: exported reset sequence for layout engine panel rendering
 *
 * Validates: active layout runtime primitives only
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  fg, bg, bold, dim,
  visibleLength,
  padEnd,
  RESET,
} from '../../../builder/layout/components.js';
import { COL_CYAN } from '../../../builder/layout/colors.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Strip all ANSI escape sequences from a string. */
function stripAnsi(str) {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1b\[[0-9;]*m/g, '');
}

/** Check whether a string contains an ANSI escape sequence. */
function hasAnsi(str) {
  // eslint-disable-next-line no-control-regex
  return /\x1b\[/.test(str);
}

// Force colour on in tests so we can assert ANSI sequences
const origIsTTY = process.stdout.isTTY;
const origForceColor = process.env.FORCE_COLOR;

beforeEach(() => {
  process.env.FORCE_COLOR = '1';
  delete process.env.NO_COLOR;
});

afterEach(() => {
  if (origForceColor === undefined) delete process.env.FORCE_COLOR;
  else process.env.FORCE_COLOR = origForceColor;
  if (origIsTTY !== undefined) Object.defineProperty(process.stdout, 'isTTY', { value: origIsTTY, configurable: true });
});

// ─── ANSI helpers ─────────────────────────────────────────────────────────────

describe('fg()', () => {
  it('wraps text with ANSI 24-bit foreground colour escape', () => {
    const result = fg('hello', '#56b6c2');
    expect(result).toContain('38;2;86;182;194');
    expect(stripAnsi(result)).toBe('hello');
  });

  it('ends with foreground reset code', () => {
    const result = fg('x', '#ffffff');
    expect(result).toMatch(/\x1b\[39m$/);
  });

  it('suppresses ANSI when NO_COLOR is set', () => {
    process.env.NO_COLOR = '1';
    delete process.env.FORCE_COLOR;
    const result = fg('hello', '#56b6c2');
    expect(hasAnsi(result)).toBe(false);
    expect(result).toBe('hello');
    delete process.env.NO_COLOR;
    process.env.FORCE_COLOR = '1';
  });
});

describe('bg()', () => {
  it('wraps text with ANSI 24-bit background colour escape', () => {
    const result = bg('hello', '#2c313c');
    expect(result).toContain('48;2;');
    expect(stripAnsi(result)).toBe('hello');
  });

  it('ends with background reset code', () => {
    const result = bg('x', '#ffffff');
    expect(result).toMatch(/\x1b\[49m$/);
  });
});

describe('bold()', () => {
  it('wraps text with bold escape', () => {
    const result = bold('text');
    expect(result).toContain('\x1b[1m');
    expect(result).toContain('\x1b[22m');
    expect(stripAnsi(result)).toBe('text');
  });
});

describe('dim()', () => {
  it('wraps text with dim escape', () => {
    const result = dim('text');
    expect(result).toContain('\x1b[2m');
    expect(stripAnsi(result)).toBe('text');
  });
});

// ─── visibleLength ────────────────────────────────────────────────────────────

describe('visibleLength()', () => {
  it('returns string length for plain text', () => {
    expect(visibleLength('hello')).toBe(5);
  });

  it('ignores ANSI colour sequences', () => {
    const colored = fg('hello', COL_CYAN);
    expect(visibleLength(colored)).toBe(5);
  });

  it('ignores bold and dim sequences', () => {
    const styled = bold(dim('hi'));
    expect(visibleLength(styled)).toBe(2);
  });

  it('returns 0 for empty string', () => {
    expect(visibleLength('')).toBe(0);
  });
});

// ─── padEnd ───────────────────────────────────────────────────────────────────

describe('padEnd()', () => {
  it('pads plain text to target width', () => {
    const result = padEnd('hi', 6);
    expect(result).toBe('hi    ');
    expect(result.length).toBe(6);
  });

  it('pads ANSI-coloured text to target visible width', () => {
    const colored = fg('hi', COL_CYAN);
    const padded  = padEnd(colored, 6);
    expect(visibleLength(padded)).toBe(6);
  });

  it('does not truncate when already at width', () => {
    const result = padEnd('hello', 5);
    expect(result).toBe('hello');
  });

  it('does not truncate when longer than width', () => {
    const result = padEnd('hello world', 4);
    expect(result).toBe('hello world'); // no truncation
  });
});

// ─── RESET ────────────────────────────────────────────────────────────────────

describe('RESET', () => {
  it('exports the ANSI reset-all sequence', () => {
    expect(RESET).toBe('\x1b[0m');
  });
});
