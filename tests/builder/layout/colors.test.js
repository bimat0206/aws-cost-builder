/**
 * Tests for builder/layout/colors.js
 *
 * Verifies that all required colour constants and layout constants are
 * exported with their exact design-specified values, and that
 * FIELD_TYPE_COLORS maps every field_type to a known colour.
 *
 * Validates: Requirements 7.1
 */

import { describe, it, expect } from 'vitest';
import {
  // Background
  COL_BG, COL_BG_TERM, COL_BG_PANEL, COL_BG_ACTIVE, COL_BG_ROW,
  // Border
  COL_BORDER, COL_YAML, COL_PROMPT, COL_SECTION,
  COL_GREEN_BORDER, COL_RED_BORDER,
  // Text
  COL_DIM, COL_MUTED, COL_BASE,
  // Accent
  COL_CYAN, COL_GREEN, COL_ORANGE, COL_YELLOW, COL_MAGENTA, COL_BLUE,
  // Layout
  MIN_SPLIT_WIDTH, YAML_PANEL_WIDTH,
  // Map
  FIELD_TYPE_COLORS,
} from '../../../builder/layout/colors.js';

// ─── Hex format guard ─────────────────────────────────────────────────────────

function isHex(val) {
  return typeof val === 'string' && /^#[0-9a-fA-F]{6}$/.test(val);
}

describe('colors.js — all exports exist and have correct values', () => {
  it.each([
    ['COL_BG',           COL_BG,           '#1e2127'],
    ['COL_BG_TERM',      COL_BG_TERM,      '#1e2127'],
    ['COL_BG_PANEL',     COL_BG_PANEL,     '#21252b'],
    ['COL_BG_ACTIVE',    COL_BG_ACTIVE,    '#2c313c'],
    ['COL_BG_ROW',       COL_BG_ROW,       '#252a33'],
    ['COL_BORDER',       COL_BORDER,       '#3e4451'],
    ['COL_YAML',         COL_YAML,         '#56b6c2'],
    ['COL_PROMPT',       COL_PROMPT,       '#c678dd'],
    ['COL_SECTION',      COL_SECTION,      '#e5c07b'],
    ['COL_GREEN_BORDER', COL_GREEN_BORDER, '#98c379'],
    ['COL_RED_BORDER',   COL_RED_BORDER,   '#e06c75'],
    ['COL_DIM',          COL_DIM,          '#5c6370'],
    ['COL_MUTED',        COL_MUTED,        '#abb2bf'],
    ['COL_BASE',         COL_BASE,         '#dcdfe4'],
    ['COL_CYAN',         COL_CYAN,         '#56b6c2'],
    ['COL_GREEN',        COL_GREEN,        '#98c379'],
    ['COL_ORANGE',       COL_ORANGE,       '#e06c75'],
    ['COL_YELLOW',       COL_YELLOW,       '#e5c07b'],
    ['COL_MAGENTA',      COL_MAGENTA,      '#c678dd'],
    ['COL_BLUE',         COL_BLUE,         '#61afef'],
  ])('%s === %s', (_name, actual, expected) => {
    expect(actual).toBe(expected);
  });

  it('MIN_SPLIT_WIDTH is 120', () => {
    expect(MIN_SPLIT_WIDTH).toBe(120);
  });

  it('YAML_PANEL_WIDTH is 62', () => {
    expect(YAML_PANEL_WIDTH).toBe(62);
  });

  it('every value is a valid #rrggbb hex string', () => {
    const tokens = [
      COL_BG, COL_BG_TERM, COL_BG_PANEL, COL_BG_ACTIVE, COL_BG_ROW,
      COL_BORDER, COL_YAML, COL_PROMPT, COL_SECTION,
      COL_GREEN_BORDER, COL_RED_BORDER,
      COL_DIM, COL_MUTED, COL_BASE,
      COL_CYAN, COL_GREEN, COL_ORANGE, COL_YELLOW, COL_MAGENTA, COL_BLUE,
    ];
    for (const token of tokens) {
      expect(isHex(token), `"${token}" should be a valid #rrggbb hex string`).toBe(true);
    }
  });
});

describe('FIELD_TYPE_COLORS', () => {
  it('maps all six field types', () => {
    const types = ['NUMBER', 'TEXT', 'SELECT', 'RADIO', 'COMBOBOX', 'TOGGLE'];
    for (const t of types) {
      expect(FIELD_TYPE_COLORS).toHaveProperty(t);
      expect(isHex(FIELD_TYPE_COLORS[t])).toBe(true);
    }
  });

  it('NUMBER and TEXT use COL_CYAN', () => {
    expect(FIELD_TYPE_COLORS.NUMBER).toBe(COL_CYAN);
    expect(FIELD_TYPE_COLORS.TEXT).toBe(COL_CYAN);
  });

  it('SELECT and RADIO use COL_YELLOW', () => {
    expect(FIELD_TYPE_COLORS.SELECT).toBe(COL_YELLOW);
    expect(FIELD_TYPE_COLORS.RADIO).toBe(COL_YELLOW);
  });

  it('COMBOBOX uses COL_MAGENTA', () => {
    expect(FIELD_TYPE_COLORS.COMBOBOX).toBe(COL_MAGENTA);
  });

  it('TOGGLE uses COL_GREEN', () => {
    expect(FIELD_TYPE_COLORS.TOGGLE).toBe(COL_GREEN);
  });
});
