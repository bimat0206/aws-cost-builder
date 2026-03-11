#!/usr/bin/env node

import { fileURLToPath } from 'node:url';
import { main } from './cli/main.js';

export { MODE_OPTIONS } from './cli/mode_options.js';
export { buildParser, getActiveMode, parseSetOverrides } from './cli/parser.js';
export { promptForInput, promptInteractiveModeSelection } from './cli/prompts.js';
export { runDryRunMode } from './cli/modes/dry_run_mode.js';
export { runExportArchiveMode } from './cli/modes/export_archive_mode.js';
export { runPromoteMode } from './cli/modes/promote_mode.js';
export { runRunnerMode } from './cli/modes/run_mode.js';
export { print, printModeStart, printSplash, renderModeChoice, statusLine } from './cli/ui.js';
export { main } from './cli/main.js';

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().then((code) => process.exit(code));
}
