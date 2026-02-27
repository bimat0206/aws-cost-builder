/**
 * Tests for builder/prompts/compound_input.js
 *
 * Covers (unit):
 *   - parseCompoundInput: all three accepted formats, case-insensitive unit
 *     matching, trailing suffix stripping, error codes, missing value, invalid
 *     number, unknown unit, no-default-unit fallback
 *   - splitCompoundResult: exactly two dimension objects, correct keys/values
 *   - renderCompoundInfo: box structure, accepted units visible, default unit
 *   - compoundInputPrompt: re-prompts on empty, re-prompts on bad unit, resolves
 *     on valid input (mocked readline)
 *
 * Property P12: Compound Input Parsing
 *   For any compound string of the form "<number>", "<number> <unit>", or
 *   "<number> <unit> per month", the parser must extract numeric value and unit
 *   correctly.  When unit is omitted, unit_sibling's default_value is applied.
 *
 * Property P13: Compound Input Produces Two Dimension Objects
 *   For any dimension with a unit_sibling, splitCompoundResult must always
 *   produce exactly two Dimension objects.
 *
 * Validates: Requirements 8.1, 8.2, 8.3, 8.4, 8.5
 */

// Feature: aws-cost-profile-builder, Property 12: Compound Input Parsing
// Feature: aws-cost-profile-builder, Property 13: Compound Input Produces Two Dimension Objects

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fc from 'fast-check';
import {
  parseCompoundInput,
  splitCompoundResult,
  renderCompoundInfo,
  compoundInputPrompt,
  CompoundInputError,
} from '../../../builder/prompts/compound_input.js';
import { COL_YELLOW, COL_SECTION } from '../../../builder/layout/colors.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function strip(s) {
  return s.replace(/\x1b\[[0-9;]*m/g, ''); // eslint-disable-line no-control-regex
}

function makeRl(answers) {
  const queue = [...answers];
  return {
    question(_p, cb) { setImmediate(() => cb(queue.shift() ?? '')); },
    close() {},
  };
}

const origForce = process.env.FORCE_COLOR;
beforeEach(() => { process.env.FORCE_COLOR = '1'; delete process.env.NO_COLOR; });
afterEach(() => {
  if (origForce === undefined) delete process.env.FORCE_COLOR;
  else process.env.FORCE_COLOR = origForce;
  vi.restoreAllMocks();
});

const UNITS = ['GB', 'TB'];
const DEFAULT_UNIT = 'GB';

// ─── parseCompoundInput — unit tests ─────────────────────────────────────────

describe('parseCompoundInput() — valid inputs', () => {
  it('bare number uses defaultUnit', () => {
    const r = parseCompoundInput('500', UNITS, DEFAULT_UNIT);
    expect(r).toEqual({ value: '500', unit: 'GB' });
  });

  it('"<number> <unit>" extracts both', () => {
    const r = parseCompoundInput('500 GB', UNITS, DEFAULT_UNIT);
    expect(r).toEqual({ value: '500', unit: 'GB' });
  });

  it('"<number> <unit> per month" strips suffix', () => {
    const r = parseCompoundInput('500 GB per month', UNITS, DEFAULT_UNIT);
    expect(r).toEqual({ value: '500', unit: 'GB' });
  });

  it('"<number> <unit> per year" strips suffix', () => {
    const r = parseCompoundInput('2 TB per year', UNITS, DEFAULT_UNIT);
    expect(r).toEqual({ value: '2', unit: 'TB' });
  });

  it('"<number> <unit> / month" strips slash-month suffix', () => {
    const r = parseCompoundInput('100 GB / month', UNITS, DEFAULT_UNIT);
    expect(r).toEqual({ value: '100', unit: 'GB' });
  });

  it('unit matching is case-insensitive and normalises to acceptedUnits casing', () => {
    const r = parseCompoundInput('10 gb', UNITS, DEFAULT_UNIT);
    expect(r.unit).toBe('GB');
  });

  it('TB unit is accepted and returned as-is', () => {
    const r = parseCompoundInput('1 TB', UNITS, DEFAULT_UNIT);
    expect(r.unit).toBe('TB');
  });

  it('decimal numbers are accepted', () => {
    const r = parseCompoundInput('0.5 GB', UNITS, DEFAULT_UNIT);
    expect(r.value).toBe('0.5');
    expect(r.unit).toBe('GB');
  });

  it('zero is a valid number', () => {
    const r = parseCompoundInput('0', UNITS, DEFAULT_UNIT);
    expect(r.value).toBe('0');
    expect(r.unit).toBe(DEFAULT_UNIT);
  });

  it('large numbers are accepted', () => {
    const r = parseCompoundInput('999999 TB', UNITS, DEFAULT_UNIT);
    expect(r.value).toBe('999999');
    expect(r.unit).toBe('TB');
  });
});

describe('parseCompoundInput() — error cases', () => {
  it('throws CompoundInputError with MISSING_VALUE on empty string', () => {
    expect(() => parseCompoundInput('', UNITS, DEFAULT_UNIT))
      .toThrow(CompoundInputError);
    try { parseCompoundInput('', UNITS, DEFAULT_UNIT); }
    catch (e) { expect(e.code).toBe('MISSING_VALUE'); }
  });

  it('throws CompoundInputError with MISSING_VALUE on whitespace-only', () => {
    expect(() => parseCompoundInput('   ', UNITS, DEFAULT_UNIT))
      .toThrow(CompoundInputError);
  });

  it('throws CompoundInputError with INVALID_NUMBER for non-numeric value', () => {
    expect(() => parseCompoundInput('abc GB', UNITS, DEFAULT_UNIT))
      .toThrow(CompoundInputError);
    try { parseCompoundInput('abc GB', UNITS, DEFAULT_UNIT); }
    catch (e) { expect(e.code).toBe('INVALID_NUMBER'); }
  });

  it('throws CompoundInputError with UNKNOWN_UNIT for unrecognised unit', () => {
    expect(() => parseCompoundInput('500 MB', UNITS, DEFAULT_UNIT))
      .toThrow(CompoundInputError);
    try { parseCompoundInput('500 MB', UNITS, DEFAULT_UNIT); }
    catch (e) { expect(e.code).toBe('UNKNOWN_UNIT'); }
  });

  it('throws UNKNOWN_UNIT when no unit provided and no defaultUnit', () => {
    expect(() => parseCompoundInput('500', UNITS, null))
      .toThrow(CompoundInputError);
    try { parseCompoundInput('500', UNITS, null); }
    catch (e) { expect(e.code).toBe('UNKNOWN_UNIT'); }
  });

  it('throws MISSING_VALUE for non-string input', () => {
    expect(() => parseCompoundInput(null, UNITS, DEFAULT_UNIT))
      .toThrow(CompoundInputError);
  });

  it('error message lists accepted units on UNKNOWN_UNIT', () => {
    try { parseCompoundInput('500 MB', UNITS, DEFAULT_UNIT); }
    catch (e) {
      expect(e.message).toContain('GB');
      expect(e.message).toContain('TB');
    }
  });
});

// ─── splitCompoundResult — unit tests ────────────────────────────────────────

describe('splitCompoundResult()', () => {
  it('returns exactly two elements', () => {
    const result = splitCompoundResult(
      'EBS Storage', 'EBS Storage Unit',
      { value: '30', unit: 'GB' },
    );
    expect(result).toHaveLength(2);
  });

  it('first element has the value key and user_value = the numeric value', () => {
    const [valueDim] = splitCompoundResult(
      'EBS Storage', 'EBS Storage Unit',
      { value: '30', unit: 'GB' },
    );
    expect(valueDim.key).toBe('EBS Storage');
    expect(valueDim.user_value).toBe('30');
  });

  it('second element has the unit key and user_value = the unit string', () => {
    const [, unitDim] = splitCompoundResult(
      'EBS Storage', 'EBS Storage Unit',
      { value: '30', unit: 'GB' },
    );
    expect(unitDim.key).toBe('EBS Storage Unit');
    expect(unitDim.user_value).toBe('GB');
  });

  it('both elements have a "key" and "user_value" property', () => {
    const dims = splitCompoundResult('A', 'B', { value: '1', unit: 'GB' });
    for (const d of dims) {
      expect(d).toHaveProperty('key');
      expect(d).toHaveProperty('user_value');
    }
  });

  it('works with TB unit', () => {
    const [v, u] = splitCompoundResult('Storage', 'Storage Unit', { value: '2', unit: 'TB' });
    expect(v.user_value).toBe('2');
    expect(u.user_value).toBe('TB');
  });
});

// ─── renderCompoundInfo — unit tests ─────────────────────────────────────────

describe('renderCompoundInfo()', () => {
  it('contains the label text', () => {
    expect(strip(renderCompoundInfo('EBS Storage', UNITS, DEFAULT_UNIT))).toContain('EBS Storage');
  });

  it('lists the accepted units', () => {
    const s = strip(renderCompoundInfo('x', UNITS, DEFAULT_UNIT));
    expect(s).toContain('GB');
    expect(s).toContain('TB');
  });

  it('shows the default unit when provided', () => {
    expect(strip(renderCompoundInfo('x', UNITS, 'GB'))).toContain('GB');
  });

  it('does not throw when defaultUnit is null', () => {
    expect(() => renderCompoundInfo('x', UNITS, null)).not.toThrow();
  });

  it('has top ╭ and bottom ╰ box glyphs', () => {
    const s = strip(renderCompoundInfo('x', UNITS, DEFAULT_UNIT));
    expect(s).toContain('╭');
    expect(s).toContain('╰');
  });

  it('contains example numbers', () => {
    const s = strip(renderCompoundInfo('x', UNITS, DEFAULT_UNIT));
    expect(s).toContain('500');
  });
});

// ─── compoundInputPrompt — mocked readline ────────────────────────────────────

describe('compoundInputPrompt()', () => {
  let stdoutData;

  beforeEach(() => {
    stdoutData = '';
    vi.spyOn(process.stdout, 'write').mockImplementation((s) => {
      stdoutData += s; return true;
    });
  });

  it('resolves with { value, unit } on valid "500 GB" input', async () => {
    const rl = makeRl(['500 GB']);
    const result = await compoundInputPrompt({ label: 'Storage', acceptedUnits: UNITS, defaultUnit: DEFAULT_UNIT, rl });
    expect(result).toEqual({ value: '500', unit: 'GB' });
  });

  it('resolves with defaultUnit applied when only number entered', async () => {
    const rl = makeRl(['200']);
    const result = await compoundInputPrompt({ label: 'Storage', acceptedUnits: UNITS, defaultUnit: 'TB', rl });
    expect(result.unit).toBe('TB');
    expect(result.value).toBe('200');
  });

  it('reprompts on empty input, then accepts valid input', async () => {
    const rl = makeRl(['', '10 GB']);
    const result = await compoundInputPrompt({ label: 'x', acceptedUnits: UNITS, defaultUnit: DEFAULT_UNIT, rl });
    expect(result).toEqual({ value: '10', unit: 'GB' });
    expect(stdoutData).toContain('Please enter');
  });

  it('reprompts on unknown unit, then accepts valid input', async () => {
    const rl = makeRl(['500 MB', '500 GB']);
    const result = await compoundInputPrompt({ label: 'x', acceptedUnits: UNITS, defaultUnit: DEFAULT_UNIT, rl });
    expect(result.unit).toBe('GB');
    expect(stdoutData).toContain('Unknown unit');
  });

  it('reprompts on invalid number, then accepts valid input', async () => {
    const rl = makeRl(['abc GB', '5 GB']);
    const result = await compoundInputPrompt({ label: 'x', acceptedUnits: UNITS, defaultUnit: DEFAULT_UNIT, rl });
    expect(result.value).toBe('5');
  });

  it('prints the compound info box to stdout', async () => {
    const rl = makeRl(['1 GB']);
    await compoundInputPrompt({ label: 'EBS Storage', acceptedUnits: UNITS, defaultUnit: DEFAULT_UNIT, rl });
    expect(stdoutData).toContain('EBS Storage');
  });
});

// ─── Property P12: Compound Input Parsing ────────────────────────────────────

describe('Property 12: Compound Input Parsing', () => {
  // Feature: aws-cost-profile-builder, Property 12: Compound Input Parsing
  // Validates: Requirements 8.2, 8.3

  const arbUnit  = fc.constantFrom(...UNITS);
  const arbValue = fc.float({ min: 0, max: 9999, noNaN: true, noDefaultInfinity: true })
    .map(v => String(Math.round(v * 100) / 100));  // up to 2dp, no scientific notation

  it('format "<number>" → value preserved, defaultUnit applied', () => {
    fc.assert(
      fc.property(arbValue, (v) => {
        const r = parseCompoundInput(v, UNITS, DEFAULT_UNIT);
        expect(r.value).toBe(v);
        expect(r.unit).toBe(DEFAULT_UNIT);
      }),
      { numRuns: 25 },
    );
  });

  it('format "<number> <unit>" → both extracted correctly', () => {
    fc.assert(
      fc.property(arbValue, arbUnit, (v, u) => {
        const r = parseCompoundInput(`${v} ${u}`, UNITS, DEFAULT_UNIT);
        expect(r.value).toBe(v);
        expect(r.unit).toBe(u);
      }),
      { numRuns: 25 },
    );
  });

  it('format "<number> <unit> per month" → suffix stripped, value+unit correct', () => {
    fc.assert(
      fc.property(arbValue, arbUnit, (v, u) => {
        const r = parseCompoundInput(`${v} ${u} per month`, UNITS, DEFAULT_UNIT);
        expect(r.value).toBe(v);
        expect(r.unit).toBe(u);
      }),
      { numRuns: 25 },
    );
  });

  it('case-insensitive unit matching always normalises to acceptedUnits casing', () => {
    fc.assert(
      fc.property(
        arbValue,
        fc.constantFrom('gb', 'GB', 'Gb', 'gB'),
        (v, uVariant) => {
          const r = parseCompoundInput(`${v} ${uVariant}`, UNITS, DEFAULT_UNIT);
          expect(UNITS).toContain(r.unit);
        },
      ),
      { numRuns: 25 },
    );
  });

  it('omitting unit always uses defaultUnit when defaultUnit is set', () => {
    fc.assert(
      fc.property(arbValue, fc.constantFrom(...UNITS), (v, defUnit) => {
        const r = parseCompoundInput(v, UNITS, defUnit);
        expect(r.unit).toBe(defUnit);
      }),
      { numRuns: 25 },
    );
  });

  it('unknown unit always throws CompoundInputError with UNKNOWN_UNIT', () => {
    const arbBadUnit = fc.stringMatching(/^[A-Z]{2,4}$/)
      .filter(u => !UNITS.map(x => x.toLowerCase()).includes(u.toLowerCase()));

    fc.assert(
      fc.property(arbValue, arbBadUnit, (v, u) => {
        expect(() => parseCompoundInput(`${v} ${u}`, UNITS, DEFAULT_UNIT))
          .toThrow(CompoundInputError);
        try {
          parseCompoundInput(`${v} ${u}`, UNITS, DEFAULT_UNIT);
        } catch (e) {
          expect(e.code).toBe('UNKNOWN_UNIT');
        }
      }),
      { numRuns: 25 },
    );
  });
});

// ─── Property P13: Compound Input Produces Two Dimension Objects ──────────────

describe('Property 13: Compound Input Produces Two Dimension Objects', () => {
  // Feature: aws-cost-profile-builder, Property 13: Compound Input Produces Two Dimension Objects
  // Validates: Requirements 8.5

  const arbKey      = fc.stringMatching(/^[a-zA-Z][a-zA-Z0-9 ]{1,20}$/);
  const arbValue    = fc.integer({ min: 0, max: 9999 }).map(String);
  const arbUnit     = fc.constantFrom(...UNITS);

  it('splitCompoundResult always returns exactly 2 elements', () => {
    fc.assert(
      fc.property(arbKey, arbKey, arbValue, arbUnit, (vKey, uKey, v, u) => {
        const result = splitCompoundResult(vKey, uKey, { value: v, unit: u });
        expect(result).toHaveLength(2);
      }),
      { numRuns: 25 },
    );
  });

  it('first element always carries the value key and numeric user_value', () => {
    fc.assert(
      fc.property(arbKey, arbKey, arbValue, arbUnit, (vKey, uKey, v, u) => {
        const [dim0] = splitCompoundResult(vKey, uKey, { value: v, unit: u });
        expect(dim0.key).toBe(vKey);
        expect(dim0.user_value).toBe(v);
      }),
      { numRuns: 25 },
    );
  });

  it('second element always carries the unit key and unit user_value', () => {
    fc.assert(
      fc.property(arbKey, arbKey, arbValue, arbUnit, (vKey, uKey, v, u) => {
        const [, dim1] = splitCompoundResult(vKey, uKey, { value: v, unit: u });
        expect(dim1.key).toBe(uKey);
        expect(dim1.user_value).toBe(u);
      }),
      { numRuns: 25 },
    );
  });

  it('both elements always have "key" and "user_value" properties', () => {
    fc.assert(
      fc.property(arbKey, arbKey, arbValue, arbUnit, (vKey, uKey, v, u) => {
        const dims = splitCompoundResult(vKey, uKey, { value: v, unit: u });
        for (const d of dims) {
          expect(Object.prototype.hasOwnProperty.call(d, 'key')).toBe(true);
          expect(Object.prototype.hasOwnProperty.call(d, 'user_value')).toBe(true);
        }
      }),
      { numRuns: 25 },
    );
  });

  it('round-trip: parse then split produces correct dimension pair', () => {
    fc.assert(
      fc.property(
        arbKey, arbKey,
        fc.integer({ min: 1, max: 9999 }).map(String),
        arbUnit,
        (vKey, uKey, numStr, u) => {
          const parsed = parseCompoundInput(`${numStr} ${u}`, UNITS, DEFAULT_UNIT);
          const [d0, d1] = splitCompoundResult(vKey, uKey, parsed);
          expect(d0.user_value).toBe(numStr);
          expect(d1.user_value).toBe(u);
          expect(d0.key).toBe(vKey);
          expect(d1.key).toBe(uKey);
        },
      ),
      { numRuns: 25 },
    );
  });
});
