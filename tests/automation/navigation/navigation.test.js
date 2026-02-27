/**
 * Tests for automation/navigation/ module.
 *
 * Covers:
 *   - group_manager.js: Group creation and selection
 *   - navigator.js: Service/region navigation orchestration
 *
 * Validates: Requirements 10.2, 10.3, 10.6
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  ensureGroup,
  getCurrentGroup,
  deleteGroup,
} from '../../../automation/navigation/group_manager.js';
import {
  navigateToService,
  getCurrentService,
} from '../../../automation/navigation/navigator.js';

// ─── Mock Playwright ──────────────────────────────────────────────────────────

vi.mock('playwright', () => {
  return { chromium: { launch: vi.fn() } };
});

// ─── Mock retry wrapper ───────────────────────────────────────────────────────

vi.mock('../../../core/retry/retry_wrapper.js', () => {
  return {
    withRetry: vi.fn(async (fn) => fn()),
    withRetryResult: vi.fn(async (fn) => {
      try {
        const value = await fn();
        return { success: true, value };
      } catch (error) {
        return { success: false, skipped: false, error };
      }
    }),
  };
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Create a mock page with query and interaction methods.
 */
function createMockPage() {
  const elements = new Map();

  const page = {
    $: vi.fn(async (selector) => {
      return elements.get(selector) || null;
    }),
    $$: vi.fn(async (selector) => {
      const el = elements.get(selector);
      return el ? [el] : [];
    }),
    waitForTimeout: vi.fn().mockResolvedValue(undefined),
    evaluate: vi.fn(),
  };

  return { page, elements };
}

/**
 * Create a mock element handle.
 */
function createMockElement(options = {}) {
  return {
    click: vi.fn().mockResolvedValue(undefined),
    fill: vi.fn().mockResolvedValue(undefined),
    textContent: vi.fn().mockResolvedValue(options.textContent || ''),
    evaluate: vi.fn().mockResolvedValue(options.evaluateValue || null),
    boundingBox: vi.fn().mockResolvedValue(options.boundingBox || null),
  };
}

// ─── Unit Tests: group_manager.js ─────────────────────────────────────────────

describe('automation/navigation/group_manager.js', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('ensureGroup()', () => {
    it('creates group if it does not exist', async () => {
      const { page, elements } = createMockPage();

      // Group doesn't exist initially
      elements.set('[data-testid="group-name"]:has-text("Test Group")', null);

      // Mock add group button
      const addGroupButton = createMockElement();
      elements.set('[data-testid="add-group-button"],button:has-text("Add group")', addGroupButton);

      // Mock name input
      const nameInput = createMockElement();
      elements.set('[data-testid="group-name-input"], input[placeholder*="group name" i]', nameInput);

      // Mock create button
      const createButton = createMockElement();
      elements.set('[data-testid="create-group-confirm"], button:has-text("Create"), button:has-text("Add")', createButton);

      await ensureGroup(page, 'Test Group');

      expect(addGroupButton.click).toHaveBeenCalled();
      expect(nameInput.fill).toHaveBeenCalledWith('Test Group');
      expect(createButton.click).toHaveBeenCalled();
    });

    it('selects group if it already exists', async () => {
      const { page, elements } = createMockPage();

      // Group exists
      const groupElement = createMockElement();
      elements.set('[data-testid="group-item"]:has-text("Existing Group")', groupElement);
      elements.set('[data-testid="group-name"]:has-text("Existing Group")', groupElement);

      await ensureGroup(page, 'Existing Group');

      expect(groupElement.click).toHaveBeenCalled();
    });
  });

  describe('getCurrentGroup()', () => {
    it('returns current group name', async () => {
      const { page, elements } = createMockPage();

      const activeGroup = createMockElement({ textContent: 'Current Group' });
      const nameElement = createMockElement({ textContent: 'Current Group' });
      activeGroup.$ = vi.fn().mockResolvedValue(nameElement);

      elements.set('[data-testid="group-item"][aria-selected="true"], .group-item.active', activeGroup);

      const groupName = await getCurrentGroup(page);

      expect(groupName).toBe('Current Group');
    });

    it('returns null if no active group', async () => {
      const { page, elements } = createMockPage();

      elements.set('[data-testid="group-item"][aria-selected="true"], .group-item.active', null);

      const groupName = await getCurrentGroup(page);

      expect(groupName).toBeNull();
    });
  });

  describe('deleteGroup()', () => {
    it('deletes existing group', async () => {
      const { page, elements } = createMockPage();

      const groupElement = createMockElement();
      const menuButton = createMockElement();
      const deleteOption = createMockElement();
      const confirmButton = createMockElement();

      groupElement.$ = vi.fn()
        .mockResolvedValueOnce(menuButton)
        .mockResolvedValueOnce(null);
      elements.set('[data-testid="group-item"]:has-text("Delete Me")', groupElement);
      elements.set('[data-testid="group-menu-button"], .group-actions button', menuButton);
      elements.set('[data-testid="delete-group-option"], button:has-text("Delete")', deleteOption);
      elements.set('[data-testid="confirm-delete"], button:has-text("Delete")', confirmButton);

      await deleteGroup(page, 'Delete Me');

      expect(menuButton.click).toHaveBeenCalled();
      expect(deleteOption.click).toHaveBeenCalled();
      expect(confirmButton.click).toHaveBeenCalled();
    });

    it('does not throw if group not found', async () => {
      const { page, elements } = createMockPage();

      elements.set('[data-testid="group-item"]:has-text("NonExistent")', null);

      await expect(deleteGroup(page, 'NonExistent')).resolves.toBeUndefined();
    });
  });
});

// ─── Unit Tests: navigator.js ────────────────────────────────────────────────

describe('automation/navigation/navigator.js', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('navigateToService()', () => {
    it('navigates through all steps for regional service', async () => {
      const { page, elements } = createMockPage();

      // Mock all required elements
      const addServiceButton = createMockElement();
      const searchInput = createMockElement();
      const serviceCard = createMockElement();
      const regionSelector = createMockElement();

      elements.set('[data-testid="add-service-button"], button:has-text("Add service"), button:has-text("Add a service")', addServiceButton);
      elements.set('[data-testid="service-search-input"], input[placeholder*="search services" i], input[type="search"]', searchInput);
      elements.set('[data-testid="service-card"]:has-text("Amazon EC2"), .service-card:has-text("Amazon EC2")', serviceCard);
    elements.set('[data-testid="region-selector"], [data-testid="region-dropdown"], select[name="region"]', regionSelector);
      elements.set('[data-testid="group-item"]:has-text("Test Group")', createMockElement());
      elements.set('[data-testid="group-name"]:has-text("Test Group")', createMockElement());
      elements.set('[data-testid="region-option-us-east-1"], [role="option"]:has-text("us-east-1")', regionSelector);

      await navigateToService(page, {
        groupName: 'Test Group',
        serviceName: 'Amazon EC2',
        searchTerm: 'Amazon EC2',
        region: 'us-east-1',
      });

      expect(addServiceButton.click).toHaveBeenCalled();
      expect(regionSelector.click).toHaveBeenCalled();
      expect(searchInput.fill).toHaveBeenCalledWith('Amazon EC2');
      expect(serviceCard.click).toHaveBeenCalled();
    });

    it('skips region selection for global services', async () => {
      const { page, elements } = createMockPage();

      const addServiceButton = createMockElement();
      const searchInput = createMockElement();
      const serviceCard = createMockElement();

      elements.set('[data-testid="add-service-button"], button:has-text("Add service"), button:has-text("Add a service")', addServiceButton);
      elements.set('[data-testid="service-search-input"], input[placeholder*="search services" i], input[type="search"]', searchInput);
      elements.set('[data-testid="group-item"]:has-text("Test Group")', createMockElement());
      elements.set('[data-testid="group-name"]:has-text("Test Group")', createMockElement());
      elements.set('[data-testid="service-card"]:has-text("CloudFront"), .service-card:has-text("CloudFront")', serviceCard);

      await navigateToService(page, {
        groupName: 'Test Group',
        serviceName: 'CloudFront',
        searchTerm: 'CloudFront',
        region: 'global',
      });

      expect(addServiceButton.click).toHaveBeenCalled();
      expect(searchInput.fill).toHaveBeenCalledWith('CloudFront');
      expect(serviceCard.click).toHaveBeenCalled();
      // Region selector should not be queried for global services
      expect(elements.get('[data-testid="region-selector"]')).toBeUndefined();
    });
  });

  describe('getCurrentService()', () => {
    it('returns current service name', async () => {
      const { page, elements } = createMockPage();

      const serviceElement = createMockElement({ textContent: 'Amazon EC2' });
      elements.set('[data-testid="current-service-name"], .service-header h1, [data-testid="service-title"]', serviceElement);

      const serviceName = await getCurrentService(page);

      expect(serviceName).toBe('Amazon EC2');
    });

    it('returns null if no service element found', async () => {
      const { page, elements } = createMockPage();

      elements.set('[data-testid="current-service-name"], .service-header h1', null);

      const serviceName = await getCurrentService(page);

      expect(serviceName).toBeNull();
    });
  });
});

// ─── Integration Tests ───────────────────────────────────────────────────────

describe('Navigation integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('completes full navigation flow', async () => {
    const { page, elements } = createMockPage();

    // Setup mock elements for full flow
    const groupElement = createMockElement();
    const addServiceButton = createMockElement();
    const searchInput = createMockElement();
    const serviceCard = createMockElement();

    // Group exists
    elements.set('[data-testid="group-item"]:has-text("My Group")', groupElement);
    elements.set('[data-testid="group-name"]:has-text("My Group")', groupElement);

    // Service flow
    elements.set('[data-testid="add-service-button"], button:has-text("Add service"), button:has-text("Add a service")', addServiceButton);
    const regionSelector = createMockElement();
    elements.set('[data-testid="region-selector"], [data-testid="region-dropdown"], select[name="region"]', regionSelector);
    elements.set('[data-testid="region-option-us-west-2"], [role="option"]:has-text("us-west-2")', regionSelector);
    elements.set('[data-testid="service-search-input"], input[placeholder*="search services" i], input[type="search"]', searchInput);
    elements.set('[data-testid="service-card"]:has-text("Amazon S3"), .service-card:has-text("Amazon S3")', serviceCard);

    await navigateToService(page, {
      groupName: 'My Group',
      serviceName: 'Amazon S3',
      searchTerm: 'Amazon S3',
      region: 'us-west-2',
    });

    // Verify flow completed
    expect(groupElement.click).toHaveBeenCalled();
    expect(addServiceButton.click).toHaveBeenCalled();
    expect(regionSelector.click).toHaveBeenCalled();
    expect(searchInput.fill).toHaveBeenCalledWith('Amazon S3');
    expect(serviceCard.click).toHaveBeenCalled();
  });
});
