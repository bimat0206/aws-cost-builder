import * as readline from 'node:readline';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { COL_CYAN } from '../builder/layout/colors.js';
import { dim, fg } from '../builder/layout/components.js';
import { getAppRuntimeConfig, getCliRuntimeConfig } from '../config/runtime/index.js';
import { selectPrompt } from '../builder/prompts/select_prompt.js';
import { MODE_OPTIONS } from './mode_options.js';
import { print, printSplash, renderModeChoice, statusLine } from './ui.js';

const appConfig = getAppRuntimeConfig();
const cliConfig = getCliRuntimeConfig();

function profilePromptLabel() {
  return `  ${dim(cliConfig.prompts.profilePromptLabel)} ${fg('›', COL_CYAN)} `;
}

/**
 * @param {string} label
 * @param {{ required?: boolean, errorMsg?: string }} [opts]
 * @returns {Promise<string>}
 */
export async function promptForInput(label, opts = {}) {
  const { required = false, errorMsg = 'A value is required.' } = opts;
  if (!process.stdin.isTTY || !process.stdout.isTTY) return '';

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    while (true) {
      const answer = await new Promise((resolve) => {
        rl.question(label, (value) => resolve(value.trim()));
      });

      if (!required || answer.length > 0) {
        return answer;
      }

      statusLine('warn', errorMsg);
    }
  } finally {
    rl.close();
  }
}

async function resolveProfileSelection(cwd) {
  try {
    const profilesDir = join(cwd, appConfig.paths.profilesDirName);
    const files = await readdir(profilesDir).catch(() => []);
    const profileFiles = files.filter((file) => file.endsWith('.json') || file.endsWith('.hcl'));

    if (profileFiles.length === 0) {
      return await promptForInput(
        profilePromptLabel(),
        { required: true, errorMsg: cliConfig.prompts.profileRequiredError },
      );
    }

    const profileOptions = profileFiles.map((file) => ({
      display: file,
      path: join('profiles', file),
    }));

    const selectedProfile = await selectPrompt({
      label: cliConfig.prompts.profileSelectLabel,
      options: profileOptions.map((option) => option.display),
      defaultValue: profileOptions[0].display,
      descriptions: {},
    });

    return profileOptions.find((option) => option.display === selectedProfile)?.path
      ?? join(appConfig.paths.profilesDirName, profileFiles[0]);
  } catch {
    return await promptForInput(
      profilePromptLabel(),
      { required: true, errorMsg: cliConfig.prompts.profileRequiredError },
    );
  }
}

/**
 * @param {{ cwd?: string }} [opts]
 * @returns {Promise<{ mode: string, profile?: string, headless?: boolean }>}
 */
export async function promptInteractiveModeSelection(opts = {}) {
  const cwd = opts.cwd ?? process.cwd();
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error(cliConfig.prompts.nonInteractiveModeError);
  }

  printSplash();

  const displayOptions = MODE_OPTIONS.map((option) => ({
    id: option.id,
    display: renderModeChoice(option),
  }));

  const selectedDisplay = await selectPrompt({
    label: cliConfig.prompts.modeSelectLabel,
    options: displayOptions.map((option) => option.display),
    defaultValue: displayOptions[0].display,
    descriptions: {},
  });

  const selectedOption = displayOptions.find((option) => option.display === selectedDisplay) ?? displayOptions[0];
  const result = { mode: selectedOption.id };

  print('');

  if (result.mode === 'run' || result.mode === 'dryRun') {
    result.profile = await resolveProfileSelection(cwd);
  }

  if (result.mode === 'run') {
    const headlessOptions = cliConfig.prompts.headlessOptions;
    const headlessLabel = await selectPrompt({
      label: cliConfig.prompts.headlessSelectLabel,
      options: headlessOptions.map((option) => option.label),
      defaultValue: headlessOptions[0].label,
      descriptions: {},
    });
    result.headless = headlessOptions.find((option) => option.label === headlessLabel)?.headless ?? false;
  }

  print('');
  return result;
}
