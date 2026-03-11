import { COL_CYAN } from '../../builder/layout/colors.js';
import { fg, dim } from '../../builder/layout/components.js';
import { getCliRuntimeConfig } from '../../config/runtime/index.js';
import { promoteDraft } from '../../drafts/promoter.js';
import { promptForInput } from '../prompts.js';
import { print } from '../ui.js';

const cliConfig = getCliRuntimeConfig();

/**
 * @returns {Promise<number>}
 */
export async function runPromoteMode() {
  print(`  ${dim(cliConfig.messages.promote.title)}`);
  const serviceId = await promptForInput(
    `  ${fg('›', COL_CYAN)} `,
    { required: true, errorMsg: cliConfig.messages.promote.requiredError },
  );
  const result = await promoteDraft(serviceId, process.cwd());
  return result ? 0 : 1;
}
