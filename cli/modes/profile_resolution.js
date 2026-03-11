import {
  ResolutionError,
  applyOverrides,
  assertNoUnresolved,
  resolveDimensions,
} from '../../core/resolver/priority_chain.js';

/**
 * @param {{ profile: any, overrides: Map<string, string> }} opts
 */
export function resolveProfileInputs(opts) {
  applyOverrides(opts.profile, opts.overrides);
  const { unresolved } = resolveDimensions(opts.profile);
  assertNoUnresolved(unresolved);
  return opts.profile;
}

export { ResolutionError };
