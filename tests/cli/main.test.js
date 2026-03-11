import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  parseAsync: vi.fn(),
  buildParser: vi.fn(),
  getActiveMode: vi.fn(),
  parseSetOverrides: vi.fn(),
  promptInteractiveModeSelection: vi.fn(),
  printModeStart: vi.fn(),
  statusLine: vi.fn(),
  runDryRunMode: vi.fn(),
  runExportArchiveMode: vi.fn(),
  runPromoteMode: vi.fn(),
  runRunnerMode: vi.fn(),
}));

mocks.buildParser.mockImplementation(() => ({ parseAsync: mocks.parseAsync }));

vi.mock('../../cli/parser.js', () => ({
  buildParser: mocks.buildParser,
  getActiveMode: mocks.getActiveMode,
  parseSetOverrides: mocks.parseSetOverrides,
}));

vi.mock('../../cli/prompts.js', () => ({
  promptInteractiveModeSelection: mocks.promptInteractiveModeSelection,
}));

vi.mock('../../cli/ui.js', () => ({
  printModeStart: mocks.printModeStart,
  statusLine: mocks.statusLine,
}));

vi.mock('../../cli/modes/dry_run_mode.js', () => ({
  runDryRunMode: mocks.runDryRunMode,
}));

vi.mock('../../cli/modes/export_archive_mode.js', () => ({
  runExportArchiveMode: mocks.runExportArchiveMode,
}));

vi.mock('../../cli/modes/promote_mode.js', () => ({
  runPromoteMode: mocks.runPromoteMode,
}));

vi.mock('../../cli/modes/run_mode.js', () => ({
  runRunnerMode: mocks.runRunnerMode,
}));

import { main } from '../../cli/main.js';

const {
  parseAsync,
  getActiveMode,
  parseSetOverrides,
  promptInteractiveModeSelection,
  printModeStart,
  statusLine,
  runDryRunMode,
  runRunnerMode,
} = mocks;

describe('cli/main.js', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    parseSetOverrides.mockReturnValue(new Map([['a.b.c', 'value']]));
  });

  it('dispatches run mode directly from parsed argv', async () => {
    parseAsync.mockResolvedValue({
      set: ['a.b.c=value'],
      run: true,
      profile: 'profiles/demo.hcl',
      headless: true,
      exportArchive: undefined,
    });
    getActiveMode.mockReturnValue('run');
    runRunnerMode.mockResolvedValue(0);

    const exitCode = await main(['node', 'main.js', '--run']);

    expect(exitCode).toBe(0);
    expect(runRunnerMode).toHaveBeenCalledWith({
      profile: 'profiles/demo.hcl',
      headless: true,
      overrides: expect.any(Map),
    });
    expect(printModeStart).toHaveBeenCalledWith('run');
  });

  it('uses interactive selection when no mode is provided', async () => {
    parseAsync.mockResolvedValue({
      set: [],
      run: false,
      dryRun: false,
      promote: false,
      exportArchive: undefined,
      profile: undefined,
      headless: false,
    });
    getActiveMode.mockReturnValue(null);
    promptInteractiveModeSelection.mockResolvedValue({
      mode: 'dryRun',
      profile: 'profiles/interactive.hcl',
    });
    runDryRunMode.mockResolvedValue(2);

    const exitCode = await main(['node', 'main.js']);

    expect(exitCode).toBe(2);
    expect(promptInteractiveModeSelection).toHaveBeenCalledTimes(1);
    expect(runDryRunMode).toHaveBeenCalledWith({
      profile: 'profiles/interactive.hcl',
      overrides: expect.any(Map),
    });
    expect(printModeStart).toHaveBeenCalledWith('dryRun');
  });

  it('maps parse failures to exit code 1', async () => {
    parseAsync.mockRejectedValue(new Error('bad args'));

    const exitCode = await main(['node', 'main.js', '--bad']);

    expect(exitCode).toBe(1);
    expect(statusLine).toHaveBeenCalledWith('error', 'bad args');
  });
});
