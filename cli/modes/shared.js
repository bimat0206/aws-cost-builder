import { basename } from 'node:path';
import { getAppRuntimeConfig } from '../../config/runtime/index.js';
import { RunResult } from '../../core/models/run_result.js';

const appConfig = getAppRuntimeConfig();

export function profileDisplayName(profile, profilePath) {
  return profile.project_name ?? basename(profilePath).replace(/\.(json|hcl)$/i, '');
}

export function createRunResult({ startedAt, runId, profile, profilePath }) {
  return new RunResult({
    run_id: runId,
    profile_name: profileDisplayName(profile, profilePath),
    status: 'success',
    timestamp_start: startedAt.toISOString(),
    timestamp_end: startedAt.toISOString(),
    calculator_url: appConfig.calculator.baseUrl,
    groups: [],
  });
}
