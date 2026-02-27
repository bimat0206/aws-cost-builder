/**
 * Tests for builder/layout/layout_engine.js
 *
 * Covers (unit):
 *  - isSplitMode: returns true iff stdout.isTTY && columns >= MIN_SPLIT_WIDTH
 *  - start / stop: lifecycle guards, no double-start
 *  - printAbove: writes to stdout in non-split mode, queues in split mode
 *  - updatePreview / updatePrompt: store state without throwing
 *  - promptWithPause: runs fn and returns its result
 *
 * Property P8: Layout Mode Selection
 *   For any terminal width < 120 or non-TTY, isSplitMode() must return false.
 *   For any terminal width ≥ 120 in a TTY, isSplitMode() must return true.
 *
 * Validates: Requirements 6.2, 15.6
 */

// Feature: aws-cost-profile-builder, Property 8: Layout Mode Selection
// Validates: Requirements 6.2, 15.6

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fc from 'fast-check';
import { LayoutEngine } from '../../../builder/layout/layout_engine.js';
import { MIN_SPLIT_WIDTH } from '../../../builder/layout/colors.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Patch process.stdout to simulate a given terminal environment.
 * Returns a cleanup function that restores the original descriptors.
 */
function mockTerminal({ isTTY, columns }) {
  const original = {
    isTTY:   Object.getOwnPropertyDescriptor(process.stdout, 'isTTY'),
    columns: Object.getOwnPropertyDescriptor(process.stdout, 'columns'),
  };

  Object.defineProperty(process.stdout, 'isTTY',   { value: isTTY,   configurable: true, writable: true });
  Object.defineProperty(process.stdout, 'columns', { value: columns, configurable: true, writable: true });

  return () => {
    if (original.isTTY)
      Object.defineProperty(process.stdout, 'isTTY', original.isTTY);
    if (original.columns)
      Object.defineProperty(process.stdout, 'columns', original.columns);
  };
}

// ─── isSplitMode ─────────────────────────────────────────────────────────────

describe('LayoutEngine.isSplitMode()', () => {
  let restore;

  afterEach(() => restore?.());

  it('returns true when TTY and width === MIN_SPLIT_WIDTH', () => {
    restore = mockTerminal({ isTTY: true, columns: MIN_SPLIT_WIDTH });
    expect(new LayoutEngine().isSplitMode()).toBe(true);
  });

  it('returns true when TTY and width > MIN_SPLIT_WIDTH', () => {
    restore = mockTerminal({ isTTY: true, columns: 200 });
    expect(new LayoutEngine().isSplitMode()).toBe(true);
  });

  it('returns false when TTY but width < MIN_SPLIT_WIDTH', () => {
    restore = mockTerminal({ isTTY: true, columns: MIN_SPLIT_WIDTH - 1 });
    expect(new LayoutEngine().isSplitMode()).toBe(false);
  });

  it('returns false when non-TTY even if width >= MIN_SPLIT_WIDTH', () => {
    restore = mockTerminal({ isTTY: false, columns: 200 });
    expect(new LayoutEngine().isSplitMode()).toBe(false);
  });

  it('returns false when columns is 0', () => {
    restore = mockTerminal({ isTTY: true, columns: 0 });
    expect(new LayoutEngine().isSplitMode()).toBe(false);
  });

  it('returns false when columns is undefined', () => {
    restore = mockTerminal({ isTTY: true, columns: undefined });
    expect(new LayoutEngine().isSplitMode()).toBe(false);
  });
});

// ─── Property P8: Layout Mode Selection ──────────────────────────────────────

describe('Property 8: Layout Mode Selection', () => {
  // Feature: aws-cost-profile-builder, Property 8: Layout Mode Selection
  // Validates: Requirements 6.2, 15.6

  let restore;
  afterEach(() => restore?.());

  it('non-TTY always yields single-column mode regardless of width', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 500 }),
        (width) => {
          restore = mockTerminal({ isTTY: false, columns: width });
          const engine = new LayoutEngine();
          expect(engine.isSplitMode()).toBe(false);
          restore();
          restore = null;
        }
      ),
      { numRuns: 25 }
    );
  });

  it('TTY + width < MIN_SPLIT_WIDTH always yields single-column mode', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: MIN_SPLIT_WIDTH - 1 }),
        (width) => {
          restore = mockTerminal({ isTTY: true, columns: width });
          const engine = new LayoutEngine();
          expect(engine.isSplitMode()).toBe(false);
          restore();
          restore = null;
        }
      ),
      { numRuns: 25 }
    );
  });

  it('TTY + width >= MIN_SPLIT_WIDTH always yields split mode', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: MIN_SPLIT_WIDTH, max: 500 }),
        (width) => {
          restore = mockTerminal({ isTTY: true, columns: width });
          const engine = new LayoutEngine();
          expect(engine.isSplitMode()).toBe(true);
          restore();
          restore = null;
        }
      ),
      { numRuns: 25 }
    );
  });

  it('boundary: width === MIN_SPLIT_WIDTH - 1 is single-column', () => {
    restore = mockTerminal({ isTTY: true, columns: MIN_SPLIT_WIDTH - 1 });
    expect(new LayoutEngine().isSplitMode()).toBe(false);
  });

  it('boundary: width === MIN_SPLIT_WIDTH is split', () => {
    restore = mockTerminal({ isTTY: true, columns: MIN_SPLIT_WIDTH });
    expect(new LayoutEngine().isSplitMode()).toBe(true);
  });
});

// ─── Lifecycle ────────────────────────────────────────────────────────────────

describe('LayoutEngine lifecycle', () => {
  let engine;
  let restore;
  let writes;

  beforeEach(() => {
    writes = [];
    // Intercept stdout writes to avoid cluttering test output
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      writes.push(chunk);
      return true;
    });
    // Use non-TTY mode so no ANSI screen management happens in CI
    restore = mockTerminal({ isTTY: false, columns: 80 });
    engine = new LayoutEngine();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    restore?.();
  });

  it('start() does not throw', () => {
    expect(() => engine.start()).not.toThrow();
  });

  it('stop() does not throw even before start()', () => {
    expect(() => engine.stop()).not.toThrow();
  });

  it('stop() after start() does not throw', () => {
    engine.start();
    expect(() => engine.stop()).not.toThrow();
  });

  it('calling start() twice does not throw', () => {
    engine.start();
    expect(() => engine.start()).not.toThrow();
  });
});

// ─── printAbove ───────────────────────────────────────────────────────────────

describe('printAbove()', () => {
  let restore;
  let writes;

  afterEach(() => {
    vi.restoreAllMocks();
    restore?.();
  });

  it('writes directly to stdout in non-TTY / single-column mode', () => {
    writes = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      writes.push(chunk);
      return true;
    });
    restore = mockTerminal({ isTTY: false, columns: 80 });

    const engine = new LayoutEngine();
    engine.start();
    engine.printAbove('hello event');

    const combined = writes.join('');
    expect(combined).toContain('hello event');
  });

  it('does not throw when called before start()', () => {
    writes = [];
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    restore = mockTerminal({ isTTY: false, columns: 80 });
    const engine = new LayoutEngine();
    expect(() => engine.printAbove('test')).not.toThrow();
  });
});

// ─── updatePreview / updatePrompt ────────────────────────────────────────────

describe('updatePreview() and updatePrompt()', () => {
  let restore;

  beforeEach(() => {
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    restore = mockTerminal({ isTTY: false, columns: 80 });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    restore?.();
  });

  it('updatePreview() does not throw with valid lines array', () => {
    const engine = new LayoutEngine();
    engine.start();
    expect(() => engine.updatePreview(['line1', 'line2'])).not.toThrow();
  });

  it('updatePreview() does not throw with null', () => {
    const engine = new LayoutEngine();
    engine.start();
    expect(() => engine.updatePreview(null)).not.toThrow();
  });

  it('updatePrompt() does not throw with valid content', () => {
    const engine = new LayoutEngine();
    engine.start();
    expect(() => engine.updatePrompt('some prompt text')).not.toThrow();
  });

  it('updatePrompt() does not throw with null', () => {
    const engine = new LayoutEngine();
    engine.start();
    expect(() => engine.updatePrompt(null)).not.toThrow();
  });
});

// ─── promptWithPause ─────────────────────────────────────────────────────────

describe('promptWithPause()', () => {
  let restore;

  beforeEach(() => {
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    restore = mockTerminal({ isTTY: false, columns: 80 });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    restore?.();
  });

  it('runs the provided function and returns its result', async () => {
    const engine = new LayoutEngine();
    engine.start();
    const result = await engine.promptWithPause(async () => 'user-answer');
    expect(result).toBe('user-answer');
  });

  it('propagates rejection from the prompt function', async () => {
    const engine = new LayoutEngine();
    engine.start();
    await expect(
      engine.promptWithPause(async () => { throw new Error('cancelled'); })
    ).rejects.toThrow('cancelled');
  });

  it('works even when not started (non-split mode)', async () => {
    const engine = new LayoutEngine();
    const result = await engine.promptWithPause(async () => 42);
    expect(result).toBe(42);
  });
});
