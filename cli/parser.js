import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { getAppRuntimeConfig, getCliRuntimeConfig, interpolateTemplate } from '../config/runtime/index.js';
import { parseOverrides } from '../core/resolver/override_parser.js';

const appConfig = getAppRuntimeConfig();
const cliConfig = getCliRuntimeConfig();

/**
 * @param {string[]} [rawArgv]
 * @returns {import('yargs').Argv}
 */
export function buildParser(rawArgv = process.argv) {
  return yargs(hideBin(rawArgv))
    .scriptName(cliConfig.parser.scriptName)
    .usage(cliConfig.parser.usage)
    .option('run', {
      type: 'boolean',
      description: cliConfig.parser.descriptions.run,
    })
    .option('dry-run', {
      type: 'boolean',
      description: cliConfig.parser.descriptions.dryRun,
    })
    .option('promote', {
      type: 'boolean',
      description: cliConfig.parser.descriptions.promote,
    })
    .option('export-archive', {
      type: 'string',
      description: cliConfig.parser.descriptions.exportArchive,
      coerce: (value) => (value === '' ? appConfig.runtime.defaultArchiveName : value),
    })
    .option('profile', {
      type: 'string',
      description: cliConfig.parser.descriptions.profile,
    })
    .option('headless', {
      type: 'boolean',
      description: cliConfig.parser.descriptions.headless,
      default: false,
    })
    .option('set', {
      type: 'array',
      description: cliConfig.parser.descriptions.set,
      default: [],
    })
    .check((argv) => {
      const modes = ['run', 'dryRun', 'promote', 'exportArchive'];
      const activeModes = modes.filter((mode) => argv[mode]);
      if (activeModes.length > 1) {
        throw new Error(interpolateTemplate(cliConfig.parser.errors.multipleModes, {
          modes: activeModes.join(', '),
        }));
      }
      if ((argv.run || argv.dryRun) && !argv.profile) {
        throw new Error(cliConfig.parser.errors.profileRequired);
      }
      if (argv.headless && !argv.run) {
        throw new Error(cliConfig.parser.errors.headlessOnlyWithRun);
      }
      return true;
    })
    .exitProcess(false)
    .strict()
    .help()
    .alias('h', 'help')
    .version()
    .alias('v', 'version');
}

/**
 * @param {any} parsed
 * @returns {'run'|'dryRun'|'promote'|'exportArchive'|null}
 */
export function getActiveMode(parsed) {
  if (parsed.run) return 'run';
  if (parsed.dryRun) return 'dryRun';
  if (parsed.promote) return 'promote';
  if (parsed.exportArchive !== undefined && parsed.exportArchive !== null && parsed.exportArchive !== false) {
    return 'exportArchive';
  }
  return null;
}

/**
 * @param {string[]} values
 * @returns {Map<string, string>}
 */
export function parseSetOverrides(values) {
  return parseOverrides(values ?? []);
}
