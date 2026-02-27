/**
 * Interactive explorer wizard (Mode C).
 *
 * Uses the phased core pipeline:
 * phase1_search -> phase2_context -> phase3_sections -> phase4_dimensions -> phase5_draft.
 *
 * @module explorer/wizard/interactive_explorer
 */

import * as readline from 'node:readline';
import { runExploration } from '../core/run.js';
import { resolveExplorerOutputPaths } from '../draft/draft_writer.js';
import { slugifyServiceId } from '../utils.js';

/**
 * Prompt for user input.
 *
 * @param {string} question
 * @param {string} [defaultAnswer]
 * @returns {Promise<string>}
 */
async function prompt(question, defaultAnswer = '') {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    const suffix = defaultAnswer ? ` [${defaultAnswer}]` : '';
    rl.question(`${question}${suffix} `, (answer) => {
      rl.close();
      const cleaned = answer.trim();
      resolve(cleaned || defaultAnswer);
    });
  });
}

/**
 * Run interactive explorer flow.
 *
 * @param {{ root: string, serviceName?: string, headless?: boolean, cardIndex?: number|null }} opts
 * @returns {Promise<{ draftPath: string, reportPath: string, notesPath: string }|null>}
 */
export async function runInteractiveExplorer(opts = {}) {
  const { root, serviceName, headless = false, cardIndex = null } = opts;

  console.log('\n=== AWS Cost Builder - Explore Mode (Mode C) ===\n');

  let humanServiceName = serviceName;
  if (!humanServiceName) {
    humanServiceName = await prompt('What AWS service do you want to onboard?');
  }

  if (!humanServiceName) {
    console.log('[!] Service name is required.');
    return null;
  }

  const suggestedId = slugifyServiceId(humanServiceName);
  const serviceId = await prompt('Service ID for draft output?', suggestedId);

  if (!serviceId) {
    console.log('[!] Service ID is required.');
    return null;
  }

  console.log('\nStarting phased exploration...');

  const result = await runExploration({
    root,
    serviceName: humanServiceName,
    serviceId,
    headless,
    cardIndex,
  });

  const paths = resolveExplorerOutputPaths(serviceId, root);

  console.log('\nExploration complete.');
  console.log(`- Draft: ${paths.draftPath}`);
  console.log(`- Report: ${result.reportPath}`);
  console.log(`- Review notes: ${result.notesPath}`);
  console.log(`- States explored: ${(result.stateTracker?.states || []).length}`);
  console.log(`- Dimensions: total=${result.summary.total}, confident=${result.summary.confident}, unknown=${result.summary.unknown}`);

  return {
    draftPath: paths.draftPath,
    reportPath: result.reportPath,
    notesPath: result.notesPath,
  };
}
