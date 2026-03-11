import { buildScreenshotPath } from '../../core/emitter/screenshot_manager.js';
import { DimensionResult } from '../../core/models/run_result.js';
import { fillDimension } from '../interactor/field_interactor.js';
import { findElement } from '../locator/find_in_page_locator.js';

async function captureUnresolvedDimension(page, context, dimensionKey) {
  if (!context.runId || !context.screenshotsDir) {
    return null;
  }

  try {
    const screenshotPath = buildScreenshotPath(
      context.screenshotsDir,
      context.runId,
      context.groupName,
      context.serviceName,
      `unresolved_${dimensionKey}`,
    );
    await page.screenshot({ path: screenshotPath });
    return screenshotPath;
  } catch {
    return null;
  }
}

/**
 * @param {{
 *   session: import('../session/browser_session.js').BrowserSession,
 *   dimension: any,
 *   catalogDimension?: any,
 *   context: Record<string, any>,
 * }} opts
 */
export async function runDimensionAutomation(opts) {
  const { session, dimension, catalogDimension, context } = opts;

  if (dimension.resolution_status === 'skipped') {
    return new DimensionResult({
      key: dimension.key,
      status: 'skipped',
    });
  }

  if (dimension.resolved_value === null || dimension.resolved_value === undefined) {
    const status = dimension.required ? 'failed' : 'skipped';
    return new DimensionResult({
      key: dimension.key,
      status,
      error_detail: status === 'failed' ? 'No resolved value' : null,
      screenshot_path: status === 'failed'
        ? await captureUnresolvedDimension(session.page, context, dimension.key)
        : null,
    });
  }

  const located = await findElement(session.page, dimension.key, {
    primaryCss: catalogDimension?.css_selector ?? null,
    fallbackLabel: catalogDimension?.fallback_label ?? null,
    disambiguationIndex: catalogDimension?.disambiguation_index ?? 0,
    required: dimension.required,
    maxRetries: 2,
    context,
  });

  if (located.status !== 'success' || !located.element) {
    return new DimensionResult({
      key: dimension.key,
      status: located.status === 'skipped' ? 'skipped' : 'failed',
      error_detail: located.status === 'failed' ? 'Locator failed' : null,
      screenshot_path: located.screenshotPath ?? null,
    });
  }

  const filled = await fillDimension(
    located.element,
    located.fieldType,
    String(dimension.resolved_value),
    {
      page: session.page,
      dimensionKey: dimension.key,
      required: dimension.required,
      maxRetries: 2,
    },
  );

  return new DimensionResult({
    key: dimension.key,
    status: filled.status === 'success'
      ? 'filled'
      : (filled.status === 'skipped' ? 'skipped' : 'failed'),
    error_detail: filled.status === 'failed' ? filled.message : null,
    screenshot_path: filled.screenshot ?? null,
  });
}
