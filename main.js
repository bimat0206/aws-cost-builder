#!/usr/bin/env node
/**
 * AWS Cost Profile Builder — CLI entry point
 * Owns CLI parsing, mode dispatch, lifecycle orchestration, and process exit codes.
 *
 * Exit codes:
 *   0 = success
 *   1 = preflight failure (validation, resolution, override parse)
 *   2 = partial automation failure (fail-forward, some dimensions/services failed)
 *   3 = browser launch failure
 *   4 = artifact write failure
 *   5 = interrupted (Ctrl+C)
 */

import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import * as readline from 'node:readline';
import { basename, join } from 'node:path';
import { loadProfile, ProfileFileNotFoundError, ProfileJSONParseError, ProfileSchemaValidationError } from './core/profile/loader.js';
import { applyOverrides, resolveDimensions, assertNoUnresolved, ResolutionError } from './core/resolver/priority_chain.js';
import { runInteractiveBuilder } from './builder/wizard/interactive_builder.js';
import { parseOverrides } from './core/resolver/override_parser.js';
import { loadAllCatalogs } from './config/loader/index.js';
import { ensureOutputDirs, buildRunId, writeRunResult } from './core/emitter/artifact_writer.js';
import { DimensionResult, GroupResult, RunResult, ServiceResult } from './core/models/run_result.js';
import { BrowserSession, AutomationFatalError } from './automation/session/browser_session.js';
import { navigateToService, clickSave } from './automation/navigation/navigator.js';
import { findElement } from './automation/locator/find_in_page_locator.js';
import { fillDimension } from './automation/interactor/field_interactor.js';
import { runInteractiveExplorer } from './explorer/wizard/interactive_explorer.js';
import { promoteDraft } from './explorer/draft/draft_promoter.js';
import { selectPrompt } from './builder/prompts/select_prompt.js';
import {
  COL_CYAN, COL_ORANGE, COL_YELLOW, COL_GREEN, COL_MUTED,
  COL_DIM, COL_BASE, COL_BORDER, COL_MAGENTA,
} from './builder/layout/colors.js';
import { fg, bg, bold, dim, padEnd, visibleLength } from './builder/layout/components.js';

// ─── UI helpers ───────────────────────────────────────────────────────────────

const NEWLINE = '\n';

/** Print a styled line to stdout. */
function print(line = '') { process.stdout.write(line + NEWLINE); }

/**
 * Status line prefix styles  — aligned with builder EventMessage convention.
 * @param {'ok'|'info'|'warn'|'error'} level
 * @param {string} text
 */
function statusLine(level, text) {
  const icons = { ok: '✓', info: 'i', warn: '!', error: '✗' };
  const colors = { ok: COL_GREEN, info: COL_CYAN, warn: COL_YELLOW, error: '\x1b[38;2;224;108;117m' };
  const icon = fg(`[${icons[level] ?? '·'}]`, colors[level] ?? COL_MUTED);
  process.stderr.write(`  ${icon} ${text}\n`);
}

/**
 * Print mode start banner.
 * @param {'build'|'run'|'dryRun'|'explore'|'promote'} mode
 */
function printModeStart(mode) {
  const opt = MODE_OPTIONS.find((m) => m.id === mode);
  if (!opt) return;
  print('');
  print(
    `  ${bold(fg('◆', COL_ORANGE))} ${bold(fg(opt.label, opt.color))} ${dim(`(${opt.badge})`)}  —  ${dim(opt.description)}`,
  );
  print(`  ${dim('─'.repeat(60))}`);
  print('');
}

// ─── Splash screen ────────────────────────────────────────────────────────────

/**
 * Print the startup splash screen (design mock screen-01).
 */
function printSplash() {
  print('');
  // "Local CLI Tool · v1.3"
  print('  ' + dim('LOCAL CLI TOOL · v1.3'.split('').join(' '))); // simple letter spacing sim
  print('');

  // "AWS Cost Builder"
  // Since we can't do true gradients easily in basic ANSI without a library,
  // we'll stick to the dominant cyan color from the design.
  print('  ' + bold(fg('AWS Cost Builder', COL_CYAN)));

  // "Automate AWS Pricing Calculator · Reusable profiles · Git-friendly JSON"
  print('  ' + dim('Automate AWS Pricing Calculator · Reusable profiles · Git-friendly JSON'));

  // Separator line
  print('  ' + dim('─'.repeat(60)));
  print('');
}

// ─── Mode card definitions ────────────────────────────────────────────────────

const MODE_OPTIONS = [
  {
    id: 'build',
    label: 'Builder',
    badge: 'Mode A',
    description: 'Create a cost profile interactively (TUI wizard)',
    color: COL_CYAN,
  },
  {
    id: 'run',
    label: 'Runner',
    badge: 'Mode B',
    description: 'Execute browser automation against a saved profile',
    color: COL_GREEN,
  },
  {
    id: 'dryRun',
    label: 'Dry Run',
    badge: 'Mode C',
    description: 'Validate and resolve a profile without opening a browser',
    color: COL_YELLOW,
  },
  {
    id: 'explore',
    label: 'Explorer',
    badge: 'Mode D',
    description: 'Discover service dimensions from a live AWS Calculator page',
    color: COL_MAGENTA,
  },
  {
    id: 'promote',
    label: 'Promoter',
    badge: 'Mode E',
    description: 'Promote a draft catalog entry to the validated service catalog',
    color: COL_ORANGE,
  },
];

// ─── Interactive mode picker ──────────────────────────────────────────────────

/**
 * Run the interactive mode-selection screen (design mock screen-01).
 *
 * Uses `selectPrompt` (arrow-key navigation) instead of plain readline.
 *
 * @returns {Promise<{ mode: 'build'|'run'|'dryRun'|'explore'|'promote', profile?: string, headless?: boolean }>}
 */
async function promptInteractiveModeSelection() {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error(
      'No mode specified in non-interactive environment. Use --build, --run --profile <path>, --dry-run --profile <path>, --explore, or --promote.',
    );
  }

  // Print splash
  printSplash();

  // Build display labels (with right-aligned badge)
  const displayLabels = MODE_OPTIONS.map((opt) => {
    const label  = bold(fg(opt.label.padEnd(12), opt.color));
    const badge  = fg(`[${opt.badge}]`, COL_DIM);
    const desc   = dim(opt.description);
    return { display: `${label} ${badge}  ${desc}`, id: opt.id };
  });

  const selectedDisplay = await selectPrompt({
    label: '◆ Select a mode to begin',
    options: displayLabels.map((d) => d.display),
    defaultValue: displayLabels[0].display,
    descriptions: {},
  });

  const chosenIndex = displayLabels.findIndex((d) => d.display === selectedDisplay);
  const mode = /** @type {'build'|'run'|'dryRun'|'explore'|'promote'} */ (
    MODE_OPTIONS[chosenIndex < 0 ? 0 : chosenIndex].id
  );

  print('');

  /** @type {{ mode: 'build'|'run'|'dryRun'|'explore'|'promote', profile?: string, headless?: boolean }} */
  const result = { mode };

  // Follow-up prompts for modes that need extra input
  if (mode === 'run' || mode === 'dryRun') {
    // Auto-discover profiles from profiles/ directory
    const { readdir } = await import('node:fs/promises');
    // `join` is already imported statically at the top of the file.

    try {
      const profilesDir = join(process.cwd(), 'profiles');
      const files = await readdir(profilesDir).catch(() => []);
      const profileFiles = files.filter(f => f.endsWith('.json'));
      
      if (profileFiles.length > 0) {
        // Show profile selection menu
        const profileOptions = profileFiles.map(f => ({
          display: f,
          path: join('profiles', f),
        }));
        
        const selectedProfile = await selectPrompt({
          label: 'Select a profile',
          options: profileOptions.map(p => p.display),
          defaultValue: profileOptions[0].display,
          descriptions: {},
        });
        
        const selectedPath = profileOptions.find(p => p.display === selectedProfile)?.path;
        result.profile = selectedPath || join('profiles', profileFiles[0]);
      } else {
        // No profiles found, ask for path
        result.profile = await promptForInput(
          `  ${dim('Profile path')} ${fg('›', COL_CYAN)} `,
          { required: true, errorMsg: 'Profile path is required.' },
        );
      }
    } catch {
      // Fallback to manual input
      result.profile = await promptForInput(
        `  ${dim('Profile path')} ${fg('›', COL_CYAN)} `,
        { required: true, errorMsg: 'Profile path is required.' },
      );
    }
  }

  if (mode === 'run') {
    const headlessLabel = await selectPrompt({
      label: 'Open a browser window?',
      options: [
        'Yes, open browser  (headless: false)',
        'No, run headless   (headless: true)',
      ],
      defaultValue: 'Yes, open browser  (headless: false)',
      descriptions: {},
    });
    result.headless = headlessLabel.startsWith('No');
  }

  print('');
  return result;
}

// ─── Single-input prompt ──────────────────────────────────────────────────────

/**
 * Prompt for a single free-text input with optional validation.
 *
 * @param {string} label
 * @param {{ required?: boolean, errorMsg?: string }} [opts]
 * @returns {Promise<string>}
 */
async function promptForInput(label, opts = {}) {
  const { required = false, errorMsg = 'A value is required.' } = opts;
  if (!process.stdin.isTTY || !process.stdout.isTTY) return '';

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    while (true) {
      const answer = await new Promise((resolve) => {
        rl.question(label, (a) => resolve(a.trim()));
      });
      if (!required || answer.length > 0) return answer;
      statusLine('warn', errorMsg);
    }
  } finally {
    rl.close();
  }
}

// ─── Parser ───────────────────────────────────────────────────────────────────

/**
 * Build and return the yargs CLI parser instance.
 * @param {string[]} [rawArgv]
 * @returns {import('yargs').Argv} configured yargs instance
 */
export function buildParser(rawArgv = process.argv) {
  return yargs(hideBin(rawArgv))
    .scriptName('aws-cost-builder')
    .usage('$0 <mode> [options]')
    .option('build', {
      type: 'boolean',
      description: 'Launch interactive TUI wizard to build a cost profile (Mode A)',
    })
    .option('run', {
      type: 'boolean',
      description: 'Run browser automation using a profile (Mode B)',
    })
    .option('dry-run', {
      type: 'boolean',
      description: 'Validate and resolve profile without opening a browser (Mode C)',
    })
    .option('explore', {
      type: 'boolean',
      description: 'Discover new AWS service dimensions from a live calculator page (Mode D)',
    })
    .option('promote', {
      type: 'boolean',
      description: 'Promote a draft catalog entry to the service catalog (Mode E)',
    })
    .option('profile', {
      type: 'string',
      description: 'Path to the profile JSON file (required for --run and --dry-run)',
    })
    .option('headless', {
      type: 'boolean',
      description: 'Run browser automation without a visible browser window',
      default: false,
    })
    .option('set', {
      type: 'array',
      description: 'Override a dimension value: "<group>.<service>.<dimension>=<value>"',
      default: [],
    })
    .check((argv) => {
      const modes = ['build', 'run', 'dryRun', 'explore', 'promote'];
      const activeModes = modes.filter((m) => argv[m]);
      if (activeModes.length > 1) {
        throw new Error(`Only one mode may be specified at a time. Got: ${activeModes.join(', ')}`);
      }
      if ((argv.run || argv.dryRun) && !argv.profile) {
        throw new Error('--profile <path> is required when using --run or --dry-run.');
      }
      if (argv.headless && !argv.run) {
        throw new Error('--headless can only be used with --run.');
      }
      return true;
    })
    .strict()
    .help()
    .alias('h', 'help')
    .version()
    .alias('v', 'version');
}

/**
 * @param {any} parsed
 * @returns {'build'|'run'|'dryRun'|'explore'|'promote'|null}
 */
function getActiveMode(parsed) {
  if (parsed.build) return 'build';
  if (parsed.run) return 'run';
  if (parsed.dryRun) return 'dryRun';
  if (parsed.explore) return 'explore';
  if (parsed.promote) return 'promote';
  return null;
}

// ─── Override helper ──────────────────────────────────────────────────────────

/**
 * Parse --set override expressions into a structured map.
 *
 * @param {string[]} values - raw --set argument values
 * @returns {Map<string, string>}
 */
export function parseSetOverrides(values) {
  return parseOverrides(values ?? []);
}

// ─── Mode runners ─────────────────────────────────────────────────────────────

/**
 * Launch the interactive TUI wizard (Mode A).
 * @returns {Promise<number>} exit code
 */
export async function runBuildMode() {
  const result = await runInteractiveBuilder();
  if (result === null) return 5;
  return 0;
}

/**
 * Launch browser automation using a resolved profile (Mode B).
 * @param {{ profile: string, headless: boolean, overrides: Map<string,string> }} opts
 * @returns {Promise<number>} exit code
 */
export async function runRunnerMode(opts) {
  const startedAt = new Date();
  const runId = buildRunId(startedAt);
  const { outputDir, screenshotsDir } = ensureOutputDirs(process.cwd());

  statusLine('info', `Loading profile from: ${opts.profile}`);
  
  let profile;
  try {
    profile = await loadProfile(opts.profile);
    statusLine('ok', `Profile loaded: ${profile.project_name || opts.profile}`);
  } catch (err) {
    statusLine('error', `Failed to load profile: ${err.message}`);
    if (err instanceof ProfileFileNotFoundError) {
      statusLine('error', `File does not exist: ${opts.profile}`);
    } else if (err instanceof ProfileJSONParseError) {
      statusLine('error', 'Invalid JSON in profile file');
    } else if (err instanceof ProfileSchemaValidationError) {
      statusLine('error', 'Profile schema validation failed');
    }
    throw err;
  }
  
  const catalogs = await loadAllCatalogs();
  const catalogByService = new Map(catalogs.map((c) => [c.service_name, c]));

  applyOverrides(profile, opts.overrides);
  const { unresolved } = resolveDimensions(profile);
  try {
    assertNoUnresolved(unresolved);
  } catch (err) {
    if (err instanceof ResolutionError) {
      statusLine('error', err.message);
      process.stderr.write(err.getReport());
      return 1;
    }
    throw err;
  }

  const runResult = new RunResult({
    run_id: runId,
    profile_name: profile.project_name ?? basename(opts.profile, '.json'),
    status: 'success',
    timestamp_start: startedAt.toISOString(),
    timestamp_end: startedAt.toISOString(),
    calculator_url: 'https://calculator.aws/#/estimate',
    groups: [],
  });

  const session = new BrowserSession({ headless: Boolean(opts.headless) });
  try {
    await session.start();
    await session.openCalculator();

    for (const group of profile.getGroups()) {
      const groupResult = new GroupResult({ group_name: group.group_name, services: [] });

      for (const service of group.getServices()) {
        const serviceResult = new ServiceResult({
          service_name: service.service_name,
          human_label: service.human_label ?? service.service_name,
          dimensions: [],
          failed_step: null,
        });

        const catalog = catalogByService.get(service.service_name);
        const searchTerms = catalog ? [catalog.search_term, catalog.service_name, catalog.calculator_page_title, ...(catalog.search_keywords || [])].filter(Boolean) : [service.service_name];
        const context = {
          runId,
          screenshotsDir,
          groupName: group.group_name,
          serviceName: service.service_name,
        };

        try {
          await navigateToService(session.page, {
            groupName: group.group_name,
            serviceName: service.service_name,
            searchTerms,
            region: service.region,
            context,
            catalogEntry: catalog,
          });
        } catch (navError) {
          serviceResult.failed_step = 'navigation';
          serviceResult.addDimension(new DimensionResult({
            key: '__navigation__',
            status: 'failed',
            error_detail: navError.message,
          }));
          groupResult.addService(serviceResult);
          continue;
        }

        for (const dimension of service.getDimensions()) {
          if (dimension.resolution_status === 'skipped') {
            serviceResult.addDimension(new DimensionResult({
              key: dimension.key,
              status: 'skipped',
            }));
            continue;
          }

          if (dimension.resolved_value === null || dimension.resolved_value === undefined) {
            const unresolvedStatus = dimension.required ? 'failed' : 'skipped';
            // Capture diagnostic screenshot for failed required dimensions
            let screenshotPath = null;
            if (unresolvedStatus === 'failed' && context.runId && context.screenshotsDir) {
              try {
                const { buildScreenshotPath } = await import('./core/emitter/screenshot_manager.js');
                screenshotPath = buildScreenshotPath(
                  context.screenshotsDir,
                  context.runId,
                  context.groupName,
                  context.serviceName,
                  `unresolved_${dimension.key}`
                );
                await session.page.screenshot({ path: screenshotPath });
              } catch {
                screenshotPath = null;
              }
            }
            serviceResult.addDimension(new DimensionResult({
              key: dimension.key,
              status: unresolvedStatus,
              error_detail: unresolvedStatus === 'failed' ? 'No resolved value' : null,
              screenshot_path: screenshotPath,
            }));
            continue;
          }

          const catalogDim = catalog?.dimensions?.find((d) => d.key === dimension.key);

          const located = await findElement(session.page, dimension.key, {
            primaryCss: catalogDim?.css_selector ?? null,
            fallbackLabel: catalogDim?.fallback_label ?? null,
            disambiguationIndex: catalogDim?.disambiguation_index ?? 0,
            required: dimension.required,
            maxRetries: 2,
            context,
          });
          if (located.status !== 'success' || !located.element) {
            serviceResult.addDimension(new DimensionResult({
              key: dimension.key,
              status: located.status === 'skipped' ? 'skipped' : 'failed',
              error_detail: located.status === 'failed' ? 'Locator failed' : null,
              screenshot_path: located.screenshotPath ?? null,
            }));
            continue;
          }

          const filled = await fillDimension(
            located.element,
            located.fieldType,
            String(dimension.resolved_value),
            {
              page: session.page,
              dimensionKey: dimension.key,
              required: dimension.required,
              maxRetries: 2,
            },
          );

          serviceResult.addDimension(new DimensionResult({
            key: dimension.key,
            status: filled.status === 'success'
              ? 'filled'
              : (filled.status === 'skipped' ? 'skipped' : 'failed'),
            error_detail: filled.status === 'failed' ? filled.message : null,
            screenshot_path: filled.screenshot ?? null,
          }));
        }

        // Save service to estimate
        try {
          // If the profile sets `save_to_summary` we could conditionally pass the label, but we default to 'Save and add service'
          await clickSave(session.page, 'Save and add service');
        } catch (saveError) {
          serviceResult.failed_step = 'save';
          serviceResult.addDimension(new DimensionResult({
            key: '__save__',
            status: 'failed',
            error_detail: saveError.message,
          }));
        }

        groupResult.addService(serviceResult);
      }

      runResult.addGroup(groupResult);
    }

    runResult.calculator_url = session.currentUrl();
    runResult.status = runResult.determineStatus();
  } catch (error) {
    if (error instanceof AutomationFatalError) {
      runResult.status = 'failed';
      statusLine('error', error.message);
    } else {
      runResult.status = 'failed';
      throw error;
    }
  } finally {
    runResult.timestamp_end = new Date().toISOString();
    await session.stop();
  }

  await writeRunResult(runResult, join(outputDir, 'run_result.json'));
  if (runResult.status === 'failed') return 1;
  if (runResult.status === 'partial_success') return 2;
  return 0;
}

/**
 * Validate and resolve a profile without opening a browser (Mode C).
 * @param {{ profile: string, overrides: Map<string,string> }} opts
 * @returns {Promise<number>} exit code
 */
export async function runDryRunMode(opts) {
  const startedAt = new Date();
  const runId = buildRunId(startedAt);
  const { outputDir } = ensureOutputDirs(process.cwd());

  const profile = await loadProfile(opts.profile);
  applyOverrides(profile, opts.overrides);
  const { unresolved } = resolveDimensions(profile);
  try {
    assertNoUnresolved(unresolved);
  } catch (err) {
    if (err instanceof ResolutionError) {
      statusLine('error', err.message);
      process.stderr.write(err.getReport());
      return 1;
    }
    throw err;
  }

  const runResult = new RunResult({
    run_id: runId,
    profile_name: profile.project_name ?? basename(opts.profile, '.json'),
    status: 'success',
    timestamp_start: startedAt.toISOString(),
    timestamp_end: new Date().toISOString(),
    calculator_url: 'https://calculator.aws/#/estimate',
    groups: [],
  });

  for (const group of profile.getGroups()) {
    const groupResult = new GroupResult({ group_name: group.group_name, services: [] });
    for (const service of group.getServices()) {
      const serviceResult = new ServiceResult({
        service_name: service.service_name,
        human_label: service.human_label ?? service.service_name,
        dimensions: [],
      });

      for (const dimension of service.getDimensions()) {
        const status = dimension.resolution_status === 'resolved' ? 'filled' : 'skipped';
        serviceResult.addDimension(new DimensionResult({
          key: dimension.key,
          status,
        }));
      }

      groupResult.addService(serviceResult);
    }
    runResult.addGroup(groupResult);
  }

  runResult.status = runResult.determineStatus();
  await writeRunResult(runResult, join(outputDir, 'run_result.json'));
  statusLine('ok', `Dry-run complete — profile resolved (${runResult.status})`);
  return runResult.status === 'partial_success' ? 2 : 0;
}

/**
 * Discover new AWS service dimensions from a live calculator page (Mode D).
 * @returns {Promise<number>} exit code
 */
export async function runExploreMode() {
  const result = await runInteractiveExplorer({ root: process.cwd() });
  return result ? 0 : 1;
}

/**
 * Promote a draft catalog entry to the validated service catalog (Mode E).
 * @returns {Promise<number>} exit code
 */
export async function runPromoteMode() {
  print(`  ${dim('Draft service id to promote')}`);
  const serviceId = await promptForInput(
    `  ${fg('›', COL_CYAN)} `,
    { required: true, errorMsg: 'Service id is required for promote mode.' },
  );
  const result = await promoteDraft(serviceId, process.cwd());
  return result ? 0 : 1;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

/**
 * Main entry point — parse argv, dispatch to mode, map errors to exit codes.
 * @param {string[]} [argv] - process.argv (defaults to process.argv)
 * @returns {Promise<number>} exit code
 */
export async function main(argv) {
  let parsed;
  try {
    parsed = await buildParser(argv ?? process.argv).parseAsync();
  } catch (err) {
    statusLine('error', err.message);
    return 1;
  }

  let overrides;
  try {
    overrides = parseSetOverrides(parsed.set ?? []);
  } catch (err) {
    statusLine('error', err.message);
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

    // Print mode start banner
    printModeStart(mode);

    if (mode === 'build')   return await runBuildMode();
    if (mode === 'run')     return await runRunnerMode({ profile, headless, overrides });
    if (mode === 'dryRun')  return await runDryRunMode({ profile, overrides });
    if (mode === 'explore') return await runExploreMode();
    if (mode === 'promote') return await runPromoteMode();
  } catch (err) {
    if (err.code === 'ENOENT') {
      statusLine('error', `Profile file not found: ${err.path}`);
      return 1;
    }
    statusLine('error', `Fatal error: ${err.message}`);
    return 1;
  }

  return 0;
}

// Run when executed directly
if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  main().then((code) => process.exit(code));
}
