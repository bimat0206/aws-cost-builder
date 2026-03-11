import { readFileSync } from 'node:fs';
import { load } from 'js-yaml';

const configCache = new Map();

function readYamlConfig(filename) {
  if (configCache.has(filename)) {
    return configCache.get(filename);
  }

  const fileUrl = new URL(`./${filename}`, import.meta.url);
  const parsed = load(readFileSync(fileUrl, 'utf8'));
  configCache.set(filename, parsed);
  return parsed;
}

export function getAppRuntimeConfig() {
  return readYamlConfig('app.yaml');
}

export function getCliRuntimeConfig() {
  return readYamlConfig('cli.yaml');
}

export function getAutomationRuntimeConfig() {
  return readYamlConfig('automation.yaml');
}

export function interpolateTemplate(template, values = {}) {
  return String(template).replace(/\{(\w+)\}/g, (_, key) => String(values[key] ?? ''));
}
