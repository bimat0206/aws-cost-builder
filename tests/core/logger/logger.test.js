import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createModuleLogger, logEvent } from '../../../core/logger/logger.js';

let errBuf = '';

beforeEach(() => {
  errBuf = '';
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
    errBuf += chunk;
    return true;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('logEvent()', () => {
  it('normalizes WARN to WARNING and prints event metadata first', () => {
    logEvent('WARN', 'core/test', 'retry_attempt', {
      event_id: 'EVT-TST-01',
      step: 'my step',
    });

    expect(errBuf).toContain('| WARNING ');
    expect(errBuf).toContain('event_id=EVT-TST-01 event_type=retry_attempt');
    expect(errBuf).toContain('step="my step"');
  });

  it('flattens Error objects into informative fields', () => {
    const error = new Error('boom');
    error.code = 'E_TEST';

    logEvent('ERROR', 'core/test', 'failed', { error });

    expect(errBuf).toContain('event_type=failed');
    expect(errBuf).toContain('error_name=Error');
    expect(errBuf).toContain('error_message=boom');
    expect(errBuf).toContain('error_code=E_TEST');
  });
});

describe('createModuleLogger()', () => {
  it('reuses module name and base context', () => {
    const logger = createModuleLogger('automation/test', { run_id: 'run-123' });
    logger.info('step_complete', { service: 'Amazon EC2' });

    expect(errBuf).toContain('automation/test');
    expect(errBuf).toContain('run_id=run-123');
    expect(errBuf).toContain('service="Amazon EC2"');
  });

  it('supports child loggers with additional context', () => {
    const logger = createModuleLogger('automation/test', { run_id: 'run-123' });
    const child = logger.child({ group: 'prod' });
    child.error('step_failed', { error: new Error('bad state') });

    expect(errBuf).toContain('run_id=run-123');
    expect(errBuf).toContain('group=prod');
    expect(errBuf).toContain('error_message="bad state"');
  });
});
