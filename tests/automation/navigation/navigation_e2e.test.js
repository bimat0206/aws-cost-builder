/**
 * End-to-end test for automation navigation flow.
 *
 * Tests the complete flow:
 * 1. Launch browser
 * 2. Navigate to calculator
 * 3. Create group
 * 4. Add service
 * 5. Select region
 *
 * This test uses REAL browser automation (not mocks) to verify the flow works.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import { BrowserSession } from '../../../automation/session/browser_session.js';
import { ensureGroup } from '../../../automation/navigation/group_manager.js';
import { navigateToService } from '../../../automation/navigation/navigator.js';

describe('automation/navigation E2E', () => {
  let browser: Browser;
  let page: Page;
  let session: BrowserSession;

  beforeAll(async () => {
    // Launch real browser
    session = new BrowserSession({ headless: true });
    await session.start();
    page = session.page;

    // Navigate to calculator
    await session.openCalculator();
  }, 30000);

  afterAll(async () => {
    await session.stop();
  }, 30000);

  describe('Group Creation E2E', () => {
    it('creates a new group successfully', async () => {
      const groupName = `Test Group ${Date.now()}`;

      // This should not throw
      await expect(ensureGroup(page, groupName)).resolves.not.toThrow();
    }, 30000);

    it('selects existing group', async () => {
      const groupName = `Test Group ${Date.now()}`;

      // Create first
      await ensureGroup(page, groupName);

      // Select again (should not create duplicate)
      await expect(ensureGroup(page, groupName)).resolves.not.toThrow();
    }, 30000);
  });

  describe('Service Navigation E2E', () => {
    it('navigates to Amazon S3 with region selection', async () => {
      const groupName = `E2E Test Group ${Date.now()}`;

      // Navigate to S3
      await navigateToService(page, {
        groupName,
        serviceName: 'Amazon S3',
        searchTerm: 'Amazon S3',
        region: 'us-west-2',
      });

      // Verify we're on S3 configuration page
      const pageTitle = await page.title();
      expect(pageTitle).toContain('S3');
    }, 60000);

    it('navigates to CloudFront (global service, no region)', async () => {
      const groupName = `E2E Global Test ${Date.now()}`;

      // Navigate to CloudFront (global service)
      await navigateToService(page, {
        groupName,
        serviceName: 'CloudFront',
        searchTerm: 'CloudFront',
        region: 'global',
      });

      // Verify we're on CloudFront configuration page
      const pageTitle = await page.title();
      expect(pageTitle).toContain('CloudFront');
    }, 60000);

    it('navigates to EC2 with multiple search terms', async () => {
      const groupName = `E2E EC2 Test ${Date.now()}`;

      // Navigate to EC2
      await navigateToService(page, {
        groupName,
        serviceName: 'Amazon EC2',
        searchTerm: 'Amazon EC2',
        region: 'us-east-1',
      });

      // Verify we're on EC2 configuration page
      const pageTitle = await page.title();
      expect(pageTitle).toContain('EC2');
    }, 60000);
  });

  describe('Recovery Flow E2E', () => {
    it('recovers from bad state when Create group button not found', async () => {
      const groupName = `E2E Recovery Test ${Date.now()}`;

      // First, navigate to a service page (leaves group creation context)
      await page.goto('https://calculator.aws/#/addService', { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(1000);

      // Now try to create group (should trigger recovery)
      await expect(ensureGroup(page, groupName)).resolves.not.toThrow();
    }, 60000);
  });
});
