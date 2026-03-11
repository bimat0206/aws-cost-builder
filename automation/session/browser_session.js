/**
 * Browser session — Playwright lifecycle management.
 *
 * Owns Playwright browser startup/shutdown and page lifecycle.
 * Emits EVT-BRW-01 (browser_launched) and EVT-BRW-02 (browser_launch_failed)
 * structured log events.
 * Throws AutomationFatalError on browser launch failure.
 *
 * @module automation/session/browser_session
 */

import { chromium } from 'playwright';
import { getAppRuntimeConfig, getAutomationRuntimeConfig } from '../../config/runtime/index.js';
import { createModuleLogger } from '../../core/logger/index.js';

const MODULE = 'automation/session/browser_session';
const appConfig = getAppRuntimeConfig();
const automationConfig = getAutomationRuntimeConfig();
const browserConfig = automationConfig.browser;
const logger = createModuleLogger(MODULE);

// ─── Error types ──────────────────────────────────────────────────────────────

/**
 * Fatal error during browser automation.
 * Thrown when browser launch fails or other unrecoverable errors occur.
 */
export class AutomationFatalError extends Error {
  /**
   * @param {string} message
   * @param {Error} [cause]
   */
  constructor(message, cause = null) {
    super(message);
    this.name = 'AutomationFatalError';
    this.cause = cause;
  }
}

// ─── Browser session ──────────────────────────────────────────────────────────

/**
 * Manages a Playwright Chromium browser session.
 *
 * Lifecycle:
 *   1. Create instance with optional headless flag
 *   2. Call start() to launch browser and create page
 *   3. Use page getter to access Playwright Page object
 *   4. Call stop() to close browser and clean up
 */
export class BrowserSession {
  /**
   * Create a new browser session.
   *
   * Supports both:
   * - `new BrowserSession(true)` (headless flag per design signature), and
   * - `new BrowserSession({ headless: true, timeout: 45000 })`
   *
   * @param {boolean|{headless?: boolean, timeout?: number}} [optsOrHeadless=false]
   */
  constructor(optsOrHeadless = false) {
    const opts = typeof optsOrHeadless === 'boolean'
      ? { headless: optsOrHeadless }
      : (optsOrHeadless ?? {});

    this._headless = opts.headless ?? false;
    this._timeout = opts.timeout ?? browserConfig.defaultTimeoutMs;
    this._browser = null;
    this._page = null;
    this._context = null;
  }

  /**
   * Launch the Playwright Chromium browser.
   *
   * Emits EVT-BRW-01 on successful launch.
   * Throws AutomationFatalError on launch failure.
   *
   * @returns {Promise<void>}
   * @throws {AutomationFatalError} If browser launch fails
   */
  async start() {
    try {
      this._browser = await chromium.launch({
        headless: this._headless,
        args: browserConfig.launchArgs,
      });

      this._context = await this._browser.newContext({
        viewport: browserConfig.viewport,
        userAgent: browserConfig.userAgent,
      });

      this._page = await this._context.newPage();
      this._page.setDefaultTimeout(this._timeout);
      this._page.setDefaultNavigationTimeout(this._timeout);

      // Auto-dismiss native browser dialogs (alert/confirm/prompt/beforeunload)
      // These can block automation if left unhandled
      this._page.on('dialog', (dialog) => {
        dialog.dismiss().catch(() => {});
      });

      logger.info('browser_launched', {
        event_id: 'EVT-BRW-01',
        mode: this._headless ? 'headless' : 'headed',
        timeout_ms: this._timeout,
        viewport: browserConfig.viewport,
      });
    } catch (error) {
      logger.critical('browser_launch_failed', {
        event_id: 'EVT-BRW-02',
        mode: this._headless ? 'headless' : 'headed',
        timeout_ms: this._timeout,
        error,
      });
      throw new AutomationFatalError(`Failed to launch browser: ${error.message}`, error);
    }
  }

  /**
   * Close the browser and clean up resources.
   *
   * @returns {Promise<void>}
   */
  async stop() {
    try {
      if (this._page) {
        await this._page.close().catch(() => {});
        this._page = null;
      }

      if (this._context) {
        await this._context.close().catch(() => {});
        this._context = null;
      }

      if (this._browser) {
        await this._browser.close().catch(() => {});
        this._browser = null;
      }
    } catch (error) {
      logger.error('browser_stop_failed', {
        event_id: 'EVT-BRW-03',
        error,
      });
      // Don't throw on shutdown errors - we're cleaning up anyway
    }
  }

  /**
   * Get the Playwright Page object.
   *
   * @returns {import('playwright').Page|null} The page object, or null if not started
   * @throws {AutomationFatalError} If called before start()
   */
  get page() {
    if (!this._page) {
      throw new AutomationFatalError('Browser session not started. Call start() first.');
    }
    return this._page;
  }

  /**
   * Navigate to the AWS Calculator.
   *
   * Uses 'domcontentloaded' instead of 'networkidle' because the AWS Calculator
   * has continuous background network activity (analytics, polling) that prevents
   * networkidle from ever resolving, causing page timeouts.
   *
   * After navigation, auto-dismisses any consent/cookie dialogs and waits for
   * the SPA to hydrate by polling for key UI elements.
   *
   * @param {string} [url] - The URL to navigate to (default: https://calculator.aws/#/estimate)
   * @returns {Promise<void>}
   * @throws {AutomationFatalError} If navigation fails
   */
  async openCalculator(url = appConfig.calculator.baseUrl) {
    if (!this._page) {
      throw new AutomationFatalError('Browser session not started. Call start() first.');
    }

    try {
      // Use domcontentloaded — networkidle never resolves on AWS Calculator
      // due to continuous background requests (analytics, polling)
      await this._page.goto(url, { waitUntil: browserConfig.navigationWaitUntil, timeout: this._timeout });

      // Auto-dismiss any consent / cookie dialogs before they block clicks
      await this._dismissDialogs().catch(() => {});

      // Wait for the React SPA to hydrate — poll for a stable interactive element
      await this._waitForSpaReady().catch(() => {});

      logger.info('page_navigated', {
        event_id: 'EVT-NAV-01',
        url,
        wait_until: browserConfig.navigationWaitUntil,
        timeout_ms: this._timeout,
      });
    } catch (error) {
      logger.error('page_load_failed', {
        event_id: 'EVT-NAV-02',
        url,
        wait_until: browserConfig.navigationWaitUntil,
        timeout_ms: this._timeout,
        error,
      });
      throw new AutomationFatalError(`Failed to navigate to calculator: ${error.message}`, error);
    }
  }

  /**
   * Dismiss consent/cookie dialogs that can appear on AWS Calculator.
   * Silently swallows errors — dialogs may not be present.
   *
   * @returns {Promise<void>}
   */
  async _dismissDialogs() {
    if (!this._page) return;
    for (const selector of browserConfig.dialogDismiss.selectors) {
      try {
        const button = this._page.locator(selector).first();
        if ((await button.count()) > 0
          && await button.isVisible({ timeout: browserConfig.dialogDismiss.visibleTimeoutMs }).catch(() => false)) {
          await button.click({ timeout: browserConfig.dialogDismiss.clickTimeoutMs, force: true }).catch(() => {});
          await this._page.waitForTimeout(browserConfig.dialogDismiss.pauseMs);
        }
      } catch {
        // Ignore — dialog may not be present
      }
    }
  }

  /**
   * Wait for the AWS Calculator SPA to be interactable.
   *
   * Polls for elements that indicate the React app has mounted and rendered.
   * Times out gracefully after 15 s — caller should still attempt interaction.
   *
   * @returns {Promise<void>}
   */
  async _waitForSpaReady() {
    if (!this._page) return;
    const combined = browserConfig.spaReady.selectors.join(', ');
    await this._page
      .waitForSelector(combined, { timeout: browserConfig.spaReady.visibleTimeoutMs, state: 'visible' })
      .catch(() => {
        // Timeout is acceptable — SPA may just be slow; continue anyway
      });
    // Brief pause to let React finish re-renders after selector appeared
    await this._page.waitForTimeout(browserConfig.spaReady.pauseMs);
  }

  /**
   * Get the current page URL.
   *
   * @returns {string} The current URL
   * @throws {AutomationFatalError} If called before start()
   */
  currentUrl() {
    if (!this._page) {
      throw new AutomationFatalError('Browser session not started. Call start() first.');
    }
    return this._page.url();
  }

  /**
   * Check if the browser session is active.
   *
   * @returns {boolean} True if browser is running
   */
  isRunning() {
    return this._browser !== null && this._page !== null;
  }

  /**
   * Take a screenshot of the current page.
   *
   * @param {string} outputPath - Path to save the screenshot
   * @returns {Promise<void>}
   * @throws {AutomationFatalError} If screenshot fails
   */
  async screenshot(outputPath) {
    if (!this._page) {
      throw new AutomationFatalError('Browser session not started. Call start() first.');
    }

    try {
      await this._page.screenshot({ path: outputPath, fullPage: false });
      logger.info('screenshot_captured', {
        event_id: 'EVT-SCR-01',
        path: outputPath,
        full_page: false,
      });
    } catch (error) {
      logger.error('screenshot_failed', {
        event_id: 'EVT-SCR-02',
        path: outputPath,
        error,
      });
      throw new AutomationFatalError(`Failed to take screenshot: ${error.message}`, error);
    }
  }
}
