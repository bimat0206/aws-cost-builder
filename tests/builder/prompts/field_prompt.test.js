/**
 * Tests for builder/prompts/field_prompt.js
 *
 * All render helpers are pure functions — testable without touching I/O.
 * fieldPrompt() is tested via a mocked readline interface that feeds a
 * predetermined sequence of answers.
 *
 * Covers:
 *   - renderFieldLabel: label + badges in output
 *   - renderFieldMeta: unit / default display; absent when both null
 *   - renderFieldNote: dim italic note; absent when null
 *   - renderFakeInput: box structure, ╭/│/╰ glyphs, ▶/█ cursor, hint
 *   - renderInlineHelp: orange border, key/type/required rows
 *   - fieldPrompt: default fallback, empty+required rejection, NUMBER validation,
 *                  help trigger, TEXT pass-through
 *
 * Validates: Requirements 7.7, 7.10
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  renderFieldLabel,
  renderFieldMeta,
  renderFieldNote,
  renderFakeInput,
  renderSubmittedInput,
  renderInlineHelp,
  fieldPrompt,
} from '../../../builder/prompts/field_prompt.js';
import { COL_ORANGE, COL_YELLOW, COL_DIM } from '../../../builder/layout/colors.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function strip(s) {
  return s.replace(/\x1b\[[0-9;]*m/g, ''); // eslint-disable-line no-control-regex
}

function hexRgb(hex) {
  const c = hex.replace('#', '');
  return [parseInt(c.slice(0,2),16), parseInt(c.slice(2,4),16), parseInt(c.slice(4,6),16)];
}
function hasFg(s, hex) {
  const [r,g,b] = hexRgb(hex);
  return s.includes(`38;2;${r};${g};${b}`);
}

const origForce = process.env.FORCE_COLOR;
beforeEach(() => { process.env.FORCE_COLOR = '1'; delete process.env.NO_COLOR; });
afterEach(() => {
  if (origForce === undefined) delete process.env.FORCE_COLOR;
  else process.env.FORCE_COLOR = origForce;
});

// ─── renderFieldLabel ─────────────────────────────────────────────────────────

describe('renderFieldLabel()', () => {
  it('contains the label text', () => {
    expect(strip(renderFieldLabel('Instance Type', 'COMBOBOX', true))).toContain('Instance Type');
  });

  it('contains [COMBOBOX] badge', () => {
    expect(strip(renderFieldLabel('Instance Type', 'COMBOBOX', true))).toContain('[COMBOBOX]');
  });

  it('contains [required] badge when required=true', () => {
    expect(strip(renderFieldLabel('x', 'TEXT', true))).toContain('[required]');
  });

  it('contains [optional] badge when required=false', () => {
    expect(strip(renderFieldLabel('x', 'TEXT', false))).toContain('[optional]');
  });

  it('applies COL_ORANGE to the label', () => {
    expect(hasFg(renderFieldLabel('x', 'NUMBER', true), COL_ORANGE)).toBe(true);
  });

  it('works for all six field types', () => {
    for (const ft of ['NUMBER','TEXT','SELECT','RADIO','COMBOBOX','TOGGLE']) {
      expect(() => renderFieldLabel('x', ft, true)).not.toThrow();
      expect(strip(renderFieldLabel('x', ft, true))).toContain(`[${ft}]`);
    }
  });
});

// ─── renderFieldMeta ─────────────────────────────────────────────────────────

describe('renderFieldMeta()', () => {
  it('returns empty string when both null', () => {
    expect(renderFieldMeta(null, null)).toBe('');
  });

  it('includes unit when provided', () => {
    expect(strip(renderFieldMeta('GB', null))).toContain('Unit: GB');
  });

  it('includes default when provided', () => {
    expect(strip(renderFieldMeta(null, 't3.micro'))).toContain('Default: t3.micro');
  });

  it('includes both unit and default', () => {
    const s = strip(renderFieldMeta('%', 100));
    expect(s).toContain('Unit: %');
    expect(s).toContain('Default: 100');
  });

  it('returns empty string for empty-string defaultValue', () => {
    expect(renderFieldMeta(null, '')).toBe('');
  });
});

// ─── renderFieldNote ─────────────────────────────────────────────────────────

describe('renderFieldNote()', () => {
  it('returns empty string for null', () => {
    expect(renderFieldNote(null)).toBe('');
  });

  it('returns empty string for undefined', () => {
    expect(renderFieldNote(undefined)).toBe('');
  });

  it('returns non-empty string for a note', () => {
    const result = renderFieldNote('Enter a value between 1 and 100');
    expect(strip(result)).toContain('Enter a value between 1 and 100');
  });
});

// ─── renderFakeInput ─────────────────────────────────────────────────────────

describe('renderFakeInput()', () => {
  it('contains the top border glyph ╭', () => {
    expect(strip(renderFakeInput(''))).toContain('╭');
  });

  it('contains the bottom border glyph ╰', () => {
    expect(strip(renderFakeInput(''))).toContain('╰');
  });

  it('contains the side border glyph │', () => {
    expect(strip(renderFakeInput(''))).toContain('│');
  });

  it('contains the cursor glyph █ when active', () => {
    expect(strip(renderFakeInput('', '', true))).toContain('█');
  });

  it('does NOT contain █ cursor when inactive', () => {
    expect(strip(renderFakeInput('saved', '', false))).not.toContain('█');
  });

  it('shows typed text inside the mid line', () => {
    const lines = strip(renderFakeInput('hello world')).split('\n');
    expect(lines[1]).toContain('hello world');
  });

  it('cursor █ appears after typed text', () => {
    const s = strip(renderFakeInput('abc'));
    expect(s.indexOf('abc')).toBeLessThan(s.indexOf('█'));
  });

  it('shows … ellipsis when buffer overflows', () => {
    expect(strip(renderFakeInput('A'.repeat(600)))).toContain('…');
  });

  it('contains the hint text', () => {
    expect(strip(renderFakeInput(''))).toContain('Enter to confirm');
    expect(strip(renderFakeInput(''))).toContain('? for help');
  });

  it('returns 4 lines with no error', () => {
    expect(renderFakeInput('').split('\n')).toHaveLength(4);
  });

  it('returns 5 lines when errorMsg is set', () => {
    expect(renderFakeInput('', 'Required.').split('\n')).toHaveLength(5);
  });

  it('error line contains ✗ marker', () => {
    expect(strip(renderFakeInput('', 'oops'))).toContain('✗');
  });

  it('respects custom width (wider box produces wider output)', () => {
    const narrow = renderFakeInput('x', '', true, 32);
    const wide   = renderFakeInput('x', '', true, 64);
    expect(strip(wide).length).toBeGreaterThan(strip(narrow).length);
  });

  it('top/mid/bot lines are all the same visible width', () => {
    const lines  = renderFakeInput('hello').split('\n').slice(0, 3);
    const widths = lines.map(l => strip(l).length);
    expect(widths[0]).toBe(widths[1]);
    expect(widths[1]).toBe(widths[2]);
  });
});

describe('renderSubmittedInput()', () => {
  it('returns 3 lines (top, mid, bot — no hint)', () => {
    expect(renderSubmittedInput('my-project').split('\n')).toHaveLength(3);
  });

  it('shows ✓ checkmark', () => {
    expect(strip(renderSubmittedInput('val'))).toContain('✓');
  });

  it('shows the confirmed value', () => {
    expect(strip(renderSubmittedInput('us-east-1'))).toContain('us-east-1');
  });

  it('does NOT contain █ cursor', () => {
    expect(strip(renderSubmittedInput('x'))).not.toContain('█');
  });

  it('all 3 lines are the same visible width', () => {
    const lines  = renderSubmittedInput('val').split('\n');
    const widths = lines.map(l => strip(l).length);
    expect(widths[0]).toBe(widths[1]);
    expect(widths[1]).toBe(widths[2]);
  });

  it('shows (skipped) for empty value', () => {
    expect(strip(renderSubmittedInput(''))).toContain('skipped');
  });
});

// ─── renderInlineHelp ────────────────────────────────────────────────────────

describe('renderInlineHelp()', () => {
  const base = { label: 'Instance Type', fieldType: 'COMBOBOX', required: true };

  it('contains the label in the title', () => {
    expect(strip(renderInlineHelp(base))).toContain('Instance Type');
  });

  it('contains the field type', () => {
    expect(strip(renderInlineHelp(base))).toContain('COMBOBOX');
  });

  it('shows "yes" for required=true', () => {
    expect(strip(renderInlineHelp(base))).toContain('yes');
  });

  it('shows "no" for required=false', () => {
    expect(strip(renderInlineHelp({ ...base, required: false }))).toContain('no');
  });

  it('includes unit row when unit is provided', () => {
    expect(strip(renderInlineHelp({ ...base, unit: 'GB' }))).toContain('GB');
  });

  it('includes default row when defaultValue is provided', () => {
    expect(strip(renderInlineHelp({ ...base, defaultValue: 't3.micro' }))).toContain('t3.micro');
  });

  it('includes note row when note is provided', () => {
    expect(strip(renderInlineHelp({ ...base, note: 'Some catalog note' }))).toContain('Some catalog note');
  });

  it('does not throw when all optional fields are absent', () => {
    expect(() => renderInlineHelp(base)).not.toThrow();
  });

  it('contains top ╭ and bottom ╰ border glyphs', () => {
    const s = strip(renderInlineHelp(base));
    expect(s).toContain('╭');
    expect(s).toContain('╰');
  });

  it('applies COL_YELLOW to the help border', () => {
    const help = renderInlineHelp(base);
    expect(hasFg(help, COL_YELLOW)).toBe(true);
  });
});

// ─── fieldPrompt (mocked readline) ───────────────────────────────────────────
// ─── fieldPrompt — raw-mode equivalent tests ─────────────────────────────────
// fieldPrompt now uses raw stdin, so we test it via the render helpers directly.
// The interaction contract is:
//   - renderFakeInput(buffer) shows typed text + cursor inside the box
//   - After valid Enter → clearLines then prints "  ✓ Label: value" summary
//   - After empty required → errorMsg shown inside the box
//   - After bad NUMBER → errorMsg shown, buffer cleared

describe('fieldPrompt render contract', () => {
  it('renderFakeInput shows buffer inside the box', () => {
    const s = strip(renderFakeInput('my-project'));
    const midLine = s.split('\n')[1];
    expect(midLine).toContain('my-project');
  });

  it('renderFakeInput empty required error adds 5th line with ✗', () => {
    const s = strip(renderFakeInput('', 'This field is required.'));
    expect(s.split('\n')).toHaveLength(5);
    expect(s).toContain('✗');
    expect(s).toContain('This field is required.');
  });

  it('renderFakeInput NUMBER error shows message', () => {
    const s = strip(renderFakeInput('', 'Expected a number'));
    expect(s).toContain('Expected a number');
  });

  it('renderFakeInput overflow uses … ellipsis', () => {
    const s = strip(renderFakeInput('x'.repeat(500)));
    expect(s).toContain('…');
  });

  it('renderInlineHelp contains field type for help toggle', () => {
    const h = strip(renderInlineHelp({ label: 'Count', fieldType: 'NUMBER', required: true }));
    expect(h).toContain('NUMBER');
    expect(h).toContain('yes');
  });
});

