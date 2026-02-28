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
import { logEvent as sharedLogEvent } from '../../core/index.js';
import { LOG_LEVELS } from '../../explorer/constants.js';

// ─── Logging helpers ──────────────────────────────────────────────────────────

const MODULE = 'automation/session/browser_session';

/**
 * Structured logger with key=value fields.
 *
 * @param {'INFO'|'WARNING'|'ERROR'|'CRITICAL'} level
 * @param {string} eventId
 * @param {string} eventType
 * @param {Record<string, unknown>} [fields]
 */
function logEvent(level, eventId, eventType, fields = {}) {
  sharedLogEvent(level, MODULE, eventType, { event_id: eventId, ...fields });
}

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
    this._timeout = opts.timeout ?? 30000;
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
        args: [
          '--disable-gpu',
          '--disable-dev-shm-usage',
        ],
      });

      this._context = await this._browser.newContext({
        viewport: { width: 1920, height: 1080 },
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      });

      this._page = await this._context.newPage();
      this._page.setDefaultTimeout(this._timeout);
      this._page.setDefaultNavigationTimeout(this._timeout);

      // Auto-dismiss native browser dialogs (alert/confirm/prompt/beforeunload)
      // These can block automation if left unhandled
      this._page.on('dialog', (dialog) => {
        dialog.dismiss().catch(() => {});
      });

      logEvent(LOG_LEVELS.INFO, 'EVT-BRW-01', 'browser_launched', {
        mode: this._headless ? 'headless' : 'headed',
      });
    } catch (error) {
      const message = `Failed to launch browser: ${error.message}`;
      logEvent(LOG_LEVELS.CRITICAL, 'EVT-BRW-02', 'browser_launch_failed', {
        error: message,
      });
      throw new AutomationFatalError(message, error);
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
      logEvent(LOG_LEVELS.ERROR, 'EVT-BRW-03', 'browser_stop_failed', {
        error: error.message,
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
  async openCalculator(url = 'https://calculator.aws/#/estimate') {
    if (!this._page) {
      throw new AutomationFatalError('Browser session not started. Call start() first.');
    }

    try {
      // Use domcontentloaded — networkidle never resolves on AWS Calculator
      // due to continuous background requests (analytics, polling)
      await this._page.goto(url, { waitUntil: 'domcontentloaded', timeout: this._timeout });

      // Auto-dismiss any consent / cookie dialogs before they block clicks
      await this._dismissDialogs().catch(() => {});

      // Wait for the React SPA to hydrate — poll for a stable interactive element
      await this._waitForSpaReady().catch(() => {});

      logEvent(LOG_LEVELS.INFO, 'EVT-NAV-01', 'page_navigated', { url });
    } catch (error) {
      const message = `Failed to navigate to calculator: ${error.message}`;
      logEvent(LOG_LEVELS.ERROR, 'EVT-NAV-02', 'page_load_failed', {
        error: message,
      });
      throw new AutomationFatalError(message, error);
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
    const dismissSelectors = [
      // AWS cookie consent
      "button#awsccc-cb-btn-accept",
      "button[data-id='awsccc-cb-btn-accept']",
      // Generic accept / close patterns
      "button:has-text('Accept')",
      "button:has-text('Accept all')",
      "button:has-text('I agree')",
      "button[aria-label='Close']",
      "[data-testid='cookie-accept-btn']",
    ];
    for (const sel of dismissSelectors) {
      try {
        const btn = this._page.locator(sel).first();
        if ((await btn.count()) > 0 && await btn.isVisible({ timeout: 1000 }).catch(() => false)) {
          await btn.click({ timeout: 2000, force: true }).catch(() => {});
          await this._page.waitForTimeout(300);
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
    // Any of these signals means the SPA is ready enough to interact with
    const readySelectors = [
      // Estimate page ready
      "button:has-text('Add service')",
      "button:has-text('Add a service')",
      // Add-service page ready
      "input[placeholder*='search' i]",
      "input[aria-label*='search' i]",
      "input[type='search']",
      // Generic calculator content loaded
      "[data-testid='calculator-header']",
      "[class*='awsui_app-layout']",
    ];
    const combined = readySelectors.join(', ');
    await this._page
      .waitForSelector(combined, { timeout: 15000, state: 'visible' })
      .catch(() => {
        // Timeout is acceptable — SPA may just be slow; continue anyway
      });
    // Brief pause to let React finish re-renders after selector appeared
    await this._page.waitForTimeout(500);
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
      logEvent(LOG_LEVELS.INFO, 'EVT-SCR-01', 'screenshot_captured', { path: outputPath });
    } catch (error) {
      const message = `Failed to take screenshot: ${error.message}`;
      logEvent(LOG_LEVELS.ERROR, 'EVT-SCR-02', 'screenshot_failed', { error: message });
      throw new AutomationFatalError(message, error);
    }
  }
}
