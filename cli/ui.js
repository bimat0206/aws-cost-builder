import {
  COL_CYAN,
  COL_DIM,
  COL_GREEN,
  COL_MUTED,
  COL_ORANGE,
  COL_YELLOW,
} from '../builder/layout/colors.js';
import { bold, dim, fg } from '../builder/layout/components.js';
import { getAppRuntimeConfig, getCliRuntimeConfig } from '../config/runtime/index.js';
import { MODE_OPTIONS } from './mode_options.js';

const NEWLINE = '\n';
const appConfig = getAppRuntimeConfig();
const cliConfig = getCliRuntimeConfig();
const statusIcons = cliConfig.ui.status.icons;
const statusColors = {
  ok: COL_GREEN,
  info: COL_CYAN,
  warn: COL_YELLOW,
  error: cliConfig.ui.status.colors.errorHex,
};

export function print(line = '') {
  process.stdout.write(line + NEWLINE);
}

/**
 * @param {'ok'|'info'|'warn'|'error'} level
 * @param {string} text
 */
export function statusLine(level, text) {
  const icon = fg(`[${statusIcons[level] ?? statusIcons.default}]`, statusColors[level] ?? COL_MUTED);
  process.stderr.write(`  ${icon} ${text}\n`);
}

/**
 * @param {'run'|'dryRun'|'promote'|'exportArchive'} mode
 */
export function printModeStart(mode) {
  const option = MODE_OPTIONS.find((entry) => entry.id === mode);
  if (!option) return;

  print('');
  print(
    `  ${bold(fg(cliConfig.ui.modeStartGlyph, COL_ORANGE))} ${bold(fg(option.label, option.color))} ${dim(`(${option.badge})`)}  —  ${dim(option.description)}`,
  );
  print(`  ${dim('─'.repeat(cliConfig.ui.separatorWidth))}`);
  print('');
}

export function printSplash() {
  print('');
  print('  ' + dim(appConfig.branding.splashVersion.split('').join(' ')));
  print('');
  print('  ' + bold(fg(appConfig.branding.title, COL_CYAN)));
  print('  ' + dim(appConfig.branding.subtitle));
  print('  ' + dim('─'.repeat(cliConfig.ui.separatorWidth)));
  print('');
}

export function renderModeChoice(option) {
  const label = bold(fg(option.label.padEnd(cliConfig.ui.modeChoiceLabelWidth), option.color));
  const badge = fg(`[${option.badge}]`, COL_DIM);
  const description = dim(option.description);
  return `${label} ${badge}  ${description}`;
}
