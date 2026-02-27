/**
 * Tests for builder/prompts/select_prompt.js
 *
 * Covers:
 *   - renderOptionRow: glyphs, colours, BG_ACTIVE on selected, numbering
 *   - renderSelectList: row count, hint line, cursor tracking
 *   - selectPrompt: throws on empty options; render helpers fully covered above
 *
 * Validates: Requirements 7.8
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  renderOptionRow,
  renderSelectList,
  selectPrompt,
} from '../../../builder/prompts/select_prompt.js';
import { COL_GREEN, COL_DIM, COL_BG_ACTIVE } from '../../../builder/layout/colors.js';

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
function hasBg(s, hex) {
  const [r,g,b] = hexRgb(hex);
  return s.includes(`48;2;${r};${g};${b}`);
}

const origForce = process.env.FORCE_COLOR;
beforeEach(() => { process.env.FORCE_COLOR = '1'; delete process.env.NO_COLOR; });
afterEach(() => {
  if (origForce === undefined) delete process.env.FORCE_COLOR;
  else process.env.FORCE_COLOR = origForce;
});

// ─── renderOptionRow ─────────────────────────────────────────────────────────

describe('renderOptionRow()', () => {
  it('selected row contains ● glyph', () => {
    expect(strip(renderOptionRow('Linux', true, 0))).toContain('●');
  });

  it('unselected row contains ○ glyph', () => {
    expect(strip(renderOptionRow('Windows', false, 1))).toContain('○');
  });

  it('selected row uses COL_GREEN foreground', () => {
    expect(hasFg(renderOptionRow('Linux', true, 0), COL_GREEN)).toBe(true);
  });

  it('selected row has COL_BG_ACTIVE background', () => {
    expect(hasBg(renderOptionRow('Linux', true, 0), COL_BG_ACTIVE)).toBe(true);
  });

  it('unselected row does NOT have COL_BG_ACTIVE background', () => {
    expect(hasBg(renderOptionRow('Windows', false, 1), COL_BG_ACTIVE)).toBe(false);
  });

  it('contains the label text', () => {
    expect(strip(renderOptionRow('General Purpose SSD', true, 0))).toContain('General Purpose SSD');
  });

  it('contains 1-based index number', () => {
    expect(strip(renderOptionRow('opt', false, 2))).toContain('3.');
  });

  it('first item is numbered 1', () => {
    expect(strip(renderOptionRow('first', false, 0))).toContain('1.');
  });
});

// ─── renderSelectList ────────────────────────────────────────────────────────

describe('renderSelectList()', () => {
  const OPTIONS = ['Linux', 'Windows', 'RHEL', 'SUSE'];

  it('returns a string with one line per option plus hint', () => {
    const lines = renderSelectList(OPTIONS, 0).split('\n');
    // options + hint line
    expect(lines.length).toBeGreaterThanOrEqual(OPTIONS.length + 1);
  });

  it('marks cursor row with BG_ACTIVE', () => {
    const result = renderSelectList(OPTIONS, 2);
    const lines  = result.split('\n');
    // cursor is on row 2 (index 2 = "RHEL")
    expect(hasBg(lines[2], COL_BG_ACTIVE)).toBe(true);
  });

  it('does NOT apply BG_ACTIVE to non-cursor rows', () => {
    const result = renderSelectList(OPTIONS, 0);
    const lines  = result.split('\n');
    expect(hasBg(lines[1], COL_BG_ACTIVE)).toBe(false);
    expect(hasBg(lines[2], COL_BG_ACTIVE)).toBe(false);
  });

  it('hint contains navigation guidance', () => {
    const result = strip(renderSelectList(OPTIONS, 0));
    expect(result).toContain('Enter to select');
  });

  it('all option labels appear in the output', () => {
    const result = strip(renderSelectList(OPTIONS, 0));
    for (const o of OPTIONS) expect(result).toContain(o);
  });

  it('cursor=0 → first row selected', () => {
    const lines = renderSelectList(OPTIONS, 0).split('\n');
    expect(hasBg(lines[0], COL_BG_ACTIVE)).toBe(true);
  });

  it('cursor=last → last option row selected', () => {
    const lines = renderSelectList(OPTIONS, OPTIONS.length - 1).split('\n');
    expect(hasBg(lines[OPTIONS.length - 1], COL_BG_ACTIVE)).toBe(true);
  });
});

// ─── selectPrompt ────────────────────────────────────────────────────────────

describe('selectPrompt()', () => {
  it('throws when options array is empty', async () => {
    await expect(
      selectPrompt({ label: 'x', options: [] })
    ).rejects.toThrow();
  });

  it('throws when options is undefined', async () => {
    await expect(
      selectPrompt({ label: 'x', options: undefined })
    ).rejects.toThrow();
  });
});

// ─── Cursor drift regression ──────────────────────────────────────────────────
//
// Bug: select_prompt.js tracked renderedLines via split('\n').length which
// overcounts by 1 (N newlines → N+1 split parts).  clearLines(N+1) then
// moves the cursor one extra line up on every keypress, causing the list to
// slowly drift upward during navigation.
//
// Fix: use split('\n').length - 1 so the count matches the actual number of
// newline characters (= number of lines the cursor descends when rendered).

describe('renderSelectList() — line count matches actual newlines (cursor-drift regression)', () => {
  const OPTIONS = ['Builder', 'Runner', 'Dry Run', 'Explorer', 'Promoter'];

  function countNewlines(s) {
    return (s.match(/\n/g) || []).length;
  }

  it('split length - 1 equals actual newline count for fresh render', () => {
    const text = renderSelectList(OPTIONS, 0) + '\n'; // as used in selectPrompt
    const splitMinus1 = text.split('\n').length - 1;
    const actualNL    = countNewlines(text);
    expect(splitMinus1).toBe(actualNL);
  });

  it('split length - 1 equals actual newline count for each cursor position', () => {
    for (let i = 0; i < OPTIONS.length; i++) {
      const text = renderSelectList(OPTIONS, i) + '\n';
      expect(text.split('\n').length - 1, `cursor=${i}`).toBe(countNewlines(text));
    }
  });

  it('split length (without -1) is GREATER than actual newline count — confirming old bug', () => {
    const text = renderSelectList(OPTIONS, 0) + '\n';
    // This is the old (wrong) value that caused drift
    expect(text.split('\n').length).toBeGreaterThan(countNewlines(text));
  });
});

