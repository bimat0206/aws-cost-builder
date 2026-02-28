/**
 * Tests for automation/session/browser_session.js
 *
 * Covers:
 *   - BrowserSession lifecycle (start, stop)
 *   - Page getter and error handling
 *   - openCalculator navigation
 *   - currentUrl retrieval
 *   - isRunning status checks
 *   - AutomationFatalError handling
 *
 * Note: These tests use mocked Playwright to avoid actual browser launches
 * during unit testing. Integration tests should use real browser.
 *
 * Validates: Requirements 10.1, 10.5
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { BrowserSession, AutomationFatalError } from '../../../automation/session/browser_session.js';

// ─── Mock Playwright ──────────────────────────────────────────────────────────

// Mock the playwright module
vi.mock('playwright', () => {
  const mockPage = {
    goto: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    setDefaultTimeout: vi.fn(),
    setDefaultNavigationTimeout: vi.fn(),
    url: vi.fn().mockReturnValue('https://calculator.aws/#/estimate'),
    screenshot: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
  };

  const mockContext = {
    newPage: vi.fn().mockResolvedValue(mockPage),
    close: vi.fn().mockResolvedValue(undefined),
  };

  const mockBrowser = {
    newContext: vi.fn().mockResolvedValue(mockContext),
    close: vi.fn().mockResolvedValue(undefined),
  };

  const chromium = {
    launch: vi.fn().mockResolvedValue(mockBrowser),
  };

  return { chromium };
});

// Import playwright after mocking
import { chromium } from 'playwright';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Clear all mocks between tests.
 */
function clearMocks() {
  vi.clearAllMocks();
}

// ─── Unit Tests ───────────────────────────────────────────────────────────────

describe('automation/session/browser_session.js', () => {
  beforeEach(() => {
    clearMocks();
  });

  afterEach(async () => {
    clearMocks();
  });

  describe('BrowserSession constructor', () => {
    it('creates session with default options', () => {
      const session = new BrowserSession();
      expect(session._headless).toBe(false);
      expect(session._timeout).toBe(30000);
      expect(session._browser).toBeNull();
      expect(session._page).toBeNull();
    });

    it('creates session with custom headless option', () => {
      const session = new BrowserSession({ headless: true });
      expect(session._headless).toBe(true);
    });

    it('creates session with custom timeout', () => {
      const session = new BrowserSession({ timeout: 60000 });
      expect(session._timeout).toBe(60000);
    });

    it('creates session with all custom options', () => {
      const session = new BrowserSession({ headless: true, timeout: 45000 });
      expect(session._headless).toBe(true);
      expect(session._timeout).toBe(45000);
    });
  });

  describe('BrowserSession.start()', () => {
    it('launches browser with correct options', async () => {
      const session = new BrowserSession({ headless: true });
      await session.start();

      expect(chromium.launch).toHaveBeenCalledWith({
        headless: true,
        args: [
          '--disable-gpu',
          '--disable-dev-shm-usage',
        ],
      });
    });

    it('creates browser context with viewport and user agent', async () => {
      const session = new BrowserSession();
      await session.start();

      const mockBrowser = await chromium.launch();
      expect(mockBrowser.newContext).toHaveBeenCalledWith({
        viewport: { width: 1920, height: 1080 },
        userAgent: expect.stringContaining('Mozilla/5.0'),
      });
    });

    it('creates new page and sets timeouts', async () => {
      const session = new BrowserSession({ timeout: 45000 });
      await session.start();

      const mockBrowser = await chromium.launch();
      const mockContext = await mockBrowser.newContext();
      const mockPage = await mockContext.newPage();
      
      expect(mockContext.newPage).toHaveBeenCalled();
      expect(mockPage.setDefaultTimeout).toHaveBeenCalledWith(45000);
      expect(mockPage.setDefaultNavigationTimeout).toHaveBeenCalledWith(45000);
    });

    it('throws AutomationFatalError on launch failure', async () => {
      // Create a fresh mock that always rejects
      const originalLaunch = chromium.launch;
      chromium.launch = vi.fn().mockRejectedValue(new Error('Browser launch failed'));

      const session = new BrowserSession();
      await expect(session.start()).rejects.toThrow(AutomationFatalError);
      await expect(session.start()).rejects.toThrow('Failed to launch browser: Browser launch failed');

      // Restore
      chromium.launch = originalLaunch;
    });

    it('throws AutomationFatalError with cause on launch failure', async () => {
      const cause = new Error('Original error');
      chromium.launch.mockRejectedValueOnce(cause);

      const session = new BrowserSession();
      try {
        await session.start();
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(AutomationFatalError);
        expect(error.cause).toBe(cause);
      }
    });
  });

  describe('BrowserSession.stop()', () => {
    it('closes page, context, and browser in order', async () => {
      const session = new BrowserSession();
      await session.start();
      await session.stop();

      const mockBrowser = await chromium.launch();
      const mockContext = await mockBrowser.newContext();
      const mockPage = await mockContext.newPage();

      expect(mockPage.close).toHaveBeenCalled();
      expect(mockContext.close).toHaveBeenCalled();
      expect(mockBrowser.close).toHaveBeenCalled();
    });

    it('handles stop when browser not started', async () => {
      const session = new BrowserSession();
      // Should not throw
      await expect(session.stop()).resolves.toBeUndefined();
    });

    it('continues cleanup even if page close fails', async () => {
      const session = new BrowserSession();
      await session.start();

      const mockBrowser = await chromium.launch();
      const mockContext = await mockBrowser.newContext();
      const mockPage = await mockContext.newPage();

      mockPage.close.mockRejectedValueOnce(new Error('Page close failed'));

      // Should not throw, continues cleanup
      await expect(session.stop()).resolves.toBeUndefined();
      expect(mockContext.close).toHaveBeenCalled();
      expect(mockBrowser.close).toHaveBeenCalled();
    });

    it('logs error but does not throw on shutdown failure', async () => {
      const session = new BrowserSession();
      await session.start();

      const mockBrowser = await chromium.launch();
      mockBrowser.close.mockRejectedValueOnce(new Error('Browser close failed'));

      // Should not throw
      await expect(session.stop()).resolves.toBeUndefined();
    });
  });

  describe('BrowserSession.page getter', () => {
    it('returns page after start', async () => {
      const session = new BrowserSession();
      await session.start();

      const page = session.page;
      expect(page).toBeDefined();
      expect(page.goto).toBeDefined();
    });

    it('throws AutomationFatalError if called before start', () => {
      const session = new BrowserSession();
      expect(() => session.page).toThrow(AutomationFatalError);
      expect(() => session.page).toThrow('Browser session not started');
    });

    it('returns null after stop', async () => {
      const session = new BrowserSession();
      await session.start();
      await session.stop();

      // After stop, accessing page should throw
      expect(() => session.page).toThrow(AutomationFatalError);
    });
  });

  describe('BrowserSession.openCalculator()', () => {
    it('navigates to default URL', async () => {
      const session = new BrowserSession();
      await session.start();
      await session.openCalculator();

      const mockBrowser = await chromium.launch();
      const mockContext = await mockBrowser.newContext();
      const mockPage = await mockContext.newPage();

      expect(mockPage.goto).toHaveBeenCalledWith(
        'https://calculator.aws/#/estimate',
        { waitUntil: 'domcontentloaded', timeout: 30000 }
      );
    });

    it('navigates to custom URL', async () => {
      const session = new BrowserSession();
      await session.start();
      await session.openCalculator('https://calculator.aws/#/custom');

      const mockBrowser = await chromium.launch();
      const mockContext = await mockBrowser.newContext();
      const mockPage = await mockContext.newPage();

      expect(mockPage.goto).toHaveBeenCalledWith(
        'https://calculator.aws/#/custom',
        { waitUntil: 'domcontentloaded', timeout: 30000 }
      );
    });

    it('throws AutomationFatalError if called before start', async () => {
      const session = new BrowserSession();
      await expect(session.openCalculator()).rejects.toThrow(AutomationFatalError);
      await expect(session.openCalculator()).rejects.toThrow('Browser session not started');
    });

    it('throws AutomationFatalError on navigation failure', async () => {
      const session = new BrowserSession();
      await session.start();

      // Get the mock page and make goto always fail
      const mockBrowser = await chromium.launch();
      const mockContext = await mockBrowser.newContext();
      const mockPage = await mockContext.newPage();
      const originalGoto = mockPage.goto;
      mockPage.goto = vi.fn().mockRejectedValue(new Error('Navigation failed'));

      await expect(session.openCalculator()).rejects.toThrow(AutomationFatalError);
      await expect(session.openCalculator()).rejects.toThrow('Failed to navigate to calculator: Navigation failed');

      // Restore
      mockPage.goto = originalGoto;
    });
  });

  describe('BrowserSession.currentUrl()', () => {
    it('returns current page URL', async () => {
      const session = new BrowserSession();
      await session.start();

      const url = session.currentUrl();
      expect(url).toBe('https://calculator.aws/#/estimate');
    });

    it('throws AutomationFatalError if called before start', () => {
      const session = new BrowserSession();
      expect(() => session.currentUrl()).toThrow(AutomationFatalError);
      expect(() => session.currentUrl()).toThrow('Browser session not started');
    });
  });

  describe('BrowserSession.isRunning()', () => {
    it('returns false before start', () => {
      const session = new BrowserSession();
      expect(session.isRunning()).toBe(false);
    });

    it('returns true after start', async () => {
      const session = new BrowserSession();
      await session.start();
      expect(session.isRunning()).toBe(true);
    });

    it('returns false after stop', async () => {
      const session = new BrowserSession();
      await session.start();
      await session.stop();
      expect(session.isRunning()).toBe(false);
    });
  });

  describe('BrowserSession.screenshot()', () => {
    it('takes screenshot and saves to path', async () => {
      const session = new BrowserSession();
      await session.start();
      await session.screenshot('/tmp/test.png');

      const mockBrowser = await chromium.launch();
      const mockContext = await mockBrowser.newContext();
      const mockPage = await mockContext.newPage();

      expect(mockPage.screenshot).toHaveBeenCalledWith({
        path: '/tmp/test.png',
        fullPage: false,
      });
    });

    it('throws AutomationFatalError if called before start', async () => {
      const session = new BrowserSession();
      await expect(session.screenshot('/tmp/test.png')).rejects.toThrow(AutomationFatalError);
      await expect(session.screenshot('/tmp/test.png')).rejects.toThrow('Browser session not started');
    });

    it('throws AutomationFatalError on screenshot failure', async () => {
      const session = new BrowserSession();
      await session.start();

      // Get the mock page and make screenshot always fail
      const mockBrowser = await chromium.launch();
      const mockContext = await mockBrowser.newContext();
      const mockPage = await mockContext.newPage();
      const originalScreenshot = mockPage.screenshot;
      mockPage.screenshot = vi.fn().mockRejectedValue(new Error('Screenshot failed'));

      await expect(session.screenshot('/tmp/test.png')).rejects.toThrow(AutomationFatalError);
      await expect(session.screenshot('/tmp/test.png')).rejects.toThrow('Failed to take screenshot: Screenshot failed');

      // Restore
      mockPage.screenshot = originalScreenshot;
    });
  });

  describe('AutomationFatalError', () => {
    it('creates error with message', () => {
      const error = new AutomationFatalError('Test error');
      expect(error.name).toBe('AutomationFatalError');
      expect(error.message).toBe('Test error');
      expect(error.cause).toBeNull();
    });

    it('creates error with message and cause', () => {
      const cause = new Error('Original error');
      const error = new AutomationFatalError('Test error', cause);
      expect(error.name).toBe('AutomationFatalError');
      expect(error.message).toBe('Test error');
      expect(error.cause).toBe(cause);
    });

    it('is instance of Error', () => {
      const error = new AutomationFatalError('Test error');
      expect(error).toBeInstanceOf(Error);
    });
  });

  describe('Integration: Full lifecycle', () => {
    it('completes full start -> use -> stop lifecycle', async () => {
      const session = new BrowserSession({ headless: true });

      // Start
      await session.start();
      expect(session.isRunning()).toBe(true);
      expect(session.page).toBeDefined();

      // Use
      await session.openCalculator('https://calculator.aws/#/test');
      expect(session.currentUrl()).toBe('https://calculator.aws/#/estimate');

      // Stop
      await session.stop();
      expect(session.isRunning()).toBe(false);
    });

    it('cleans up properly on error during use', async () => {
      const session = new BrowserSession();
      await session.start();

      // Simulate error during use
      const mockBrowser = await chromium.launch();
      const mockContext = await mockBrowser.newContext();
      const mockPage = await mockContext.newPage();
      mockPage.goto.mockRejectedValueOnce(new Error('Navigation failed'));

      try {
        await session.openCalculator();
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(AutomationFatalError);
      }

      // Should still be able to stop
      await session.stop();
      expect(session.isRunning()).toBe(false);
    });
  });
});
