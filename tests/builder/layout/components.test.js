/**
 * Tests for builder/layout/components.js
 *
 * Covers:
 *  - hexToRgb: correct parsing, edge cases, invalid inputs
 *  - fg / bg / bold / dim / italic: ANSI sequence wrapping + colour suppression
 *  - visibleLength: strips ANSI sequences correctly
 *  - padEnd: pads to exact visible width
 *  - DiamondHeader: contains ◆ glyph and title text
 *  - Breadcrumb: joins parts with › separator
 *  - ProgBar: correct format, boundary conditions
 *  - Badge: wraps text in brackets with colour
 *  - FieldTypeBadge: uses FIELD_TYPE_COLORS
 *  - RequiredBadge: correct labels for required/optional
 *  - StatusIcon: correct glyphs per type
 *  - EventMessage: wraps icon + message
 *
 * Validates: Requirements 7.1, 7.4, 7.5, 7.6, 7.7
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  hexToRgb,
  fg, bg, bold, dim, italic,
  visibleLength,
  padEnd,
  DiamondHeader,
  Breadcrumb,
  ProgBar,
  Badge,
  FieldTypeBadge,
  RequiredBadge,
  StatusIcon,
  EventMessage,
  RESET,
} from '../../../builder/layout/components.js';
import {
  COL_CYAN, COL_GREEN, COL_ORANGE, COL_YELLOW, COL_MAGENTA, COL_DIM,
  FIELD_TYPE_COLORS,
} from '../../../builder/layout/colors.js';

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

// ─── hexToRgb ─────────────────────────────────────────────────────────────────

describe('hexToRgb()', () => {
  it('parses #56b6c2 correctly', () => {
    expect(hexToRgb('#56b6c2')).toEqual([86, 182, 194]);
  });

  it('parses #0d0f13 correctly', () => {
    expect(hexToRgb('#0d0f13')).toEqual([13, 15, 19]);
  });

  it('parses #ffffff as [255, 255, 255]', () => {
    expect(hexToRgb('#ffffff')).toEqual([255, 255, 255]);
  });

  it('parses #000000 as [0, 0, 0]', () => {
    expect(hexToRgb('#000000')).toEqual([0, 0, 0]);
  });

  it('is case-insensitive', () => {
    expect(hexToRgb('#56B6C2')).toEqual([86, 182, 194]);
    expect(hexToRgb('#56b6c2')).toEqual([86, 182, 194]);
  });

  it('returns [255,255,255] for invalid input', () => {
    expect(hexToRgb('')).toEqual([255, 255, 255]);
    expect(hexToRgb('not-a-color')).toEqual([255, 255, 255]);
    expect(hexToRgb('#12345')).toEqual([255, 255, 255]); // too short
    expect(hexToRgb(null)).toEqual([255, 255, 255]);
    expect(hexToRgb(undefined)).toEqual([255, 255, 255]);
  });
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

describe('italic()', () => {
  it('wraps text with italic escape', () => {
    const result = italic('text');
    expect(result).toContain('\x1b[3m');
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

  it('ignores bold, dim, italic sequences', () => {
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

// ─── DiamondHeader ────────────────────────────────────────────────────────────

describe('DiamondHeader()', () => {
  it('contains the ◆ glyph', () => {
    const result = DiamondHeader('Test Section');
    expect(stripAnsi(result)).toContain('◆');
  });

  it('contains the title text', () => {
    const result = DiamondHeader('Project Setup · Step 1 of 3');
    expect(stripAnsi(result)).toContain('Project Setup · Step 1 of 3');
  });

  it('emits ANSI colour codes in TTY mode', () => {
    const result = DiamondHeader('My Header');
    expect(hasAnsi(result)).toBe(true);
  });

  it('plain text form has ◆ before the title', () => {
    const result = stripAnsi(DiamondHeader('Title'));
    expect(result.indexOf('◆')).toBeLessThan(result.indexOf('Title'));
  });
});

// ─── Breadcrumb ───────────────────────────────────────────────────────────────

describe('Breadcrumb()', () => {
  it('joins single part without separator', () => {
    const result = stripAnsi(Breadcrumb(['Group: Frontend']));
    expect(result).toBe('Group: Frontend');
  });

  it('joins two parts with › separator', () => {
    const result = stripAnsi(Breadcrumb(['Group: Frontend', 'Service: EC2']));
    expect(result).toContain('Group: Frontend');
    expect(result).toContain('Service: EC2');
    expect(result).toContain('›');
  });

  it('joins three parts with two › separators', () => {
    const result = stripAnsi(Breadcrumb(['A', 'B', 'C']));
    const count = (result.match(/›/g) ?? []).length;
    expect(count).toBe(2);
  });

  it('returns empty string for empty array', () => {
    const result = stripAnsi(Breadcrumb([]));
    expect(result).toBe('');
  });
});

// ─── ProgBar ──────────────────────────────────────────────────────────────────

describe('ProgBar()', () => {
  it('contains the counter [current/total]', () => {
    const result = stripAnsi(ProgBar(4, 19));
    expect(result).toContain('[4/19]');
  });

  it('contains a percentage', () => {
    const result = stripAnsi(ProgBar(1, 4));
    expect(result).toContain('(25%)');
  });

  it('shows 100% when complete', () => {
    const result = stripAnsi(ProgBar(10, 10));
    expect(result).toContain('[10/10]');
    expect(result).toContain('(100%)');
  });

  it('shows 0% for 0/N', () => {
    const result = stripAnsi(ProgBar(0, 8));
    expect(result).toContain('[0/8]');
    expect(result).toContain('(0%)');
  });

  it('clamps current > total gracefully', () => {
    const result = stripAnsi(ProgBar(12, 10));
    expect(result).toContain('[10/10]');
  });

  it('handles total=0 without division by zero', () => {
    expect(() => ProgBar(0, 0)).not.toThrow();
  });

  it('contains both filled (█) and empty (░) bar characters', () => {
    const result = stripAnsi(ProgBar(4, 8)); // 50%
    expect(result).toContain('█');
    expect(result).toContain('░');
  });

  it('full bar (100%) has no empty characters', () => {
    const result = stripAnsi(ProgBar(8, 8));
    expect(result).not.toContain('░');
  });

  it('empty bar (0%) has no filled characters', () => {
    const result = stripAnsi(ProgBar(0, 8));
    expect(result).not.toContain('█');
  });
});

// ─── Badge ────────────────────────────────────────────────────────────────────

describe('Badge()', () => {
  it('wraps text in square brackets', () => {
    const result = stripAnsi(Badge('NUMBER', COL_CYAN));
    expect(result).toBe('[NUMBER]');
  });

  it('applies colour in TTY mode', () => {
    const result = Badge('TEXT', COL_CYAN);
    expect(hasAnsi(result)).toBe(true);
  });

  it('plain text form is [label]', () => {
    const result = stripAnsi(Badge('required', COL_ORANGE));
    expect(result).toBe('[required]');
  });
});

// ─── FieldTypeBadge ───────────────────────────────────────────────────────────

describe('FieldTypeBadge()', () => {
  it.each(['NUMBER', 'TEXT', 'SELECT', 'RADIO', 'COMBOBOX', 'TOGGLE'])(
    'renders badge for %s',
    (fieldType) => {
      const result = stripAnsi(FieldTypeBadge(fieldType));
      expect(result).toBe(`[${fieldType}]`);
    }
  );

  it('uses the colour from FIELD_TYPE_COLORS', () => {
    // NUMBER → COL_CYAN: check the RGB values appear in the ANSI sequence
    const [r, g, b] = [86, 182, 194]; // #56b6c2
    const result = FieldTypeBadge('NUMBER');
    expect(result).toContain(`38;2;${r};${g};${b}`);
  });
});

// ─── RequiredBadge ────────────────────────────────────────────────────────────

describe('RequiredBadge()', () => {
  it('shows [required] for true', () => {
    expect(stripAnsi(RequiredBadge(true))).toBe('[required]');
  });

  it('shows [optional] for false', () => {
    expect(stripAnsi(RequiredBadge(false))).toBe('[optional]');
  });
});

// ─── StatusIcon ───────────────────────────────────────────────────────────────

describe('StatusIcon()', () => {
  it('success → ✓', () => {
    expect(stripAnsi(StatusIcon('success'))).toBe('✓');
  });

  it('warning → !', () => {
    expect(stripAnsi(StatusIcon('warning'))).toBe('!');
  });

  it('failure → ✗', () => {
    expect(stripAnsi(StatusIcon('failure'))).toBe('✗');
  });

  it('info → ?', () => {
    expect(stripAnsi(StatusIcon('info'))).toBe('?');
  });

  it('unknown type → ·', () => {
    expect(stripAnsi(StatusIcon('other'))).toBe('·');
  });
});

// ─── EventMessage ─────────────────────────────────────────────────────────────

describe('EventMessage()', () => {
  it('contains the icon inside brackets', () => {
    const result = stripAnsi(EventMessage('success', 'All done'));
    expect(result).toContain('[✓]');
  });

  it('contains the message text', () => {
    const result = stripAnsi(EventMessage('warning', 'Profile loaded'));
    expect(result).toContain('Profile loaded');
  });

  it('formats success as [✓] <message>', () => {
    const result = stripAnsi(EventMessage('success', 'Section complete'));
    expect(result).toBe('[✓] Section complete');
  });

  it('formats failure as [✗] <message>', () => {
    const result = stripAnsi(EventMessage('failure', 'Fill failed'));
    expect(result).toBe('[✗] Fill failed');
  });
});
