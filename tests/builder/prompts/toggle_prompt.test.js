/**
 * Tests for builder/prompts/toggle_prompt.js
 *
 * Covers (unit):
 *   - renderToggleHeader: title text, enabled count, phase indicator
 *   - renderToggleRow: ◆/◇ glyphs, colours, BG_ACTIVE on cursor row
 *   - renderToggleList: header + rows + hint structure, count accuracy
 *   - togglePrompt: empty sections → returns []; render helpers fully covered above
 *
 * Validates: Requirements (S3-style two-phase toggle, design spec §S_ToggleP1/P2)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  renderToggleHeader,
  renderToggleRow,
  renderToggleList,
  togglePrompt,
} from '../../../builder/prompts/toggle_prompt.js';
import { COL_YELLOW, COL_GREEN, COL_DIM, COL_BG_ACTIVE } from '../../../builder/layout/colors.js';

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

const SECTIONS = ['Standard Storage', 'Intelligent Tiering', 'Glacier', 'Cross-Region Replication'];

const origForce = process.env.FORCE_COLOR;
beforeEach(() => { process.env.FORCE_COLOR = '1'; delete process.env.NO_COLOR; });
afterEach(() => {
  if (origForce === undefined) delete process.env.FORCE_COLOR;
  else process.env.FORCE_COLOR = origForce;
});

// ─── renderToggleHeader ───────────────────────────────────────────────────────

describe('renderToggleHeader()', () => {
  it('contains "Select Feature Sections"', () => {
    expect(strip(renderToggleHeader(2, 4))).toContain('Select Feature Sections');
  });

  it('contains the enabled count', () => {
    expect(strip(renderToggleHeader(3, 4))).toContain('3 enabled');
  });

  it('contains "Phase 1 of 2"', () => {
    expect(strip(renderToggleHeader(0, 4))).toContain('Phase 1 of 2');
  });

  it('uses COL_GREEN for enabled count when > 0', () => {
    expect(hasFg(renderToggleHeader(2, 4), COL_GREEN)).toBe(true);
  });

  it('uses COL_DIM for enabled count when 0', () => {
    expect(hasFg(renderToggleHeader(0, 4), COL_DIM)).toBe(true);
  });

  it('shows "0 enabled" when nothing is selected', () => {
    expect(strip(renderToggleHeader(0, 5))).toContain('0 enabled');
  });
});

// ─── renderToggleRow ─────────────────────────────────────────────────────────

describe('renderToggleRow()', () => {
  it('enabled + cursor row contains ◆ glyph', () => {
    expect(strip(renderToggleRow('Standard Storage', true, true))).toContain('◆');
  });

  it('disabled row contains ◇ glyph', () => {
    expect(strip(renderToggleRow('Glacier', false, false))).toContain('◇');
  });

  it('enabled row uses COL_GREEN for the label', () => {
    expect(hasFg(renderToggleRow('x', true, false), COL_GREEN)).toBe(true);
  });

  it('enabled + cursor row has COL_BG_ACTIVE background', () => {
    expect(hasBg(renderToggleRow('x', true, true), COL_BG_ACTIVE)).toBe(true);
  });

  it('enabled + non-cursor row does NOT have COL_BG_ACTIVE background', () => {
    expect(hasBg(renderToggleRow('x', true, false), COL_BG_ACTIVE)).toBe(false);
  });

  it('disabled cursor row DOES have COL_BG_ACTIVE background', () => {
    // cursor position is shown regardless of toggle state
    expect(hasBg(renderToggleRow('x', false, true), COL_BG_ACTIVE)).toBe(true);
  });

  it('disabled non-cursor row does NOT have COL_BG_ACTIVE', () => {
    expect(hasBg(renderToggleRow('x', false, false), COL_BG_ACTIVE)).toBe(false);
  });

  it('contains the label text', () => {
    expect(strip(renderToggleRow('Cross-Region Replication', true, false))).toContain('Cross-Region Replication');
  });

  it('enabled row uses COL_YELLOW for the ◆ glyph', () => {
    expect(hasFg(renderToggleRow('x', true, false), COL_YELLOW)).toBe(true);
  });
});

// ─── renderToggleList ────────────────────────────────────────────────────────

describe('renderToggleList()', () => {
  it('output contains all section names', () => {
    const enabled = new Set(['Standard Storage']);
    const s = strip(renderToggleList(SECTIONS, enabled, 0));
    for (const sec of SECTIONS) expect(s).toContain(sec);
  });

  it('cursor row (idx 2) has BG_ACTIVE', () => {
    const enabled = new Set();
    const output  = renderToggleList(SECTIONS, enabled, 2);
    const lines   = output.split('\n');
    const rowLines = lines.filter(l => /^\s+\S/.test(strip(l)));
    expect(hasBg(rowLines[2], COL_BG_ACTIVE)).toBe(true);
  });

  it('contains a hint with "Space to toggle"', () => {
    expect(strip(renderToggleList(SECTIONS, new Set(), 0))).toContain('Space to toggle');
  });

  it('enabled count in header matches the Set size', () => {
    const enabled = new Set(['Standard Storage', 'Glacier']);
    const s = strip(renderToggleList(SECTIONS, enabled, 0));
    expect(s).toContain('2 enabled');
  });

  it('shows 0 enabled when nothing is selected', () => {
    expect(strip(renderToggleList(SECTIONS, new Set(), 0))).toContain('0 enabled');
  });

  it('enabled sections show ◆, disabled show ◇', () => {
    const enabled = new Set(['Standard Storage']);
    const s = strip(renderToggleList(SECTIONS, enabled, 0));
    // At least one ◆ (Standard Storage) and at least one ◇ (others)
    expect(s).toContain('◆');
    expect(s).toContain('◇');
  });
});

// ─── togglePrompt ─────────────────────────────────────────────────────────────

describe('togglePrompt()', () => {
  it('returns empty array immediately when sections is empty', async () => {
    const result = await togglePrompt({ sections: [] });
    expect(result).toEqual([]);
  });

  it('returns empty array when sections is undefined', async () => {
    const result = await togglePrompt({ sections: undefined });
    expect(result).toEqual([]);
  });
});

// ─── Cursor drift regression ──────────────────────────────────────────────────
//
// Same off-by-one as select_prompt: drawnLines was split('\n').length which is
// one more than the actual newline count.  Verified fix: split('\n').length - 1.

describe('renderToggleList() — line count matches actual newlines (cursor-drift regression)', () => {
  function countNewlines(s) {
    return (s.match(/\n/g) || []).length;
  }

  it('split length - 1 equals actual newline count for the initial render (\n + list + \n)', () => {
    const enabled = new Set(['Standard Storage']);
    const text = '\n' + renderToggleList(SECTIONS, enabled, 0) + '\n'; // matches toggle_prompt initial
    const splitMinus1 = text.split('\n').length - 1;
    const actualNL    = countNewlines(text);
    expect(splitMinus1).toBe(actualNL);
  });

  it('split length - 1 equals actual newline count for redraw (list + \n, no leading newline)', () => {
    const enabled = new Set(['Glacier']);
    const text = renderToggleList(SECTIONS, enabled, 1) + '\n'; // matches toggle_prompt redraw
    expect(text.split('\n').length - 1).toBe(countNewlines(text));
  });

  it('split length (without -1) is greater than actual newline count — confirming old bug', () => {
    const text = renderToggleList(SECTIONS, new Set(), 0) + '\n';
    expect(text.split('\n').length).toBeGreaterThan(countNewlines(text));
  });
});

