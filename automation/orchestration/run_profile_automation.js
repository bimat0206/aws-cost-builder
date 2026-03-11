import { GroupResult } from '../../core/models/run_result.js';
import { iterGroups } from '../../core/profile/group_iteration.js';
import {
  AutomationFatalError,
  BrowserSession,
} from '../session/browser_session.js';
import { runServiceAutomation } from './service_runner.js';

/**
 * @param {{
 *   profile: any,
 *   runId: string,
 *   screenshotsDir: string,
 *   headless: boolean,
 *   runResult: import('../../core/models/run_result.js').RunResult,
 *   catalogByService: Map<string, any>,
 *   onFatalError?: (error: Error) => void,
 * }} opts
 */
export async function runProfileAutomation(opts) {
  const session = new BrowserSession({ headless: Boolean(opts.headless) });

  try {
    await session.start();
    await session.openCalculator();

    for (const group of iterGroups(opts.profile.getGroups())) {
      const groupResult = new GroupResult({
        group_name: group.group_name,
        services: [],
      });

      for (const service of group.getServices()) {
        const catalog = opts.catalogByService.get(service.service_name);
        const serviceResult = await runServiceAutomation({
          session,
          group,
          service,
          catalog,
          runId: opts.runId,
          screenshotsDir: opts.screenshotsDir,
        });
        groupResult.addService(serviceResult);
      }

      opts.runResult.addGroup(groupResult);
    }

    opts.runResult.calculator_url = session.currentUrl();
    opts.runResult.status = opts.runResult.determineStatus();
  } catch (error) {
    if (error instanceof AutomationFatalError) {
      opts.runResult.status = 'failed';
      opts.onFatalError?.(error);
      return;
    }

    opts.runResult.status = 'failed';
    throw error;
  } finally {
    await session.stop();
  }
}
