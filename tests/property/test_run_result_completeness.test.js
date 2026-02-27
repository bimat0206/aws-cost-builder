// Feature: aws-cost-profile-builder, Property 17: Run Result Structural Completeness
// Validates: Requirements 12.1, 12.2, 12.3

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { buildRunId } from '../../core/emitter/artifact_writer.js';
import {
  RunResult,
  GroupResult,
  ServiceResult,
  ServiceMetrics,
  DimensionResult,
} from '../../core/models/run_result.js';

// ─── Arbitraries ─────────────────────────────────────────────────────────────

const arbStatus = fc.constantFrom('success', 'partial_success', 'failed');
const arbDimStatus = fc.constantFrom('filled', 'skipped', 'failed');

const arbDimResult = fc.record({
  key:             fc.string({ minLength: 1, maxLength: 20 }),
  status:          arbDimStatus,
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

const arbRunId = fc.date({
  min: new Date('2020-01-01T00:00:00Z'),
  max: new Date('2099-12-31T23:59:59Z'),
}).map(d => buildRunId(d));

const arbRunResult = fc.record({
  run_id:          arbRunId,
  profile_name:    fc.string({ minLength: 1, maxLength: 30 }),
  status:          arbStatus,
  timestamp_start: fc.constant('2024-01-01T00:00:00Z'),
  timestamp_end:   fc.constant('2024-01-01T00:01:00Z'),
  calculator_url:  fc.constant('https://calculator.aws/#/estimate'),
}).chain(base =>
  fc.array(arbGroupResult, { minLength: 1, maxLength: 2 }).map(groups =>
    new RunResult({ schema_version: '2.0', ...base, groups })
  )
);

// Serialize to plain object (same path as writeRunResult, without disk I/O)
function toPlain(runResult) {
  const plain = typeof runResult.toObject === 'function' ? runResult.toObject() : runResult;
  return JSON.parse(JSON.stringify(plain, null, 2));
}

// ─── Property 17: Run Result Structural Completeness ─────────────────────────

describe('Property 17: Run Result Structural Completeness', () => {

  it('always contains all required top-level fields', () => {
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

  it('run_id always matches format run_YYYYMMDD_HHMMSS', () => {
    fc.assert(
      fc.property(arbRunResult, (r) => {
        expect(toPlain(r).run_id).toMatch(/^run_\d{8}_\d{6}$/);
      }),
      { numRuns: 25 }
    );
  });

  it('status is always one of success, partial_success, or failed', () => {
    fc.assert(
      fc.property(arbRunResult, (r) => {
        expect(['success', 'partial_success', 'failed']).toContain(toPlain(r).status);
      }),
      { numRuns: 25 }
    );
  });

  it('each group always has group_name, status, and services array', () => {
    fc.assert(
      fc.property(arbRunResult, (r) => {
        const obj = toPlain(r);
        expect(Array.isArray(obj.groups)).toBe(true);
        for (const g of obj.groups) {
          expect(g).toHaveProperty('group_name');
          expect(g).toHaveProperty('status');
          expect(Array.isArray(g.services)).toBe(true);
          expect(['success', 'partial_success', 'failed']).toContain(g.status);
        }
      }),
      { numRuns: 25 }
    );
  });

  it('each service always has required fields', () => {
    fc.assert(
      fc.property(arbRunResult, (r) => {
        for (const g of toPlain(r).groups) {
          for (const svc of g.services) {
            expect(svc).toHaveProperty('service_name');
            expect(svc).toHaveProperty('human_label');
            expect(svc).toHaveProperty('status');
            expect(svc).toHaveProperty('metrics');
            expect(Array.isArray(svc.dimensions)).toBe(true);
          }
        }
      }),
      { numRuns: 25 }
    );
  });

  it('metrics always has non-negative integer counts', () => {
    fc.assert(
      fc.property(arbRunResult, (r) => {
        for (const g of toPlain(r).groups) {
          for (const svc of g.services) {
            const { filled, skipped, failed } = svc.metrics;
            expect(Number.isInteger(filled) && filled >= 0).toBe(true);
            expect(Number.isInteger(skipped) && skipped >= 0).toBe(true);
            expect(Number.isInteger(failed) && failed >= 0).toBe(true);
          }
        }
      }),
      { numRuns: 25 }
    );
  });

  it('each dimension always has key, status, error_detail, screenshot_path', () => {
    fc.assert(
      fc.property(arbRunResult, (r) => {
        for (const g of toPlain(r).groups) {
          for (const svc of g.services) {
            for (const dim of svc.dimensions) {
              expect(dim).toHaveProperty('key');
              expect(dim).toHaveProperty('status');
              expect(dim).toHaveProperty('error_detail');
              expect(dim).toHaveProperty('screenshot_path');
              expect(['filled', 'skipped', 'failed']).toContain(dim.status);
            }
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
