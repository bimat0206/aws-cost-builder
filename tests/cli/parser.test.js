import { describe, expect, it } from 'vitest';
import {
  buildParser,
  getActiveMode,
  parseSetOverrides,
} from '../../cli/parser.js';

describe('buildParser()', () => {
  it('accepts run mode with profile and overrides', async () => {
    const parsed = await buildParser([
      'node',
      'main.js',
      '--run',
      '--profile',
      'profiles/demo.hcl',
      '--headless',
      '--set',
      'group.service.dimension=value',
    ]).parseAsync();

    expect(parsed.run).toBe(true);
    expect(parsed.profile).toBe('profiles/demo.hcl');
    expect(parsed.headless).toBe(true);
    expect(parsed.set).toEqual(['group.service.dimension=value']);
  });

  it('rejects headless outside run mode', async () => {
    expect(() => buildParser([
        'node',
        'main.js',
        '--dry-run',
        '--profile',
        'profiles/demo.hcl',
        '--headless',
      ]).parseSync()).toThrow('--headless can only be used with --run.');
  });

  it('rejects multiple active modes', async () => {
    expect(() => buildParser([
        'node',
        'main.js',
        '--run',
        '--dry-run',
        '--profile',
        'profiles/demo.hcl',
      ]).parseSync()).toThrow('Only one mode may be specified at a time.');
  });
});

describe('getActiveMode()', () => {
  it('resolves export archive when the output path is provided', () => {
    expect(getActiveMode({ exportArchive: 'profiles.tar.gz' })).toBe('exportArchive');
  });

  it('returns null when no mode is active', () => {
    expect(getActiveMode({})).toBeNull();
  });
});

describe('parseSetOverrides()', () => {
  it('parses override pairs into a map', () => {
    const overrides = parseSetOverrides(['group.service.dimension=value']);
    expect(overrides.get('group|service|dimension')).toEqual({
      groupName: 'group',
      serviceName: 'service',
      dimensionKey: 'dimension',
      value: 'value',
    });
  });

  it('rejects malformed overrides', () => {
    expect(() => parseSetOverrides(['not-a-valid-override'])).toThrow();
  });
});
