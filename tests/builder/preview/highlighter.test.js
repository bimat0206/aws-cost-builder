/**
 * Tests for builder/preview/highlighter.js
 *
 * Covers:
 *  - splitKeyValue: correct key/value split, edge cases
 *  - classifyLine: all six kinds, boundary conditions
 *  - highlightLine: correct ANSI colour applied per kind
 *  - highlightLine with isActive=true: ▶ glyph, BG_ACTIVE background, bold cyan key
 *  - Non-string input safety (never throws)
 *
 * Validates: Requirements 7.2, 7.3 (colour contract per line type)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  splitKeyValue,
  classifyLine,
  highlightLine,
} from '../../../builder/preview/highlighter.js';
import {
  COL_BLUE, COL_GREEN, COL_YELLOW, COL_MAGENTA, COL_DIM, COL_CYAN, COL_BG_ACTIVE,
} from '../../../builder/layout/colors.js';

// ─── Test helpers ─────────────────────────────────────────────────────────────

/** Strip all ANSI escape sequences. */
function strip(str) {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1b\[[0-9;]*m/g, '');
}

/** Convert hex "#rrggbb" to the three decimal components as they appear in ANSI. */
function hexRgb(hex) {
  const c = hex.replace('#', '');
  return [parseInt(c.slice(0, 2), 16), parseInt(c.slice(2, 4), 16), parseInt(c.slice(4, 6), 16)];
}

/** Return true when `str` contains an ANSI fg sequence for `hex`. */
function containsFg(str, hex) {
  const [r, g, b] = hexRgb(hex);
  return str.includes(`38;2;${r};${g};${b}`);
}

/** Return true when `str` contains an ANSI bg sequence for `hex`. */
function containsBg(str, hex) {
  const [r, g, b] = hexRgb(hex);
  return str.includes(`48;2;${r};${g};${b}`);
}

// Force colour on for all tests
const origForceColor = process.env.FORCE_COLOR;
beforeEach(() => { process.env.FORCE_COLOR = '1'; delete process.env.NO_COLOR; });
afterEach(() => {
  if (origForceColor === undefined) delete process.env.FORCE_COLOR;
  else process.env.FORCE_COLOR = origForceColor;
});

// ─── splitKeyValue ────────────────────────────────────────────────────────────

describe('splitKeyValue()', () => {
  it('splits "project_name: \\"Acme\\"" into key and value', () => {
    const { key, value } = splitKeyValue('project_name: "Acme"');
    expect(key).toContain('project_name');
    expect(value).toBe('"Acme"');
  });

  it('splits "  instance_count: 4" correctly', () => {
    const { key, value } = splitKeyValue('  instance_count: 4');
    expect(key).toContain('instance_count');
    expect(value).toBe('4');
  });

  it('returns value "" for key-only lines like "groups:"', () => {
    const { value } = splitKeyValue('groups:');
    expect(value).toBe('');
  });

  it('preserves leading indentation in the key portion', () => {
    const { key } = splitKeyValue('    region: "us-east-1"');
    expect(key).toMatch(/^\s+region/);
  });

  it('handles "key: ?" correctly', () => {
    const { value } = splitKeyValue('instance_type: ?');
    expect(value).toBe('?');
  });

  it('handles boolean values', () => {
    const { value } = splitKeyValue('enabled: true');
    expect(value).toBe('true');
  });
});

// ─── classifyLine ─────────────────────────────────────────────────────────────

describe('classifyLine()', () => {
  it('classifies empty string as structural', () => {
    expect(classifyLine('')).toBe('structural');
    expect(classifyLine('   ')).toBe('structural');
  });

  it('classifies comment lines as structural', () => {
    expect(classifyLine('# this is a comment')).toBe('structural');
  });

  it('classifies list items as structural', () => {
    expect(classifyLine('  - group_name: "Web"')).toBe('structural');
    expect(classifyLine('- item')).toBe('structural');
  });

  it('classifies "groups:" as key-only', () => {
    expect(classifyLine('groups:')).toBe('key-only');
  });

  it('classifies "  services:" as key-only', () => {
    expect(classifyLine('  services:')).toBe('key-only');
  });

  it('classifies string values as string', () => {
    expect(classifyLine('project_name: "Acme"')).toBe('string');
    expect(classifyLine("region: 'us-east-1'")).toBe('string');
  });

  it('classifies numeric values as number', () => {
    expect(classifyLine('instance_count: 4')).toBe('number');
    expect(classifyLine('storage_gb: 500')).toBe('number');
    expect(classifyLine('ratio: 0.5')).toBe('number');
  });

  it('classifies true/false values as boolean', () => {
    expect(classifyLine('enabled: true')).toBe('boolean');
    expect(classifyLine('versioning: false')).toBe('boolean');
  });

  it('classifies "?" values as unanswered', () => {
    expect(classifyLine('instance_type: ?')).toBe('unanswered');
  });

  it('does not classify a negative number as something else', () => {
    expect(classifyLine('delta: -5')).toBe('number');
  });
});

// ─── highlightLine — colours ──────────────────────────────────────────────────

describe('highlightLine() — colour rules', () => {
  it('key-only lines use COL_BLUE', () => {
    const result = highlightLine('groups:');
    expect(containsFg(result, COL_BLUE)).toBe(true);
    expect(strip(result)).toBe('groups:');
  });

  it('string value lines: key in COL_BLUE, value in COL_GREEN', () => {
    const result = highlightLine('project_name: "Acme"');
    expect(containsFg(result, COL_BLUE)).toBe(true);
    expect(containsFg(result, COL_GREEN)).toBe(true);
    expect(strip(result)).toContain('"Acme"');
  });

  it('numeric value lines: key in COL_BLUE, value in COL_YELLOW', () => {
    const result = highlightLine('instance_count: 4');
    expect(containsFg(result, COL_BLUE)).toBe(true);
    expect(containsFg(result, COL_YELLOW)).toBe(true);
    expect(strip(result)).toContain('4');
  });

  it('boolean value lines: key in COL_BLUE, value in COL_MAGENTA', () => {
    const result = highlightLine('enabled: true');
    expect(containsFg(result, COL_BLUE)).toBe(true);
    expect(containsFg(result, COL_MAGENTA)).toBe(true);
    expect(strip(result)).toContain('true');
  });

  it('unanswered value "?" lines: key in COL_BLUE, value in COL_DIM', () => {
    const result = highlightLine('instance_type: ?');
    expect(containsFg(result, COL_BLUE)).toBe(true);
    expect(containsFg(result, COL_DIM)).toBe(true);
    expect(strip(result)).toContain('?');
  });

  it('structural lines (list items) use COL_DIM', () => {
    const result = highlightLine('  - group_name: "Web"');
    expect(containsFg(result, COL_DIM)).toBe(true);
  });

  it('empty lines produce a dim empty string', () => {
    const result = highlightLine('');
    expect(strip(result)).toBe('');
  });
});

// ─── highlightLine — active line ─────────────────────────────────────────────

describe('highlightLine() — active line (isActive=true)', () => {
  it('prepends the ▶ glyph', () => {
    const result = highlightLine('instance_type: ?', true);
    expect(strip(result)).toContain('▶');
  });

  it('▶ glyph appears before the line content', () => {
    const result = strip(highlightLine('instance_type: ?', true));
    expect(result.indexOf('▶')).toBeLessThan(result.indexOf('instance_type'));
  });

  it('applies COL_BG_ACTIVE background to the whole line', () => {
    const result = highlightLine('instance_type: ?', true);
    expect(containsBg(result, COL_BG_ACTIVE)).toBe(true);
  });

  it('key is rendered in COL_CYAN (not COL_BLUE) when active', () => {
    const result = highlightLine('instance_type: ?', true);
    expect(containsFg(result, COL_CYAN)).toBe(true);
  });

  it('active key-only line also gets ▶ and BG_ACTIVE', () => {
    const result = highlightLine('groups:', true);
    expect(strip(result)).toContain('▶');
    expect(containsBg(result, COL_BG_ACTIVE)).toBe(true);
  });

  it('inactive line does NOT contain the ▶ glyph', () => {
    const result = strip(highlightLine('instance_type: ?', false));
    expect(result).not.toContain('▶');
  });

  it('inactive line does NOT have BG_ACTIVE background', () => {
    const result = highlightLine('instance_type: ?', false);
    expect(containsBg(result, COL_BG_ACTIVE)).toBe(false);
  });
});

// ─── highlightLine — safety ───────────────────────────────────────────────────

describe('highlightLine() — robustness', () => {
  it('never throws for any string input', () => {
    const inputs = ['', '  ', 'no colon here', ':', '::', '  -', null, undefined, 42];
    for (const input of inputs) {
      expect(() => highlightLine(input)).not.toThrow();
    }
  });

  it('returns a string for non-string input', () => {
    expect(typeof highlightLine(null)).toBe('string');
    expect(typeof highlightLine(undefined)).toBe('string');
  });
});
