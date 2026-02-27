/**
 * Service prompt policy registry.
 * Full implementation in task 12.1.
 */

/** @type {Map<string, { shouldPrompt: (dimKey: string, dimensions: object) => boolean }>} */
const _registry = new Map();

const _defaultPolicy = {
  shouldPrompt: (_dimKey, _dimensions) => true,
};

/**
 * Get the prompt policy for a service.
 * @param {string} serviceName
 * @returns {{ shouldPrompt: (dimKey: string, dimensions: object) => boolean }}
 */
export function getPromptPolicy(serviceName) {
  return _registry.get(serviceName) ?? _defaultPolicy;
}

/**
 * Register a custom prompt policy for a service.
 * @param {string} serviceName
 * @param {{ shouldPrompt: (dimKey: string, dimensions: object) => boolean }} policy
 */
export function registerPromptPolicy(serviceName, policy) {
  _registry.set(serviceName, policy);
}
