/**
 * Phase 1: launch add-service page, search service cards, and open Configure.
 *
 * @module explorer/core/phase1_search
 */

import { ADD_SERVICE_URL, SERVICE_CARD_SELECTOR, UNKNOWN } from '../constants.js';
import { normalizeText } from '../utils.js';

async function waitForCards(page) {
  const cardSelector = SERVICE_CARD_SELECTOR;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const timeout = 8000 + attempt * 2000;
    await page.waitForSelector(cardSelector, { state: 'visible', timeout }).catch(() => {});
    if ((await page.locator(cardSelector).count().catch(() => 0)) > 0) {
      return;
    }
    process.stdout.write(`  [phase 1] still waiting for cards (attempt ${attempt + 1})...\n`);
    await page.keyboard.press('Escape').catch(() => {});
    await page.mouse.wheel(0, 400);
    await sleep(400);
  }
  throw new Error(
    'Service cards did not render after 24s. This may mean the calculator page blocked search results or the selector needs updating.',
  );
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function tokenizeQuery(query) {
  const stopwords = new Set(['amazon', 'aws', 'for', 'the', 'and', 'service']);
  return normalizeText(query)
    .split(/[^a-z0-9]+/)
    .filter((token) => token && !stopwords.has(token));
}

/**
 * Score a card against the query - matches Python's service_match_score.
 * @param {string} query
 * @param {string} title
 * @returns {number}
 */
function serviceMatchScore(query, title) {
  const queryNorm = normalizeText(query).toLowerCase();
  const titleNorm = normalizeText(title).toLowerCase();
  if (!queryNorm || !titleNorm) return 0;

  let score = 0;

  // Exact match - highest score
  if (queryNorm === titleNorm) {
    score += 250;
  }

  // Query contained in title
  if (queryNorm.includes(titleNorm)) {
    score += 180;
  }

  // Title starts with query
  if (titleNorm.startsWith(queryNorm)) {
    score += 220;
  }

  // Token-based matching
  const tokens = tokenizeQuery(query);
  for (const token of tokens) {
    if (titleNorm.includes(token)) {
      score += 20;
    }
  }

  // All tokens present - bonus
  if (tokens.length > 0 && tokens.every((token) => titleNorm.includes(token))) {
    score += 80;
  }

  return score;
}

function scoreCard(card, queryTokens) {
  const title = normalizeText(card.title);
  if (!title) return 0;
  let score = 0;

  for (const token of queryTokens) {
    if (title.includes(token)) {
      score += 5;
    }
  }

  if (title === normalizeText(card.query || '')) {
    score += 10;
  }

  if (normalizeText(card.title).startsWith(queryTokens[0] || '')) {
    score += 2;
  }

  return score;
}

async function waitForSpaSettle(page) {
  await sleep(400);
}

/**
 * Dismiss any consent / cookie dialogs that may intercept clicks.
 * @param {import('playwright').Page} page
 */
async function dismissDialogs(page) {
  const selectors = [
    "button#awsccc-cb-btn-accept",
    "button[data-id='awsccc-cb-btn-accept']",
    "button:has-text('Accept all')",
    "button:has-text('Accept')",
    "button:has-text('I agree')",
    "button[aria-label='Close']",
  ];
  for (const sel of selectors) {
    try {
      const btn = page.locator(sel).first();
      if ((await btn.count()) > 0 && await btn.isVisible({ timeout: 800 }).catch(() => false)) {
        await btn.click({ timeout: 1500, force: true }).catch(() => {});
        await sleep(300);
      }
    } catch {
      // Ignore — dialog may not be present
    }
  }
}

async function findSearchInput(page) {
  // Wait for the Add Service search input to be visible (SPA may still be hydrating)
  const SEARCH_SELECTOR =
    "input[placeholder*='search' i], input[aria-label*='search' i], input[type='search'], " +
    "input[placeholder*='Find' i], input[placeholder*='filter' i]";

  try {
    await page.waitForSelector(SEARCH_SELECTOR, { state: 'visible', timeout: 8000 });
  } catch {
    // Selector wait timed out — try anyway, may still be there
  }

  const locator = page.locator(SEARCH_SELECTOR).first();
  const count = await locator.count().catch(() => 0);
  if (count === 0) {
    throw new Error(
      'Could not find service search input on Add Service page. ' +
      'The page may not have loaded correctly.',
    );
  }

  return locator;
}

/**
 * Extract label from card element - matches Python's label_from_card.
 * @param {import('playwright').Page} page
 * @param {import('playwright').Locator} card
 * @returns {Promise<string>}
 */
async function labelFromCard(page, card) {
  const titleSelectors = [
    'h1', 'h2', 'h3', 'h4',
    "[role='heading']",
    "[data-testid*='title']",
    "[class*='title']",
    'strong',
  ];

  for (const selector of titleSelectors) {
    try {
      const candidate = card.locator(selector).first();
      const count = await candidate.count();
      if (count === 0) continue;

      const text = await candidate.textContent().catch(() => '');
      const normalized = normalizeText(text);

      if (normalized && normalized !== 'product page') {
        return normalized;
      }
    } catch {
      // Continue to next selector
    }
  }

  // Fallback: use full card text
  const fullText = await card.textContent().catch(() => '');
  const normalized = normalizeText(fullText);
  if (!normalized) return UNKNOWN;

  // Extract first line before common suffixes
  let short = normalized
    .split(' product page')[0]
    .split(' configure')[0]
    .split('\n')[0]
    .trim();

  // Handle repeated text patterns
  const repeatMatch = short.match(/^(.{3,120}?)\s+\1\b/i);
  if (repeatMatch) {
    short = repeatMatch[1].trim();
  }

  // Extract first part before common connectors
  for (const marker of [' is ', ' uses ', ' provides ', ' helps ', ' enables ', ' offers ', ' delivers ']) {
    if (short.includes(marker)) {
      short = short.split(marker)[0].trim();
      break;
    }
  }

  // Handle repeated word pairs
  const words = short.split(/\s+/);
  if (words.length > 0 && words.length % 2 === 0) {
    const half = Math.floor(words.length / 2);
    const firstHalf = words.slice(0, half).join(' ');
    const secondHalf = words.slice(half).join(' ');
    if (firstHalf === secondHalf) {
      short = firstHalf;
    }
  }

  return short || UNKNOWN;
}

async function gatherServiceCards(page, serviceQuery) {
  const cards = [];
  const locator = page.locator(SERVICE_CARD_SELECTOR);
  const count = Math.min(await locator.count(), 40);

  // Primary: gather cards using structured selector
  for (let i = 0; i < count; i += 1) {
    const card = locator.nth(i);
    if (!(await card.isVisible().catch(() => false))) {
      continue;
    }

    const title = await labelFromCard(page, card);

    const buttonLocator = card.locator("button, [role='button']").first();
    const configureButton = normalizeText(await buttonLocator.textContent().catch(() => 'Configure')) || 'Configure';

    cards.push({
      index: i,
      title,
      configure_button: configureButton,
      query: serviceQuery,
    });
  }

  // Fallback: if no cards found, try button-based discovery (Python's fallback_button_mode)
  if (cards.length === 0) {
    const buttons = page.locator("button, [role='button']");
    const btnCount = Math.min(await buttons.count(), 50);

    for (let i = 0; i < btnCount; i += 1) {
      const btn = buttons.nth(i);
      if (!(await btn.isVisible().catch(() => false))) {
        continue;
      }

      const label = normalizeText(await btn.textContent().catch(() => ''));
      if (!label.toLowerCase().includes('configure')) {
        continue;
      }

      // Try to find parent card
      let title = UNKNOWN;
      try {
        const parent = btn.locator('xpath=ancestor::*[self::li or self::article or self::section][1]').first();
        const parentCount = await parent.count();
        if (parentCount > 0) {
          title = await labelFromCard(page, parent);
        }
      } catch {
        // Keep UNKNOWN
      }

      cards.push({
        index: i,
        title,
        configure_button: label || 'Configure',
        query: serviceQuery,
        fallback_button_mode: true,
      });
    }
  }

  // Deduplicate cards
  const deduped = [];
  const seen = new Set();
  for (const card of cards) {
    const marker = normalizeText(card.title || '');
    if (seen.has(marker)) continue;
    seen.add(marker);
    deduped.push(card);
  }

  return deduped;
}

/**
 * Rank cards by match score - matches Python's rank_matching_cards.
 * @param {Array<{index: number, title: string, configure_button: string, query?: string}>} cards
 * @param {string} serviceQuery
 * @returns {Array<{index: number, title: string, configure_button: string, query?: string, match_score: number}>}
 */
function rankMatchingCards(cards, serviceQuery) {
  const scored = cards.map((card) => ({
    ...card,
    match_score: serviceMatchScore(serviceQuery, card.title || ''),
  }));
  scored.sort((a, b) => b.match_score - a.match_score);

  // Filter to only positive scores if any exist
  const positive = scored.filter((c) => c.match_score > 0);
  return positive.length > 0 ? positive : scored;
}

async function openSelectedService(page, rankedCards, selectedIndex) {
  const selected = rankedCards[selectedIndex];
  const rootCards = page.locator(SERVICE_CARD_SELECTOR);

  // Handle fallback button mode (Python's open_selected_service fallback)
  if (selected.fallback_button_mode) {
    const btn = page.locator("button, [role='button']").nth(selected.index);
    await btn.scrollIntoViewIfNeeded().catch(() => {});
    await btn.click({ timeout: 8000 }).catch(() => {});
    await waitForSpaSettle(page);
    return {
      card_title: selected.title,
      configure_button: selected.configure_button,
    };
  }

  const card = rootCards.nth(selected.index);
  await card.scrollIntoViewIfNeeded().catch(() => {});

  // Try to find Configure button
  const configureButton = card
    .locator("button, [role='button']")
    .first();

  const hasButton = (await configureButton.count().catch(() => 0)) > 0;

  if (hasButton) {
    await configureButton.click({ timeout: 8000 }).catch(() => {
      // Fallback: click card itself
      card.click({ timeout: 8000 }).catch(() => {});
    });
  } else {
    await card.click({ timeout: 8000 }).catch(() => {});
  }

  await waitForSpaSettle(page);

  return {
    card_title: selected.title,
    configure_button: selected.configure_button,
  };
}

/**
 * Click the "Add service" button on the estimate page to open the service
 * search panel, or navigate to the add-service URL as a fallback.
 * @param {import('playwright').Page} page
 */
async function openAddServicePanel(page) {
  // Strategy 1: try clicking the Add service button on the estimate page
  const addServiceSelectors = [
    "button:has-text('Add service')",
    "button:has-text('Add a service')",
    "a:has-text('Add service')",
    "[role='button']:has-text('Add service')",
    "[data-testid*='add-service']",
  ];

  for (const sel of addServiceSelectors) {
    try {
      const btn = page.locator(sel).first();
      if ((await btn.count()) > 0 && await btn.isVisible({ timeout: 1500 }).catch(() => false)) {
        await btn.click({ timeout: 5000 });
        await sleep(600);
        // Verify search input appeared
        const SEARCH_SELECTOR =
          "input[placeholder*='search' i], input[aria-label*='search' i], " +
          "input[type='search'], input[placeholder*='Find' i], input[placeholder*='filter' i]";
        const appeared = await page
          .waitForSelector(SEARCH_SELECTOR, { state: 'visible', timeout: 5000 })
          .catch(() => null);
        if (appeared) return; // panel opened successfully
      }
    } catch {
      // try next selector
    }
  }

  // Strategy 2: navigate directly to the hash route
  await page.goto(ADD_SERVICE_URL, { waitUntil: 'domcontentloaded' });
  await dismissDialogs(page);
  await sleep(800);
}

/**
 * Choose card index - matches Python's choose_card_index.
 * @param {Array} cards
 * @param {number|null} requestedIndex
 * @param {boolean} nonInteractive
 * @returns {number}
 */
function chooseCardIndex(cards, requestedIndex, nonInteractive) {
  if (cards.length === 0) {
    throw new Error('No service cards found for the search term.');
  }

  if (cards.length === 1) {
    return 0;
  }

  if (requestedIndex !== null && requestedIndex !== undefined) {
    const resolved = requestedIndex - 1;
    if (resolved < 0 || resolved >= cards.length) {
      throw new Error(
        `Card index ${requestedIndex} is out of range (1-${cards.length}).`,
      );
    }
    return resolved;
  }

  if (nonInteractive) {
    console.log(`  [phase 1] Multiple cards matched; selecting highest-ranked: ${cards[0].title}`);
    return 0;
  }

  // Interactive mode - not implemented for now, default to first
  console.log('  [phase 1] Multiple cards matched; selecting highest-ranked (interactive mode not implemented)');
  return 0;
}

/**
 * Execute phase 1.
 *
 * @param {import('playwright').Page} page
 * @param {string} serviceName
 * @param {{ cardIndex?: number|null, nonInteractive?: boolean }} [opts]
 * @returns {Promise<{ card_title: string, configure_button: string }>}
 */
export async function phase1LaunchAndSearch(page, serviceName, opts = {}) {
  const { cardIndex = null, nonInteractive = true } = opts;

  // Open the Add Service panel (click button or navigate to hash route)
  process.stdout.write('  [phase 1] Opening panel...\n');
  await openAddServicePanel(page);

  // Dismiss any lingering dialogs
  await dismissDialogs(page);

  // Wait for SPA hydration — search input must be ready before we type
  process.stdout.write('  [phase 1] Waiting for search input...\n');
  const searchInput = await findSearchInput(page);

  // Clear any pre-filled content and type the service name
  process.stdout.write(`  [phase 1] Searching for '${serviceName}'...\n`);
  await searchInput.click({ timeout: 5000 }).catch(() => {});
  await searchInput.clear().catch(() => {});
  await searchInput.fill(serviceName);
  await searchInput.press('Enter').catch(() => {});
  await waitForSpaSettle(page);

  // Wait for search results to appear (cards need time to render after keystroke)
  process.stdout.write('  [phase 1] Waiting for cards to appear...\n');
  await waitForCards(page);

  const cards = await gatherServiceCards(page, serviceName);
  if (cards.length === 0) {
    throw new Error(
      `No service cards found for '${serviceName}'. ` +
      'The search may have returned no results, or the card selector may need updating.',
    );
  }

  const ranked = rankMatchingCards(cards, serviceName);
  const selectedIndex = chooseCardIndex(ranked, cardIndex, nonInteractive);

  return openSelectedService(page, ranked, selectedIndex);
}
