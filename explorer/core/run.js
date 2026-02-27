/**
 * Core explorer orchestrator.
 *
 * @module explorer/core/run
 */

import path from 'path';
import { fileURLToPath } from 'url';
import { mkdirSync, existsSync } from 'fs';

import { BrowserSession } from '../../automation/session/browser_session.js';
import { captureOptionsForDimensions } from '../scanner/options_scanner.js';
import { writeAllDraftArtifacts } from '../draft/draft_writer.js';
import { phase1LaunchAndSearch } from './phase1_search.js';
import { phase2RegionAndContext } from './phase2_context.js';
import { phase3DiscoverSections } from './phase3_sections.js';
import { discoverGateControls, phase4BfsExplore } from './phase4_dimensions.js';
import { phase5GenerateDraft } from './phase5_draft.js';
import { summarizeDimensions, printExplorationSummary } from './output.js';
import { getServiceByName } from '../../config/loader/index.js';
import { slugifyServiceId } from '../utils.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Check if output path is safe (within generated/ directory).
 * Matches Python's _is_safe_draft_path.
 * @param {string} outputPath
 * @returns {boolean}
 */
function isSafeDraftPath(outputPath) {
  if (!outputPath.endsWith('.json')) return false;
  
  const parts = outputPath.split(path.sep);
  const generatedIdx = parts.indexOf('generated');
  const servicesIdx = parts.indexOf('services');
  
  if (generatedIdx === -1) return false;
  if (servicesIdx === -1) return false;
  
  return servicesIdx < generatedIdx;
}

/**
 * Take screenshots for each state - matches Python's take_state_screenshots.
 * @param {import('playwright').Page} page
 * @param {string} artifactsDir
 * @param {Array} states
 * @returns {Promise<object>}
 */
async function takeStateScreenshots(page, artifactsDir, states) {
  const screenshotMap = {};
  
  for (const state of states) {
    try {
      const stateId = state.state_id;
      const screenshotPath = path.join(artifactsDir, `state_${stateId}.png`);
      
      // Restore to this state's sequence
      if (state.sequence && state.sequence.length > 0) {
        // Navigate to base URL first
        await page.goto(state.entered_via?.from_state ? page.url() : page.url(), { waitUntil: 'domcontentloaded' }).catch(() => {});
        
        // Apply sequence - simplified for screenshot capture
        for (const actionItem of state.sequence) {
          const selector = actionItem.control?.css_selector;
          if (!selector) continue;
          
          try {
            if (actionItem.action === 'click') {
              await page.locator(selector).first().click({ timeout: 1500, force: true }).catch(() => {});
            } else if (actionItem.action === 'select') {
              const value = actionItem.value;
              await page.locator(selector).first().click({ timeout: 1500, force: true }).catch(() => {});
              await page.locator(`[role='option']:has-text("${value}")`).first().click({ timeout: 1500, force: true }).catch(() => {});
            }
          } catch {
            // Continue even if action fails
          }
        }
      }
      
      await page.screenshot({ path: screenshotPath, fullPage: false }).catch(() => {});
      screenshotMap[stateId] = screenshotPath;
    } catch {
      // Skip failed screenshots
    }
  }
  
  return screenshotMap;
}

/**
 * Execute full explorer pipeline - matches Python's run_exploration.
 *
 * @param {{
 *   root: string,
 *   serviceName: string,
 *   serviceId?: string,
 *   serviceCode?: string,
 *   uiServiceLabel?: string,
 *   outputPath?: string,
 *   headless?: boolean,
 *   cardIndex?: number | null,
 *   maxStates?: number,
 *   restoreToggles?: boolean,
 *   maxOptionsPerSelect?: number,
 *   overwrite?: boolean,
 * }} opts
 * @returns {Promise<{
 *   draft: object,
 *   stateTracker: object,
 *   reportPath: string,
 *   notesPath: string,
 *   screenshotsDir: string,
 *   screenshotMap: object,
 *   summary: { total: number, confident: number, unknown: number },
 * }>}
 */
export async function runExploration(opts) {
  const {
    root,
    serviceName,
    serviceId = null,
    serviceCode = '',
    uiServiceLabel = '',
    outputPath = null,
    headless = false,
    cardIndex = null,
    maxStates = 30,
    restoreToggles = true,
    maxOptionsPerSelect = 5,
    overwrite = false,
  } = opts;

  // Compute default output path if not provided (Python Gap 7.1)
  let finalOutputPath = outputPath;
  if (!finalOutputPath) {
    const slug = slugifyServiceId(serviceName);
    finalOutputPath = path.join('config', 'services', 'generated', `${slug}_draft.json`);
    console.log(`  [run] Output path defaulted to: ${finalOutputPath}`);
  }

  // Path safety guard (Python Gap 7.3)
  if (!isSafeDraftPath(finalOutputPath)) {
    throw new Error(
      `Unsafe output path '${finalOutputPath}'. ` +
      `Draft must be written inside 'config/services/generated/'. ` +
      `To write to a custom location, ensure the path contains 'services/generated/' as a directory component.`
    );
  }

  // Check for existing file (Python Gap 7.4)
  if (existsSync(finalOutputPath) && !overwrite) {
    throw new Error(
      `Draft already exists at '${finalOutputPath}'. ` +
      `Delete it manually before re-running exploration, or pass overwrite: true to force overwrite.`
    );
  }

  // Ensure generated/ directory exists (Python Gap 7.5)
  const outputDir = path.dirname(finalOutputPath);
  mkdirSync(outputDir, { recursive: true });

  const session = new BrowserSession({ headless });

  try {
    await session.start();

    // Navigate to the estimate page first to warm up the SPA, then phase1
    // navigates to #/addService itself. Using domcontentloaded (not networkidle)
    // because AWS Calculator has continuous background requests.
    await session.openCalculator();
    const page = session.page;

    // Ensure page is alive before starting exploration
    if (!page || page.isClosed()) {
      throw new Error('Browser page is not available after initial navigation.');
    }

    console.log('  [phase 1] Opening add-service panel...');
    const cardData = await phase1LaunchAndSearch(page, serviceName, {
      cardIndex,
      nonInteractive: true,
    });
    console.log(`  [phase 1] Found: ${cardData.card_title}`);

    console.log('  [phase 2] Extracting region context...');
    const context = await phase2RegionAndContext(page, cardData.card_title);
    console.log('  [phase 3] Discovering sections...');
    const catalog = await getServiceByName(cardData.card_title || serviceName);
    const sections = await phase3DiscoverSections(page, catalog?.section_expansion_triggers || []);
    console.log(`  [phase 3] Found ${sections.length} sections`);
    console.log('  [phase 4] Discovering gate controls...');
    const gateControls = await discoverGateControls(page);
    console.log(`  [phase 4] Found ${gateControls.length} gate controls`);

    const baseUrl = page.url();
    console.log(`  [phase 4] BFS exploration (max ${maxStates} states)...`);
    const { dimensions, stateTracker, replaySequence } = await phase4BfsExplore(
      page,
      sections,
      gateControls,
      {
        maxStates,
        restoreToggles,
        maxOptionsPerSelect,
        configureUrl: baseUrl,
      },
    );
    console.log(`  [phase 4] Explored ${stateTracker.states.length} states, found ${dimensions.length} dimensions`);

    console.log('  [phase 4] Capturing select options...');
    await captureOptionsForDimensions(page, dimensions);

    // Take screenshots for each state (Python compatibility)
    const artifactsDir = path.join('artifacts', serviceName);
    mkdirSync(artifactsDir, { recursive: true });
    
    console.log('  [run] Taking state screenshots...');
    const screenshotMap = await takeStateScreenshots(page, artifactsDir, stateTracker.states || []);
    console.log(`  [run] Screenshots taken: ${Object.keys(screenshotMap).length} of ${stateTracker.states?.length || 0} states`);

    console.log('  [phase 5] Generating draft...');
    const draft = phase5GenerateDraft(serviceName, cardData, context, sections, dimensions, {
      activatedToggles: stateTracker.activated_toggles,
      gateControls,
      explorationStates: stateTracker.states,
      explorationBudgetHit: stateTracker.budget_hit,
      serviceCode,
      uiServiceLabel,
    });
    if (serviceId) {
      draft.service_id = serviceId;
    }

    // Add screenshot map to exploration meta
    if (Object.keys(screenshotMap).length > 0) {
      draft.exploration_meta = draft.exploration_meta || {};
      draft.exploration_meta.screenshots = screenshotMap;
    }

    const artifactPaths = await writeAllDraftArtifacts(draft, stateTracker, root, {
      page,
      replaySequence,
    });

    // Print exploration summary
    printExplorationSummary(sections, dimensions, stateTracker);

    return {
      draft,
      stateTracker,
      reportPath: artifactPaths.reportPath,
      notesPath: artifactPaths.notesPath,
      screenshotsDir: artifactsDir,
      screenshotMap,
      summary: summarizeDimensions(dimensions),
    };
  } finally {
    await session.stop();
  }
}
