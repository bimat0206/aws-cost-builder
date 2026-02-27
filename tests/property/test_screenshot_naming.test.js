// Feature: aws-cost-profile-builder, Property 18: Screenshot Naming Convention
// Validates: Requirements 12.4

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import {
  slugify,
  buildScreenshotFilename,
  buildScreenshotPath,
} from '../../core/emitter/screenshot_manager.js';

// ─── Arbitraries ─────────────────────────────────────────────────────────────

// Arbitrary string that covers unicode, spaces, special chars, and empty strings
const arbAnyString = fc.oneof(
  fc.string({ minLength: 0, maxLength: 60 }),
  fc.fullUnicodeString({ minLength: 0, maxLength: 40 }),
  fc.constant(''),
  fc.constant('   '),
  fc.constant('Hello World!'),
  fc.constant('EC2 (t3.micro)'),
  fc.constant('us-east-1 / N. Virginia'),
);

// run_id follows the run_YYYYMMDD_HHMMSS format
const arbRunId = fc.date({
  min: new Date('2020-01-01T00:00:00Z'),
  max: new Date('2099-12-31T23:59:59Z'),
}).map(d => {
  const pad = (n, w = 2) => String(n).padStart(w, '0');
  return `run_${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}_${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`;
});

const arbEpochMs = fc.integer({ min: 0, max: Number.MAX_SAFE_INTEGER });

const arbDir = fc.string({ minLength: 1, maxLength: 40 }).map(s => `/tmp/${s}`);

// ─── Property 18: Screenshot Naming Convention ────────────────────────────────

describe('Property 18: Screenshot Naming Convention', () => {
  // **Validates: Requirements 12.4**

  it('slugify always returns a string of max 30 characters', () => {
    fc.assert(
      fc.property(arbAnyString, (str) => {
        const result = slugify(str);
        expect(typeof result).toBe('string');
        expect(result.length).toBeLessThanOrEqual(30);
      }),
      { numRuns: 25 }
    );
  });

  it('slugify always returns only lowercase a-z, 0-9, underscore, hyphen, or "unknown"', () => {
    fc.assert(
      fc.property(arbAnyString, (str) => {
        const result = slugify(str);
        expect(result).toMatch(/^[a-z0-9_-]+$/);
      }),
      { numRuns: 25 }
    );
  });

  it('slugify returns "unknown" for empty or whitespace-only input', () => {
    fc.assert(
      fc.property(
        fc.oneof(fc.constant(''), fc.constant('   '), fc.constant('\t\n')),
        (str) => {
          expect(slugify(str)).toBe('unknown');
        }
      ),
      { numRuns: 25 }
    );
  });

  it('buildScreenshotFilename always returns a string ending in .png', () => {
    fc.assert(
      fc.property(
        arbRunId,
        arbAnyString,
        arbAnyString,
        arbAnyString,
        arbEpochMs,
        (runId, groupName, serviceName, stepName, epochMs) => {
          const filename = buildScreenshotFilename(runId, groupName, serviceName, stepName, epochMs);
          expect(typeof filename).toBe('string');
          expect(filename.endsWith('.png')).toBe(true);
        }
      ),
      { numRuns: 25 }
    );
  });

  it('buildScreenshotFilename matches pattern <run_id>_<group_slug>_<service_slug>_<step_slug>_<epoch_ms>.png', () => {
    fc.assert(
      fc.property(
        arbRunId,
        arbAnyString,
        arbAnyString,
        arbAnyString,
        arbEpochMs,
        (runId, groupName, serviceName, stepName, epochMs) => {
          const filename = buildScreenshotFilename(runId, groupName, serviceName, stepName, epochMs);

          // Must start with the run_id
          expect(filename.startsWith(`${runId}_`)).toBe(true);

          // Must end with _<epochMs>.png
          expect(filename.endsWith(`_${epochMs}.png`)).toBe(true);

          // The middle portion (between runId_ and _epochMs.png) must be three slug segments
          const inner = filename.slice(runId.length + 1, filename.length - `_${epochMs}.png`.length);
          const parts = inner.split('_');
          // Each part must be a valid slug (a-z, 0-9, hyphen, underscore chars only)
          // Note: slugify may produce multi-word slugs with underscores, so we check
          // the overall inner portion is valid slug characters
          expect(inner).toMatch(/^[a-z0-9_-]+$/);
          expect(parts.length).toBeGreaterThanOrEqual(3);
        }
      ),
      { numRuns: 25 }
    );
  });

  it('each slug segment in the filename is max 30 characters', () => {
    fc.assert(
      fc.property(
        arbRunId,
        arbAnyString,
        arbAnyString,
        arbAnyString,
        arbEpochMs,
        (runId, groupName, serviceName, stepName, epochMs) => {
          const groupSlug   = slugify(groupName);
          const serviceSlug = slugify(serviceName);
          const stepSlug    = slugify(stepName);

          expect(groupSlug.length).toBeLessThanOrEqual(30);
          expect(serviceSlug.length).toBeLessThanOrEqual(30);
          expect(stepSlug.length).toBeLessThanOrEqual(30);
        }
      ),
      { numRuns: 25 }
    );
  });

  it('each slug segment contains only lowercase a-z, 0-9, underscore, or hyphen', () => {
    fc.assert(
      fc.property(
        arbAnyString,
        arbAnyString,
        arbAnyString,
        (groupName, serviceName, stepName) => {
          expect(slugify(groupName)).toMatch(/^[a-z0-9_-]+$/);
          expect(slugify(serviceName)).toMatch(/^[a-z0-9_-]+$/);
          expect(slugify(stepName)).toMatch(/^[a-z0-9_-]+$/);
        }
      ),
      { numRuns: 25 }
    );
  });

  it('buildScreenshotPath returns a path ending with the filename from buildScreenshotFilename', () => {
    fc.assert(
      fc.property(
        arbDir,
        arbRunId,
        arbAnyString,
        arbAnyString,
        arbAnyString,
        arbEpochMs,
        (dir, runId, groupName, serviceName, stepName, epochMs) => {
          const filename = buildScreenshotFilename(runId, groupName, serviceName, stepName, epochMs);
          const fullPath = buildScreenshotPath(dir, runId, groupName, serviceName, stepName, epochMs);

          expect(typeof fullPath).toBe('string');
          expect(fullPath.endsWith(filename)).toBe(true);
        }
      ),
      { numRuns: 25 }
    );
  });
});
