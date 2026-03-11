import { join } from 'node:path';
import {
  buildRunId,
  ensureOutputDirs,
  writeRunResult,
} from '../../core/emitter/artifact_writer.js';
import { loadProfile } from '../../core/profile/loader.js';
import {
  DimensionResult,
  GroupResult,
  ServiceResult,
} from '../../core/models/run_result.js';
import { iterGroups } from '../../core/profile/group_iteration.js';
import { ResolutionError, resolveProfileInputs } from './profile_resolution.js';
import { createRunResult } from './shared.js';
import { statusLine } from '../ui.js';

/**
 * @param {{ profile: string, overrides: Map<string,string> }} opts
 * @returns {Promise<number>}
 */
export async function runDryRunMode(opts) {
  const startedAt = new Date();
  const runId = buildRunId(startedAt);
  const { outputDir } = ensureOutputDirs(process.cwd());

  const profile = await loadProfile(opts.profile);

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

  const runResult = createRunResult({
    startedAt,
    runId,
    profile,
    profilePath: opts.profile,
  });

  for (const group of iterGroups(profile.getGroups())) {
    const groupResult = new GroupResult({ group_name: group.group_name, services: [] });
    for (const service of group.getServices()) {
      const serviceResult = new ServiceResult({
        service_name: service.service_name,
        human_label: service.human_label ?? service.service_name,
        dimensions: [],
        failed_step: null,
      });

      for (const dimension of service.getDimensions()) {
        serviceResult.addDimension(new DimensionResult({
          key: dimension.key,
          status: dimension.resolution_status === 'resolved'
            ? 'filled'
            : (dimension.resolution_status === 'skipped' ? 'skipped' : 'failed'),
          error_detail: dimension.resolution_status === 'unresolved' ? 'No resolved value' : null,
        }));
      }

      groupResult.addService(serviceResult);
    }
    runResult.addGroup(groupResult);
  }

  runResult.status = runResult.determineStatus();
  runResult.timestamp_end = new Date().toISOString();
  await writeRunResult(runResult, join(outputDir, 'run_result.json'));
  statusLine('ok', `Dry-run complete — profile resolved (${runResult.status})`);
  return runResult.status === 'partial_success' ? 2 : 0;
}
