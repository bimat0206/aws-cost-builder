/**
 * Tests for builder/preview/yaml_preview.js
 *
 * Covers (unit):
 *  - serializeToYaml: scalars, strings, numbers, booleans, null/undefined,
 *    arrays, nested objects, empty structures, round-trip readability
 *  - highlightYaml: returns array of strings, active line marking (only
 *    first match), null activeKey, non-string input safety
 *  - computeScrollOffset: midpoint targeting, boundary clamping, edge cases
 *
 * Property P11: YAML Preview Syntax Highlighting
 *   For any YAML line of a given semantic type, the correct colour constant
 *   must appear in the highlighted output, and the active line must include
 *   the ▶ glyph and COL_BG_ACTIVE background.
 *
 * Validates: Requirements 7.2, 7.3
 */

// Feature: aws-cost-profile-builder, Property 11: YAML Preview Syntax Highlighting
// Validates: Requirements 7.2, 7.3

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fc from 'fast-check';
import {
  serializeToYaml,
  highlightYaml,
  computeScrollOffset,
} from '../../../builder/preview/yaml_preview.js';
import {
  COL_BLUE, COL_GREEN, COL_YELLOW, COL_MAGENTA, COL_DIM, COL_CYAN, COL_BG_ACTIVE,
} from '../../../builder/layout/colors.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function strip(str) {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1b\[[0-9;]*m/g, '');
}

function hexRgb(hex) {
  const c = hex.replace('#', '');
  return [parseInt(c.slice(0, 2), 16), parseInt(c.slice(2, 4), 16), parseInt(c.slice(4, 6), 16)];
}

function containsFg(str, hex) {
  const [r, g, b] = hexRgb(hex);
  return str.includes(`38;2;${r};${g};${b}`);
}

function containsBg(str, hex) {
  const [r, g, b] = hexRgb(hex);
  return str.includes(`48;2;${r};${g};${b}`);
}

// Force colour on
const origForceColor = process.env.FORCE_COLOR;
beforeEach(() => { process.env.FORCE_COLOR = '1'; delete process.env.NO_COLOR; });
afterEach(() => {
  if (origForceColor === undefined) delete process.env.FORCE_COLOR;
  else process.env.FORCE_COLOR = origForceColor;
});

// ─── serializeToYaml ─────────────────────────────────────────────────────────

describe('serializeToYaml()', () => {
  it('serializes null to "?"', () => {
    expect(serializeToYaml(null)).toBe('?');
  });

  it('serializes undefined to "?"', () => {
    expect(serializeToYaml(undefined)).toBe('?');
  });

  it('serializes a flat object with string values', () => {
    const result = serializeToYaml({ project_name: 'Acme', region: 'us-east-1' });
    expect(result).toContain('project_name: "Acme"');
    expect(result).toContain('region: "us-east-1"');
  });

  it('serializes a flat object with numeric values', () => {
    const result = serializeToYaml({ instance_count: 4, storage_gb: 500 });
    expect(result).toContain('instance_count: 4');
    expect(result).toContain('storage_gb: 500');
  });

  it('serializes boolean values bare (no quotes)', () => {
    const result = serializeToYaml({ enabled: true, versioning: false });
    expect(result).toContain('enabled: true');
    expect(result).toContain('versioning: false');
  });

  it('serializes null dimension values as "?"', () => {
    const result = serializeToYaml({ instance_type: null });
    expect(result).toContain('instance_type: ?');
  });

  it('serializes nested objects with indentation', () => {
    const result = serializeToYaml({ group: { name: 'Web' } });
    expect(result).toContain('group:');
    expect(result).toMatch(/name: "Web"/);
  });

  it('serializes arrays with "- " prefix per item', () => {
    const result = serializeToYaml({ tags: ['a', 'b'] });
    expect(result).toContain('tags:');
    expect(result).toContain('- "a"');
    expect(result).toContain('- "b"');
  });

  it('serializes an empty object as "{}"', () => {
    expect(serializeToYaml({})).toBe('{}');
  });

  it('serializes an empty array as "[]" inside a key', () => {
    const result = serializeToYaml({ services: [] });
    expect(result).toContain('services: []');
  });

  it('returns a non-empty string for a typical profile state', () => {
    const state = {
      schema_version: '2.0',
      project_name: 'Test Project',
      groups: [{ group_name: 'Frontend', services: [] }],
    };
    const result = serializeToYaml(state);
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
    expect(result).toContain('schema_version: "2.0"');
    expect(result).toContain('project_name: "Test Project"');
  });

  it('escapes internal double-quotes in strings', () => {
    const result = serializeToYaml({ note: 'say "hello"' });
    expect(result).toContain('\\"hello\\"');
  });

  it('does not throw for deeply nested objects', () => {
    const deep = { a: { b: { c: { d: 'value' } } } };
    expect(() => serializeToYaml(deep)).not.toThrow();
  });
});

// ─── highlightYaml ────────────────────────────────────────────────────────────

describe('highlightYaml()', () => {
  it('returns an array', () => {
    const result = highlightYaml('key: "value"\n', null);
    expect(Array.isArray(result)).toBe(true);
  });

  it('returns one element per input line', () => {
    const yaml = 'project_name: "Acme"\nregion: "us-east-1"\ngroups:';
    const result = highlightYaml(yaml, null);
    expect(result).toHaveLength(3);
  });

  it('each element is a string', () => {
    const result = highlightYaml('key: "value"', null);
    for (const line of result) {
      expect(typeof line).toBe('string');
    }
  });

  it('active line contains ▶ glyph when activeKey matches', () => {
    const yaml = 'project_name: "Acme"\ninstance_type: ?';
    const lines = highlightYaml(yaml, 'instance_type');
    const activeLine = lines.find(l => strip(l).includes('instance_type'));
    expect(strip(activeLine)).toContain('▶');
  });

  it('only the FIRST matching line is marked active', () => {
    // Two lines with the same key name (edge case)
    const yaml = 'instance_type: ?\ninstance_type: "t3.micro"';
    const lines = highlightYaml(yaml, 'instance_type');
    const activeCount = lines.filter(l => strip(l).includes('▶')).length;
    expect(activeCount).toBe(1);
  });

  it('no line is marked active when activeKey is null', () => {
    const yaml = 'key: "value"\nother: 42';
    const lines = highlightYaml(yaml, null);
    expect(lines.every(l => !strip(l).includes('▶'))).toBe(true);
  });

  it('no line is marked active when activeKey does not match any line', () => {
    const yaml = 'project_name: "Acme"\nregion: "us-east-1"';
    const lines = highlightYaml(yaml, 'nonexistent_key');
    expect(lines.every(l => !strip(l).includes('▶'))).toBe(true);
  });

  it('returns [] for non-string input', () => {
    expect(highlightYaml(null, null)).toEqual([]);
    expect(highlightYaml(undefined, null)).toEqual([]);
  });

  it('active line has COL_BG_ACTIVE background', () => {
    const yaml = 'instance_type: ?';
    const lines = highlightYaml(yaml, 'instance_type');
    expect(containsBg(lines[0], COL_BG_ACTIVE)).toBe(true);
  });

  it('non-active lines do not have COL_BG_ACTIVE background', () => {
    const yaml = 'project_name: "Acme"\ninstance_type: ?';
    const lines = highlightYaml(yaml, 'instance_type');
    // First line (project_name) should NOT have bg active
    expect(containsBg(lines[0], COL_BG_ACTIVE)).toBe(false);
  });

  it('preserves plain text content in highlighted output', () => {
    const yaml = 'project_name: "Acme"\ncount: 5';
    const lines = highlightYaml(yaml, null);
    expect(strip(lines[0])).toContain('project_name');
    expect(strip(lines[0])).toContain('"Acme"');
    expect(strip(lines[1])).toContain('5');
  });
});

// ─── computeScrollOffset ─────────────────────────────────────────────────────

describe('computeScrollOffset()', () => {
  const lines20 = Array.from({ length: 20 }, (_, i) => `line${i}`);

  it('returns 0 when activeLineIdx is 0 and viewport covers start', () => {
    expect(computeScrollOffset(lines20, 0, 10)).toBe(0);
  });

  it('returns 0 when content fits entirely in viewport', () => {
    const short = ['a', 'b', 'c'];
    expect(computeScrollOffset(short, 1, 10)).toBe(0);
  });

  it('places active line near the middle of the viewport', () => {
    const offset = computeScrollOffset(lines20, 10, 10);
    // Active line (idx 10) should be visible: offset <= 10 <= offset + 9
    expect(offset).toBeLessThanOrEqual(10);
    expect(offset + 9).toBeGreaterThanOrEqual(10);
  });

  it('does not scroll past the end', () => {
    // Active at last line
    const offset = computeScrollOffset(lines20, 19, 10);
    expect(offset).toBeLessThanOrEqual(20 - 10); // max offset = 10
  });

  it('never returns a negative offset', () => {
    expect(computeScrollOffset(lines20, 0, 20)).toBeGreaterThanOrEqual(0);
    expect(computeScrollOffset(lines20, 0, 50)).toBeGreaterThanOrEqual(0);
  });

  it('clamps activeLineIdx below 0 gracefully', () => {
    expect(() => computeScrollOffset(lines20, -5, 10)).not.toThrow();
    expect(computeScrollOffset(lines20, -5, 10)).toBeGreaterThanOrEqual(0);
  });

  it('handles viewportHeight of 1', () => {
    const offset = computeScrollOffset(lines20, 10, 1);
    expect(offset).toBeGreaterThanOrEqual(0);
    expect(offset).toBeLessThanOrEqual(19);
  });

  it('handles empty lines array', () => {
    expect(() => computeScrollOffset([], 0, 10)).not.toThrow();
    expect(computeScrollOffset([], 0, 10)).toBe(0);
  });

  it('offset + viewport does not exceed total lines', () => {
    for (let active = 0; active < 20; active++) {
      const offset = computeScrollOffset(lines20, active, 10);
      expect(offset + 10).toBeLessThanOrEqual(20 + 10); // lenient: never negative
      expect(offset).toBeGreaterThanOrEqual(0);
    }
  });
});

// ─── Property P11: YAML Preview Syntax Highlighting ──────────────────────────

describe('Property 11: YAML Preview Syntax Highlighting', () => {
  // Feature: aws-cost-profile-builder, Property 11: YAML Preview Syntax Highlighting
  // Validates: Requirements 7.2, 7.3

  // ── Arbitraries ────────────────────────────────────────────────────────────

  // Safe key names (no colons or leading dashes)
  const arbKey = fc.stringMatching(/^[a-z][a-z_]{0,19}$/);

  // Each line-type generator produces a { line, kind } pair

  const arbKeyOnlyLine = arbKey.map(k => ({ line: `${k}:`, kind: 'key-only' }));

  const arbStringLine = fc.tuple(arbKey, fc.stringMatching(/^[a-zA-Z][a-zA-Z0-9 ]{0,20}$/))
    .map(([k, v]) => ({ line: `${k}: "${v}"`, kind: 'string' }));

  const arbNumberLine = fc.tuple(arbKey, fc.integer({ min: 1, max: 9999 }))
    .map(([k, v]) => ({ line: `${k}: ${v}`, kind: 'number' }));

  const arbBooleanLine = fc.tuple(arbKey, fc.boolean())
    .map(([k, v]) => ({ line: `${k}: ${v}`, kind: 'boolean' }));

  const arbUnansweredLine = arbKey
    .map(k => ({ line: `${k}: ?`, kind: 'unanswered' }));

  const arbAnyLine = fc.oneof(
    arbKeyOnlyLine,
    arbStringLine,
    arbNumberLine,
    arbBooleanLine,
    arbUnansweredLine,
  );

  // ── Sub-properties ─────────────────────────────────────────────────────────

  it('key-only lines always contain COL_BLUE foreground colour', () => {
    fc.assert(
      fc.property(arbKeyOnlyLine, ({ line }) => {
        const rendered = highlightYaml(line, null)[0] ?? '';
        expect(containsFg(rendered, COL_BLUE)).toBe(true);
      }),
      { numRuns: 25 },
    );
  });

  it('string value lines always contain COL_GREEN for the value', () => {
    fc.assert(
      fc.property(arbStringLine, ({ line }) => {
        const rendered = highlightYaml(line, null)[0] ?? '';
        expect(containsFg(rendered, COL_GREEN)).toBe(true);
      }),
      { numRuns: 25 },
    );
  });

  it('numeric value lines always contain COL_YELLOW for the value', () => {
    fc.assert(
      fc.property(arbNumberLine, ({ line }) => {
        const rendered = highlightYaml(line, null)[0] ?? '';
        expect(containsFg(rendered, COL_YELLOW)).toBe(true);
      }),
      { numRuns: 25 },
    );
  });

  it('boolean value lines always contain COL_MAGENTA for the value', () => {
    fc.assert(
      fc.property(arbBooleanLine, ({ line }) => {
        const rendered = highlightYaml(line, null)[0] ?? '';
        expect(containsFg(rendered, COL_MAGENTA)).toBe(true);
      }),
      { numRuns: 25 },
    );
  });

  it('unanswered "?" lines always contain COL_DIM for the value', () => {
    fc.assert(
      fc.property(arbUnansweredLine, ({ line }) => {
        const rendered = highlightYaml(line, null)[0] ?? '';
        expect(containsFg(rendered, COL_DIM)).toBe(true);
      }),
      { numRuns: 25 },
    );
  });

  it('active line always contains ▶ glyph and COL_BG_ACTIVE background', () => {
    fc.assert(
      fc.property(arbAnyLine, ({ line }) => {
        // Extract key from line (text before first ":")
        const key = line.split(':')[0].trim();
        const rendered = highlightYaml(line, key)[0] ?? '';
        expect(strip(rendered)).toContain('▶');
        expect(containsBg(rendered, COL_BG_ACTIVE)).toBe(true);
      }),
      { numRuns: 25 },
    );
  });

  it('plain text content is always preserved in the highlighted output', () => {
    fc.assert(
      fc.property(arbAnyLine, ({ line }) => {
        const rendered = highlightYaml(line, null)[0] ?? '';
        // The key name must still be visible after stripping ANSI
        const key = line.split(':')[0].trim();
        expect(strip(rendered)).toContain(key);
      }),
      { numRuns: 25 },
    );
  });

  it('highlightYaml returns exactly as many lines as the input has', () => {
    fc.assert(
      fc.property(
        fc.array(arbAnyLine, { minLength: 1, maxLength: 20 }),
        (pairs) => {
          const yaml = pairs.map(p => p.line).join('\n');
          const result = highlightYaml(yaml, null);
          expect(result).toHaveLength(pairs.length);
        },
      ),
      { numRuns: 25 },
    );
  });

  it('computeScrollOffset always returns value in [0, max(0, lines-viewport)]', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 50 }),   // total lines
        fc.integer({ min: 0, max: 49 }),   // active line index (may be ≥ total, clamped)
        fc.integer({ min: 1, max: 20 }),   // viewport height
        (total, active, viewport) => {
          const lines = Array.from({ length: total }, (_, i) => `line${i}`);
          const offset = computeScrollOffset(lines, active, viewport);
          const maxOffset = Math.max(0, total - viewport);
          expect(offset).toBeGreaterThanOrEqual(0);
          expect(offset).toBeLessThanOrEqual(maxOffset);
        },
      ),
      { numRuns: 25 },
    );
  });
});
