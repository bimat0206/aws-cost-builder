import { join } from 'node:path';
import {
  getAppRuntimeConfig,
  getCliRuntimeConfig,
  interpolateTemplate,
} from '../../config/runtime/index.js';
import { writeProfileArchive } from '../../core/emitter/archive_writer.js';
import { statusLine } from '../ui.js';

const appConfig = getAppRuntimeConfig();
const cliConfig = getCliRuntimeConfig();

/**
 * @param {{ outputPath: string }} opts
 * @returns {Promise<number>}
 */
export async function runExportArchiveMode(opts) {
  const profilesDir = join(process.cwd(), appConfig.paths.profilesDirName);
  const outputPath = opts.outputPath || join(process.cwd(), appConfig.runtime.defaultArchiveName);

  statusLine('info', interpolateTemplate(cliConfig.messages.exportArchive.scan, { profilesDir }));
  try {
    const { files, outputPath: out } = await writeProfileArchive(profilesDir, outputPath);
    if (files.length === 0) {
      statusLine('warn', cliConfig.messages.exportArchive.noProfiles);
      statusLine('info', cliConfig.messages.exportArchive.noProfilesHint);
      return 0;
    }

    statusLine('ok', interpolateTemplate(cliConfig.messages.exportArchive.archived, {
      count: files.length,
      files: files.join(', '),
    }));
    statusLine('ok', interpolateTemplate(cliConfig.messages.exportArchive.output, {
      outputPath: out,
    }));
    return 0;
  } catch (error) {
    statusLine('error', `Archive failed: ${error.message}`);
    return 4;
  }
}
