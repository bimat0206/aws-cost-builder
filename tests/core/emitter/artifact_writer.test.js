/**
 * Unit + property tests for core/emitter/artifact_writer.js
 *
 * Covers (unit):
 *  - buildRunId: correct format "run_YYYYMMDD_HHMMSS", UTC-based, zero-padded
 *  - ensureOutputDirs: creates outputs/ and outputs/screenshots/, returns paths, idempotent
 *  - writeRunResult: writes valid JSON to disk, UTF-8 2-space indent, throws ArtifactWriteError on failure
 *  - ArtifactWriteError: carries path and cause
 *
 * Property P17: Run Result Structural Completeness
 *   For any RunResult, writeRunResult must emit valid JSON containing all required
 *   top-level fields plus correct per-service metrics and dimensions arrays.
 *
 * Validates: Requirements 12.1, 12.2, 12.3, 12.5, 12.6
 */

// Feature: aws-cost-profile-builder, Property 17: Run Result Structural Completeness
// Validates: Requirements 12.1, 12.2, 12.3, 12.5, 12.6

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fc from 'fast-check';
import fs from 'fs';
import path from 'path';
import os from 'os';

import {
  ArtifactWriteError,
  ensureOutputDirs,
  buildRunId,
  writeRunResult,
} from '../../../core/emitter/artifact_writer.js';
import {
  RunResult,
  GroupResult,
  ServiceResult,
  ServiceMetrics,
  DimensionResult,
} from '../../../core/models/run_result.js';

// ─── Temp directory helpers ───────────────────────────────────────────────────

let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aws-cost-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ─── buildRunId ───────────────────────────────────────────────────────────────

describe('buildRunId()', () => {
  it('produces run_YYYYMMDD_HHMMSS format for a known timestamp', () => {
    // 2024-03-15 14:30:22 UTC
    const d = new Date('2024-03-15T14:30:22Z');
    expect(buildRunId(d)).toBe('run_20240315_143022');
  });

  it('zero-pads month, day, hours, minutes, seconds', () => {
    // 2024-01-02 03:04:05 UTC
    const d = new Date('2024-01-02T03:04:05Z');
    expect(buildRunId(d)).toBe('run_20240102_030405');
  });

  it('returns a string starting with "run_"', () => {
    expect(buildRunId(new Date())).toMatch(/^run_\d{8}_\d{6}$/);
  });

  it('defaults to current UTC time when no date is passed', () => {
    const before = new Date();
    const id = buildRunId();
    const after = new Date();
    // Extract date portion and verify it's within the current minute
    expect(id).toMatch(/^run_\d{8}_\d{6}$/);
    const year = Number(id.slice(4, 8));
    expect(year).toBeGreaterThanOrEqual(before.getUTCFullYear());
    expect(year).toBeLessThanOrEqual(after.getUTCFullYear());
  });

  it('generates unique IDs for different timestamps', () => {
    const d1 = new Date('2024-01-01T00:00:00Z');
    const d2 = new Date('2024-01-01T00:00:01Z');
    expect(buildRunId(d1)).not.toBe(buildRunId(d2));
  });

  it('is deterministic for the same input', () => {
    const d = new Date('2024-06-15T08:45:30Z');
    expect(buildRunId(d)).toBe(buildRunId(d));
  });
});

// ─── ArtifactWriteError ───────────────────────────────────────────────────────

describe('ArtifactWriteError', () => {
  it('has correct name', () => {
    const e = new ArtifactWriteError('msg', '/some/path');
    expect(e.name).toBe('ArtifactWriteError');
    expect(e).toBeInstanceOf(Error);
  });

  it('stores the path', () => {
    const e = new ArtifactWriteError('msg', '/abs/path/to/file.json');
    expect(e.path).toBe('/abs/path/to/file.json');
  });

  it('stores the cause when provided', () => {
    const cause = new Error('ENOENT');
    const e = new ArtifactWriteError('msg', '/p', cause);
    expect(e.cause).toBe(cause);
  });

  it('sets cause to null when not provided', () => {
    const e = new ArtifactWriteError('msg', '/p');
    expect(e.cause).toBeNull();
  });
});

// ─── ensureOutputDirs ─────────────────────────────────────────────────────────

describe('ensureOutputDirs()', () => {
  it('creates outputs/ and outputs/screenshots/ under baseDir', () => {
    const { outputDir, screenshotsDir } = ensureOutputDirs(tmpDir);
    expect(fs.existsSync(outputDir)).toBe(true);
    expect(fs.existsSync(screenshotsDir)).toBe(true);
  });

  it('returns absolute paths', () => {
    const { outputDir, screenshotsDir } = ensureOutputDirs(tmpDir);
    expect(path.isAbsolute(outputDir)).toBe(true);
    expect(path.isAbsolute(screenshotsDir)).toBe(true);
  });

  it('outputDir is <baseDir>/outputs', () => {
    const { outputDir } = ensureOutputDirs(tmpDir);
    expect(outputDir).toBe(path.resolve(tmpDir, 'outputs'));
  });

  it('screenshotsDir is <baseDir>/outputs/screenshots', () => {
    const { screenshotsDir } = ensureOutputDirs(tmpDir);
    expect(screenshotsDir).toBe(path.resolve(tmpDir, 'outputs', 'screenshots'));
  });

  it('is idempotent — calling twice does not throw', () => {
    expect(() => {
      ensureOutputDirs(tmpDir);
      ensureOutputDirs(tmpDir);
    }).not.toThrow();
  });

  it('throws ArtifactWriteError when baseDir is not writable', () => {
    // Use a clearly invalid path that cannot be created
    const badBase = '/proc/impossible_subdir_that_cannot_exist/deep';
    expect(() => ensureOutputDirs(badBase)).toThrow(ArtifactWriteError);
  });
});

// ─── writeRunResult ───────────────────────────────────────────────────────────

/** Build a minimal valid RunResult for testing. */
function makeRunResult(overrides = {}) {
  const dim = new DimensionResult({ key: 'InstanceType', status: 'filled' });
  const svc = new ServiceResult({
    service_name: 'Amazon EC2',
    human_label:  'Web Servers',
    status:       'success',
    metrics:      new ServiceMetrics({ filled: 1, skipped: 0, failed: 0 }),
    dimensions:   [dim],
    failed_step:  null,
  });
  const grp = new GroupResult({ group_name: 'Frontend', status: 'success', services: [svc] });

  return new RunResult({
    schema_version:   '2.0',
    run_id:           'run_20240315_143022',
    profile_name:     'Test Profile',
    status:           'success',
    timestamp_start:  '2024-03-15T14:30:22Z',
    timestamp_end:    '2024-03-15T14:32:41Z',
    calculator_url:   'https://calculator.aws/#/estimate',
    groups:           [grp],
    ...overrides,
  });
}

describe('writeRunResult()', () => {
  it('creates the output file', async () => {
    const outFile = path.join(tmpDir, 'outputs', 'run_result.json');
    await writeRunResult(makeRunResult(), outFile);
    expect(fs.existsSync(outFile)).toBe(true);
  });

  it('writes valid JSON', async () => {
    const outFile = path.join(tmpDir, 'run_result.json');
    await writeRunResult(makeRunResult(), outFile);
    const raw = fs.readFileSync(outFile, 'utf-8');
    expect(() => JSON.parse(raw)).not.toThrow();
  });

  it('writes UTF-8 content', async () => {
    const outFile = path.join(tmpDir, 'run_result.json');
    await writeRunResult(makeRunResult(), outFile);
    const raw = fs.readFileSync(outFile); // Buffer
    // UTF-8 BOM absence check — should start with '{' (0x7B)
    expect(raw[0]).toBe(0x7b);
  });

  it('uses 2-space indentation', async () => {
    const outFile = path.join(tmpDir, 'run_result.json');
    await writeRunResult(makeRunResult(), outFile);
    const raw = fs.readFileSync(outFile, 'utf-8');
    // Top-level keys should be indented with exactly 2 spaces
    expect(raw).toContain('\n  "run_id"');
  });

  it('written JSON contains all required top-level fields', async () => {
    const outFile = path.join(tmpDir, 'run_result.json');
    await writeRunResult(makeRunResult(), outFile);
    const obj = JSON.parse(fs.readFileSync(outFile, 'utf-8'));

    for (const field of [
      'schema_version', 'run_id', 'profile_name', 'status',
      'timestamp_start', 'timestamp_end', 'calculator_url', 'groups',
    ]) {
      expect(obj).toHaveProperty(field);
    }
  });

  it('written JSON preserves run_id and profile_name', async () => {
    const result = makeRunResult({ run_id: 'run_20991231_235959', profile_name: 'My Profile' });
    const outFile = path.join(tmpDir, 'run_result.json');
    await writeRunResult(result, outFile);
    const obj = JSON.parse(fs.readFileSync(outFile, 'utf-8'));
    expect(obj.run_id).toBe('run_20991231_235959');
    expect(obj.profile_name).toBe('My Profile');
  });

  it('creates parent directories if they do not exist', async () => {
    const deep = path.join(tmpDir, 'deep', 'nested', 'run_result.json');
    await writeRunResult(makeRunResult(), deep);
    expect(fs.existsSync(deep)).toBe(true);
  });

  it('throws ArtifactWriteError when path is not writable', async () => {
    const badPath = '/proc/cannot_write_here/run_result.json';
    await expect(writeRunResult(makeRunResult(), badPath))
      .rejects.toBeInstanceOf(ArtifactWriteError);
  });

  it('ArtifactWriteError thrown on write failure includes the absolute path', async () => {
    const badPath = '/no_permission/run_result.json';
    let caught;
    try { await writeRunResult(makeRunResult(), badPath); } catch (e) { caught = e; }
    expect(caught).toBeInstanceOf(ArtifactWriteError);
    expect(caught.path).toBeTruthy();
    expect(typeof caught.path).toBe('string');
  });

  it('overwrites an existing file without error', async () => {
    const outFile = path.join(tmpDir, 'run_result.json');
    await writeRunResult(makeRunResult({ run_id: 'run_first' }), outFile);
    await writeRunResult(makeRunResult({ run_id: 'run_second' }), outFile);
    const obj = JSON.parse(fs.readFileSync(outFile, 'utf-8'));
    expect(obj.run_id).toBe('run_second');
  });
});

// ─── Property 17: Run Result Structural Completeness ─────────────────────────

describe('Property 17: Run Result Structural Completeness', () => {
  // Feature: aws-cost-profile-builder, Property 17: Run Result Structural Completeness
  // Validates: Requirements 12.1, 12.2, 12.3

  // ── Arbitraries ────────────────────────────────────────────────────────────

  const arbStatus = fc.constantFrom('success', 'partial_success', 'failed');

  const arbDimResult = fc.record({
    key:             fc.string({ minLength: 1, maxLength: 20 }),
    status:          fc.constantFrom('filled', 'skipped', 'failed'),
    error_detail:    fc.option(fc.string({ minLength: 1, maxLength: 30 }), { nil: null }),
    screenshot_path: fc.option(fc.string({ minLength: 1, maxLength: 40 }), { nil: null }),
  }).map(d => new DimensionResult(d));

  const arbServiceResult = fc.record({
    service_name: fc.string({ minLength: 1, maxLength: 20 }),
    human_label:  fc.string({ minLength: 1, maxLength: 20 }),
    status:       arbStatus,
    failed_step:  fc.option(fc.string({ minLength: 1, maxLength: 20 }), { nil: null }),
  }).chain(({ service_name, human_label, status, failed_step }) =>
    fc.array(arbDimResult, { minLength: 0, maxLength: 3 }).map(dimensions => {
      const metrics = ServiceMetrics.fromDimensions(dimensions);
      return new ServiceResult({ service_name, human_label, status, metrics, dimensions, failed_step });
    })
  );

  const arbGroupResult = fc.record({
    group_name: fc.string({ minLength: 1, maxLength: 20 }),
    status:     arbStatus,
  }).chain(({ group_name, status }) =>
    fc.array(arbServiceResult, { minLength: 1, maxLength: 2 }).map(services =>
      new GroupResult({ group_name, status, services })
    )
  );

  const arbRunResult = fc.record({
    run_id:          fc.string({ minLength: 1, maxLength: 20 }).filter(s => /^[a-z0-9_]+$/.test(s)),
    profile_name:    fc.string({ minLength: 1, maxLength: 20 }),
    status:          arbStatus,
    timestamp_start: fc.constant('2024-01-01T00:00:00Z'),
    timestamp_end:   fc.constant('2024-01-01T00:01:00Z'),
    calculator_url:  fc.constant('https://calculator.aws/#/estimate'),
  }).chain(base =>
    fc.array(arbGroupResult, { minLength: 1, maxLength: 2 }).map(groups =>
      new RunResult({ schema_version: '2.0', ...base, groups })
    )
  );

  // Serialize in-memory (same logic as writeRunResult, no disk I/O)
  function toPlain(r) {
    const plain = typeof r.toObject === 'function' ? r.toObject() : r;
    return JSON.parse(JSON.stringify(plain, null, 2));
  }

  // ── Tests ───────────────────────────────────────────────────────────────────

  it('serialized JSON always contains all required top-level fields', () => {
    fc.assert(
      fc.property(arbRunResult, (r) => {
        const obj = toPlain(r);
        for (const f of ['schema_version','run_id','profile_name','status','timestamp_start','timestamp_end','calculator_url','groups']) {
          expect(obj).toHaveProperty(f);
        }
      }),
      { numRuns: 25 }
    );
  });

  it('each service result contains required fields and metrics', () => {
    fc.assert(
      fc.property(arbRunResult, (r) => {
        for (const g of toPlain(r).groups) {
          expect(Array.isArray(g.services)).toBe(true);
          for (const svc of g.services) {
            expect(svc).toHaveProperty('service_name');
            expect(svc).toHaveProperty('human_label');
            expect(svc).toHaveProperty('status');
            expect(svc).toHaveProperty('metrics');
            expect(Array.isArray(svc.dimensions)).toBe(true);
            expect(typeof svc.metrics.filled).toBe('number');
            expect(typeof svc.metrics.skipped).toBe('number');
            expect(typeof svc.metrics.failed).toBe('number');
          }
        }
      }),
      { numRuns: 25 }
    );
  });

  it('each dimension result contains key and valid status', () => {
    fc.assert(
      fc.property(arbRunResult, (r) => {
        for (const g of toPlain(r).groups) {
          for (const svc of g.services) {
            for (const dim of svc.dimensions) {
              expect(dim).toHaveProperty('key');
              expect(['filled', 'skipped', 'failed']).toContain(dim.status);
            }
          }
        }
      }),
      { numRuns: 25 }
    );
  });

  it('metrics counts match dimension arrays', () => {
    fc.assert(
      fc.property(arbRunResult, (r) => {
        for (const g of toPlain(r).groups) {
          for (const svc of g.services) {
            expect(svc.metrics.filled).toBe(svc.dimensions.filter(d => d.status === 'filled').length);
            expect(svc.metrics.skipped).toBe(svc.dimensions.filter(d => d.status === 'skipped').length);
            expect(svc.metrics.failed).toBe(svc.dimensions.filter(d => d.status === 'failed').length);
          }
        }
      }),
      { numRuns: 25 }
    );
  });

  it('schema_version is always "2.0"', () => {
    fc.assert(
      fc.property(arbRunResult, (r) => {
        expect(toPlain(r).schema_version).toBe('2.0');
      }),
      { numRuns: 25 }
    );
  });
});
