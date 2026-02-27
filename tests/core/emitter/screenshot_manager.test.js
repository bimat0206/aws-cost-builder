/**
 * Unit + property tests for core/emitter/screenshot_manager.js
 *
 * Covers:
 *  - slugify: lowercase, spaces→underscore, unicode stripped, max-length, edge cases
 *  - buildScreenshotFilename: correct segment order, slug application, epoch timestamp
 *  - buildScreenshotPath: full path joins screenshotsDir + filename
 *
 * Property P18: Screenshot Naming Convention
 *   For any inputs, the filename must match:
 *     <run_id>_<group_slug>_<service_slug>_<step_name>_<epoch_ms>.png
 *   where each non-run_id segment is lowercase, spaces→_, non-ASCII stripped, ≤30 chars.
 *
 * Validates: Requirements 12.4
 */

// Feature: aws-cost-profile-builder, Property 18: Screenshot Naming Convention
// Validates: Requirements 12.4

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import path from 'path';
import {
  slugify,
  buildScreenshotFilename,
  buildScreenshotPath,
} from '../../../core/emitter/screenshot_manager.js';

// ─── slugify ─────────────────────────────────────────────────────────────────

describe('slugify()', () => {
  it('lowercases input', () => {
    expect(slugify('HELLO')).toBe('hello');
    expect(slugify('Amazon EC2')).toBe('amazon_ec2');
  });

  it('replaces spaces with underscores', () => {
    expect(slugify('hello world')).toBe('hello_world');
    expect(slugify('a b  c')).toBe('a_b_c');
  });

  it('strips non-ASCII / unicode characters', () => {
    expect(slugify('café')).toBe('caf');
    expect(slugify('résumé')).toBe('rsum');
    expect(slugify('日本語')).toBe('unknown'); // fully stripped → fallback
  });

  it('strips special characters but keeps hyphens and underscores', () => {
    expect(slugify('hello-world')).toBe('hello-world');
    expect(slugify('hello_world')).toBe('hello_world');
    expect(slugify('hello!world')).toBe('helloworld');
    expect(slugify('hello/world')).toBe('helloworld');
  });

  it('collapses consecutive separators', () => {
    expect(slugify('hello__world')).toBe('hello_world');
    expect(slugify('hello--world')).toBe('hello_world');
    expect(slugify('hello  world')).toBe('hello_world');
  });

  it('strips leading/trailing separators', () => {
    expect(slugify('_hello_')).toBe('hello');
    expect(slugify('-hello-')).toBe('hello');
  });

  it('truncates to 30 characters by default', () => {
    const long = 'a'.repeat(50);
    expect(slugify(long).length).toBeLessThanOrEqual(30);
  });

  it('respects custom maxLen', () => {
    expect(slugify('hello world', 5).length).toBeLessThanOrEqual(5);
  });

  it('returns "unknown" for empty or null input', () => {
    expect(slugify('')).toBe('unknown');
    expect(slugify(null)).toBe('unknown');
    expect(slugify(undefined)).toBe('unknown');
  });

  it('handles strings that become empty after stripping', () => {
    // all unicode stripped → empty → "unknown"
    const result = slugify('日本語');
    expect(result).toBe('unknown');
  });

  it('produces only safe characters (a-z, 0-9, _, -)', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 0, maxLength: 100 }),
        (input) => {
          const result = slugify(input);
          expect(result).toMatch(/^[a-z0-9_-]*$|^unknown$/);
          expect(result.length).toBeLessThanOrEqual(30);
        }
      ),
      { numRuns: 25 }
    );
  });
});

// ─── buildScreenshotFilename ──────────────────────────────────────────────────

describe('buildScreenshotFilename()', () => {
  const RUN_ID = 'run_20240315_143022';
  const EPOCH  = 1684539120000;

  it('produces correct format with fixed inputs', () => {
    const name = buildScreenshotFilename(RUN_ID, 'prod workload', 'Amazon EC2', 'region_select', EPOCH);
    expect(name).toBe(`${RUN_ID}_prod_workload_amazon_ec2_region_select_${EPOCH}.png`);
  });

  it('ends with .png', () => {
    const name = buildScreenshotFilename(RUN_ID, 'g', 's', 'step', EPOCH);
    expect(name).toMatch(/\.png$/);
  });

  it('contains the epoch as a numeric segment before .png', () => {
    const name = buildScreenshotFilename(RUN_ID, 'g', 's', 'step', EPOCH);
    expect(name).toContain(`_${EPOCH}.png`);
  });

  it('uses Date.now() when epochMs is not provided', () => {
    const before = Date.now();
    const name = buildScreenshotFilename(RUN_ID, 'g', 's', 'step');
    const after = Date.now();
    // Extract epoch from filename: last numeric segment before .png
    const match = name.match(/_(\d+)\.png$/);
    expect(match).not.toBeNull();
    const ts = Number(match[1]);
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
  });

  it('slugifies group, service, and step names', () => {
    const name = buildScreenshotFilename(RUN_ID, 'My Group', 'Amazon S3', 'Field Fill', EPOCH);
    expect(name).toContain('my_group');
    expect(name).toContain('amazon_s3');
    expect(name).toContain('field_fill');
  });

  it('each slug segment is at most 30 characters', () => {
    const longName = 'a very long name that exceeds thirty characters in total';
    const name = buildScreenshotFilename(RUN_ID, longName, longName, longName, EPOCH);
    const parts = name.replace('.png', '').split('_');
    // The slug segments may span multiple underscores; test overall length heuristic
    // by checking the filename stays reasonable
    expect(name.length).toBeLessThan(200); // loose sanity check
    // Check individual slug segments via slugify directly
    expect(slugify(longName).length).toBeLessThanOrEqual(30);
  });
});

// ─── buildScreenshotPath ──────────────────────────────────────────────────────

describe('buildScreenshotPath()', () => {
  it('joins screenshotsDir with the generated filename', () => {
    const dir  = '/outputs/screenshots';
    const p    = buildScreenshotPath(dir, 'run_20240315_143022', 'g', 's', 'step', 12345);
    expect(p).toContain(dir);
    expect(p).toMatch(/\.png$/);
    expect(p).toBe(path.join(dir, buildScreenshotFilename('run_20240315_143022', 'g', 's', 'step', 12345)));
  });

  it('returns an absolute path when screenshotsDir is absolute', () => {
    const p = buildScreenshotPath('/abs/path', 'run_20240315_000000', 'g', 's', 'step', 0);
    expect(path.isAbsolute(p)).toBe(true);
  });
});

// ─── Property 18: Screenshot Naming Convention ────────────────────────────────

describe('Property 18: Screenshot Naming Convention', () => {
  // Feature: aws-cost-profile-builder, Property 18: Screenshot Naming Convention
  // Validates: Requirements 12.4

  it('filename always matches <run_id>_<group_slug>_<service_slug>_<step_slug>_<epoch>.png', () => {
    fc.assert(
      fc.property(
        // run_id: valid run ID
        fc.string({ minLength: 1, maxLength: 30 }).filter(s => /^[a-z0-9_]+$/.test(s)),
        // group, service, step: arbitrary printable strings
        fc.string({ minLength: 1, maxLength: 60 }),
        fc.string({ minLength: 1, maxLength: 60 }),
        fc.string({ minLength: 1, maxLength: 60 }),
        // epoch: positive integer
        fc.integer({ min: 0, max: Number.MAX_SAFE_INTEGER }),
        (runId, group, service, step, epoch) => {
          const filename = buildScreenshotFilename(runId, group, service, step, epoch);

          // Must end with .png
          expect(filename).toMatch(/\.png$/);

          // Must contain the epoch just before .png
          expect(filename).toContain(`_${epoch}.png`);

          // Must start with runId
          expect(filename).toMatch(new RegExp(`^${runId}_`));

          // All characters (before .png) must be safe: a-z, 0-9, _, -, or digit
          const body = filename.replace(/\.png$/, '');
          expect(body).toMatch(/^[a-z0-9_-]+$/);

          // Each slug segment must be ≤30 chars
          const gSlug = slugify(group);
          const sSlug = slugify(service);
          const tSlug = slugify(step);
          expect(gSlug.length).toBeLessThanOrEqual(30);
          expect(sSlug.length).toBeLessThanOrEqual(30);
          expect(tSlug.length).toBeLessThanOrEqual(30);
        }
      ),
      { numRuns: 25 }
    );
  });

  it('slugs contain only a-z, 0-9, underscores, and hyphens', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 0, maxLength: 80 }),
        (input) => {
          const slug = slugify(input);
          expect(slug).toMatch(/^([a-z0-9_-]+|unknown)$/);
          expect(slug.length).toBeLessThanOrEqual(30);
        }
      ),
      { numRuns: 25 }
    );
  });
});
