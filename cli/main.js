import { buildParser, getActiveMode, parseSetOverrides } from './parser.js';
import { promptInteractiveModeSelection } from './prompts.js';
import { printModeStart, statusLine } from './ui.js';
import { runDryRunMode } from './modes/dry_run_mode.js';
import { runExportArchiveMode } from './modes/export_archive_mode.js';
import { runPromoteMode } from './modes/promote_mode.js';
import { runRunnerMode } from './modes/run_mode.js';

/**
 * @param {string[]} [argv]
 * @returns {Promise<number>}
 */
export async function main(argv) {
  let parsed;
  try {
    parsed = await buildParser(argv ?? process.argv).parseAsync();
  } catch (error) {
    statusLine('error', error.message);
    return 1;
  }

  let overrides;
  try {
    overrides = parseSetOverrides(parsed.set ?? []);
  } catch (error) {
    statusLine('error', error.message);
    return 1;
  }

  try {
    let mode = getActiveMode(parsed);
    let profile = parsed.profile;
    let headless = parsed.headless;

    if (!mode) {
      const interactiveChoice = await promptInteractiveModeSelection();
      mode = interactiveChoice.mode;
      if (interactiveChoice.profile) profile = interactiveChoice.profile;
      if (typeof interactiveChoice.headless === 'boolean') headless = interactiveChoice.headless;
    }

    printModeStart(mode);

    if (mode === 'run') return await runRunnerMode({ profile, headless, overrides });
    if (mode === 'dryRun') return await runDryRunMode({ profile, overrides });
    if (mode === 'promote') return await runPromoteMode();
    if (mode === 'exportArchive') return await runExportArchiveMode({ outputPath: parsed.exportArchive });
  } catch (error) {
    if (error.code === 'ENOENT') {
      statusLine('error', `Profile file not found: ${error.path}`);
      return 1;
    }
    statusLine('error', `Fatal error: ${error.message}`);
    return 1;
  }

  return 0;
}
