import {
  DimensionResult,
  ServiceResult,
} from '../../core/models/run_result.js';
import { clickSave, navigateToService } from '../navigation/navigator.js';
import { runDimensionAutomation } from './dimension_runner.js';

function buildSearchTerms(service, catalog) {
  if (!catalog) {
    return [service.service_name];
  }

  return [
    catalog.search_term,
    catalog.service_name,
    catalog.calculator_page_title,
    ...(catalog.search_keywords || []),
  ].filter(Boolean);
}

/**
 * @param {{
 *   session: import('../session/browser_session.js').BrowserSession,
 *   group: any,
 *   service: any,
 *   catalog?: any,
 *   runId: string,
 *   screenshotsDir: string,
 * }} opts
 */
export async function runServiceAutomation(opts) {
  const { session, group, service, catalog, runId, screenshotsDir } = opts;

  const serviceResult = new ServiceResult({
    service_name: service.service_name,
    human_label: service.human_label ?? service.service_name,
    dimensions: [],
    failed_step: null,
  });

  const context = {
    runId,
    screenshotsDir,
    groupName: group.group_name,
    serviceName: service.service_name,
  };

  try {
    await navigateToService(session.page, {
      groupName: group.group_name,
      serviceName: service.service_name,
      searchTerms: buildSearchTerms(service, catalog),
      region: service.region,
      context,
      catalogEntry: catalog,
    });
  } catch (error) {
    serviceResult.failed_step = 'navigation';
    serviceResult.addDimension(new DimensionResult({
      key: '__navigation__',
      status: 'failed',
      error_detail: error.message,
    }));
    return serviceResult;
  }

  for (const dimension of service.getDimensions()) {
    const catalogDimension = catalog?.dimensions?.find((entry) => entry.key === dimension.key);
    serviceResult.addDimension(await runDimensionAutomation({
      session,
      dimension,
      catalogDimension,
      context,
    }));
  }

  try {
    await clickSave(session.page);
  } catch (error) {
    serviceResult.failed_step = 'save';
    serviceResult.addDimension(new DimensionResult({
      key: '__save__',
      status: 'failed',
      error_detail: error.message,
    }));
  }

  return serviceResult;
}
