import { join } from 'node:path';
import {
  ensureOutputDirs,
  buildRunId,
  writeRunResult,
} from '../../core/emitter/artifact_writer.js';
import {
  ProfileFileNotFoundError,
  ProfileJSONParseError,
  ProfileSchemaValidationError,
  loadProfile,
} from '../../core/profile/loader.js';
import { loadAllCatalogs } from '../../config/loader/index.js';
import { runProfileAutomation } from '../../automation/orchestration/run_profile_automation.js';
import { ResolutionError, resolveProfileInputs } from './profile_resolution.js';
import { createRunResult } from './shared.js';
import { statusLine } from '../ui.js';

/**
 * @param {{ profile: string, headless: boolean, overrides: Map<string,string> }} opts
 * @returns {Promise<number>}
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
  } catch (error) {
    statusLine('error', `Failed to load profile: ${error.message}`);
    if (error instanceof ProfileFileNotFoundError) {
      statusLine('error', `File does not exist: ${opts.profile}`);
    } else if (error instanceof ProfileJSONParseError) {
      statusLine('error', 'Invalid JSON in profile file');
    } else if (error instanceof ProfileSchemaValidationError) {
      statusLine('error', 'Profile schema validation failed');
    }
    throw error;
  }

  try {
    resolveProfileInputs({ profile, overrides: opts.overrides });
  } catch (error) {
    if (error instanceof ResolutionError) {
      statusLine('error', error.message);
      process.stderr.write(error.getReport());
      return 1;
    }
    throw error;
  }

  const catalogs = await loadAllCatalogs();
  const catalogByService = new Map(catalogs.map((catalog) => [catalog.service_name, catalog]));
  const runResult = createRunResult({
    startedAt,
    runId,
    profile,
    profilePath: opts.profile,
  });

  await runProfileAutomation({
    profile,
    runId,
    screenshotsDir,
    headless: opts.headless,
    runResult,
    catalogByService,
    onFatalError: (error) => statusLine('error', error.message),
  });

  runResult.timestamp_end = new Date().toISOString();
  await writeRunResult(runResult, join(outputDir, 'run_result.json'));

  if (runResult.status === 'failed') return 1;
  if (runResult.status === 'partial_success') return 2;
  return 0;
}
