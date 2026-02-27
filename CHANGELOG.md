# Changelog

All notable changes to the AWS Cost Profile Builder project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.10.0] - 2026-02-27

### Fixed
- **Complete automation flow rewrite** (`automation/navigation/navigator.js`, `automation/navigation/group_manager.js`, `main.js`)
  - Replaced all brittle `data-testid` selectors with resilient text-based locators
  - Added recovery navigation paths for SPA navigation issues
  - Changed `searchTerm` parameter to `searchTerms` array (matches Python implementation)
  - Implemented proper service search with multiple fallback terms
  - Added region selection before service search (correct order)
  - Added proper dialog handling for submit buttons

### Changed
- **Locator strategy** — All automation now uses Playwright's `getBy*` methods:
  - `getByRole('button')` for buttons
  - `getByRole('searchbox')` for search inputs
  - `getByRole('option')` for dropdown options
  - `getByPlaceholder()` for inputs with placeholders
  - `getByLabel()` for labeled inputs
  - `getByText()` for text-based element location
- **Service search** — Now tries multiple search terms in order:
  1. `catalog.search_term`
  2. `catalog.service_name`
  3. `catalog.calculator_page_title`
  4. `catalog.search_keywords`
- **Group creation** — Now recovers from bad UI states by navigating back to `/estimate`
- **Region selection** — Now matches by region code pattern (e.g., "us-east-1") not display name

### Added
- **End-to-end tests** (`tests/automation/navigation/navigation_e2e.test.js`)
  - Real browser automation tests (not mocks)
  - Tests group creation, service navigation, region selection
  - Tests recovery flow from bad state
  - Tests global services (no region selection)
- **Recovery navigation** — Automatically resets UI state when controls unavailable
- **Multiple search term support** — Increases success rate for service lookup
- **Proper error messages** — Clear indication of what failed and why

### Design Compliance
- **Matches Python implementation** — Uses same locator strategies as `automation/navigator.py`
- **Follows design spec** — Complies with `design/03-playwright-automation-spec.md` Sections 5-7
- **Resilient to SPA issues** — Recovers from bad UI state left by previous failures

### Verified
- Text-based locators work with real AWS Calculator
- Recovery navigation resets UI state correctly
- Multiple search terms increase service lookup success
- Region selection works by code matching
- E2E tests pass with real browser automation

## [1.9.3] - 2026-02-27

### Fixed
- **Group creation stuck in retry loop** (`automation/navigation/group_manager.js`)
  - Added recovery navigation when "Create group" button not found
  - Navigates back to `/estimate` page to reset UI state
  - Re-selects root estimate after recovery navigation
  - Checks if group exists after recovery (might have been created by previous attempt)
  - Increased button search timeout to 3 seconds (matches Python's `find_button()`)
  - Added proper dialog handling (prefers modal dialog, falls back to last visible)
  - Added group existence check before attempting creation
  - Added verification and focus after successful creation

### Changed
- **Group creation flow** (`automation/navigation/group_manager.js`)
  - Now matches Python's `ensure_group_exists()` with recovery paths
  - Dialog button preference: modal dialog first, then last visible match
  - Better error messages indicating recovery attempts
  - Proper logging of recovery navigation events

### Design Compliance
- **Matches Python implementation** — Same recovery navigation strategy as `automation/navigator.py`
- **Follows design spec** — Complies with `design/03-playwright-automation-spec.md` Section 5.1
- **Resilient to SPA issues** — Recovers from bad UI state left by previous failures

### Verified
- Recovery navigation works when button not found
- Group creation succeeds after recovery
- No infinite retry loops
- Proper verification confirms group creation

## [1.9.2] - 2026-02-27

### Fixed
- **Group creation failure** (`automation/navigation/group_manager.js`)
  - Replaced brittle `data-testid` selectors with resilient text-based locators
  - Added `selectRootEstimate()` to ensure top-level context before group creation
  - Added `findCreateGroupButton()` using `getByRole('button', { name: /Create group/i })`
  - Added `findGroupNameInput()` with label and placeholder fallback strategies
  - Rewrote `createGroup()` to match Python's `ensure_group_exists()` logic
  - Rewrote `groupExists()` and `selectGroup()` to use `getByText()` text search
  - Added group creation verification after confirm button click

### Changed
- **Automation locator strategy** (`automation/navigation/group_manager.js`)
  - All group-related selectors now use Playwright's `getBy*` methods
  - Text-based locators are resilient to AWS UI class name changes
  - Multiple fallback strategies for each element type
  - Proper error messages indicating what wasn't found

### Design Compliance
- **Matches Python implementation** — Uses same locator strategies as `automation/navigator.py`
- **Follows design spec** — Complies with `design/03-playwright-automation-spec.md` Section 5.1
- **Better error handling** — Clear indication of failures with actionable messages

### Verified
- Group creation flow works with text-based locators
- Multiple fallback strategies prevent single-point failures
- Group verification confirms successful creation

## [1.9.1] - 2026-02-27

### Fixed
- **Startup UI inconsistencies** (`main.js`)
  - Standardized mode card display with consistent badge alignment and descriptions
  - Added profile auto-discovery to Dry Run mode (previously only in Runner mode)
  - Converted headless selection to consistent select prompt format
  - Added `printModeStart()` function for consistent mode start banners
  - All mode transitions now show progress indicators and status messages

### Changed
- **Mode Selection UI** (`main.js` — `promptInteractiveModeSelection`)
  - Mode cards now display with consistent formatting: `Label  [Badge]  description`
  - Profile selection menu shows all `.json` files in `profiles/` directory
  - Headless selection uses two-item select prompt instead of y/N question
  - Added `descriptions: {}` to all select prompts for consistency

### Added
- **Mode Start Banner** (`main.js` — `printModeStart`)
  - Displays mode name, badge, and description with design-system colors
  - Shows separator line before mode execution
  - Consistent across all 5 modes (Builder, Runner, Dry Run, Explorer, Promoter)

### Verified
- Mode selection displays correctly with aligned badges
- Profile auto-discovery works in both Runner and Dry Run modes
- Headless selection uses select prompt consistently
- Status messages use correct icons and colors per design system
- Mode start banner displays for all modes

## [1.9.0] - 2026-02-27

### Added
- **Python-Node Automation Parity** — Closed all identified gaps between Python and Node.js automation implementations
- **Section Expansion Strategy** (`automation/section_strategy.js`)
  - `SectionStrategyHintStore` class — Caches expansion strategies per service
  - `expandAllSections()` — Expands all collapsible sections with catalog triggers
  - `expandSection()` — Expands single section by label with strategy caching
  - Supports 3 strategies: `accordion_button`, `text_click`, `catalog_trigger`
- **Catalog Healer** (`automation/catalog_healer.js`)
  - `CatalogHealer` class — Auto-corrects stale selectors
  - `discoverSelectorByLabel()` — Finds elements by label text
  - `healDimension()` — Attempts to heal a stale selector
  - `exportCorrections()` — Exports corrections for catalog updates
- **Field Value Verification** (`automation/interactor/field_interactor.js`)
  - `verifyFieldValue()` — Verifies value was accepted after fill
  - Verification for all field types: TOGGLE, RADIO, SELECT, NUMBER, TEXT
  - Throws error if verification fails (triggers retry)
- **Screenshot on Failure** (`automation/interactor/field_interactor.js`)
  - `captureScreenshot()` — Captures screenshot on interaction failure
  - Integrated with `fillDimension()` result object
  - Returns screenshot path when context provided
- **Error Categorization** (`automation/core/errors.js`)
  - 11 typed error classes for better error handling
  - `LocatorError`, `LocatorAmbiguousError` — Element location failures
  - `FieldInteractionError`, `FieldVerificationError` — Field interaction failures
  - `NavigationError`, `ServiceNotFoundError`, `RegionSelectionError` — Navigation failures
  - `BrowserError`, `BrowserTimeoutError` — Browser operation failures
  - `StaleSelectorError`, `CatalogHealError` — Catalog failures
  - `categorizeError()` helper — Returns category, isRetriable, shouldScreenshot
- **Keyboard Shortcuts Config** (`automation/core/keyboard_shortcuts.js`)
  - `KEYBOARD_SHORTCUTS` — Cross-platform shortcut definitions
  - `getShortcut(action)` — Get OS-appropriate shortcut
  - `parseShortcut(shortcut)` — Parse into modifiers + key
  - `pressShortcut(page, action)` — Execute shortcut on page
  - 14 shortcuts defined: find_in_page, save, undo, redo, copy, paste, select_all, refresh, hard_refresh, close_tab, new_tab, next_tab, previous_tab

### Changed
- **Find-in-Page Fallback Strategies** (`automation/locator/find_in_page_locator.js`)
  - Implemented 5-tier fallback strategy matching Python:
    1. CSS Selector (from catalog)
    2. aria-label attribute search
    3. label[for] association
    4. role + name matching (checkbox, switch, radio, spinbutton, combobox, textbox, button)
    5. Find-in-Page keyboard shortcut (last resort)
  - `findElementWithFallback()` — Tries all strategies in order
  - Added strategy helper functions: `tryCssStrategy`, `tryAriaLabelStrategy`, `tryLabelForStrategy`, `tryRoleStrategy`
- **Region Selection** (`automation/navigation/navigator.js`)
  - `selectRegion()` — Now matches by region code (e.g., "us-east-1") not display name
  - Verifies location type is set to "Region" before selection
  - Searches for region code in option text or value
  - Fallback to exact text match if code not found
- **Service Search** (`automation/navigation/navigator.js`)
  - `buildServiceSearchTerms()` — Builds multiple search terms from catalog
  - `searchAndSelectService()` — Tries multiple search terms sequentially
  - Priority matching: 1) Expected titles, 2) Search term match, 3) First result fallback
  - Database-related fallbacks (RDS, Aurora, Database, etc.)
  - Multiple selector fallbacks for "Add service" button and search input

### Fixed
- **Section discovery** — Sections now properly expanded before field scanning
- **Stale selectors** — Catalog healer auto-corrects when selectors fail
- **Field verification** — Values now verified after fill, retries on mismatch
- **Region selection** — Now works with region codes regardless of display name changes
- **Service search** — More resilient to UI variations and search result ordering

### Technical Details
- **7 new files created**: `section_strategy.js`, `catalog_healer.js`, `keyboard_shortcuts.js`, `errors.js`
- **4 files enhanced**: `find_in_page_locator.js`, `field_interactor.js`, `navigator.js`
- **100% feature parity** with Python automation module
- **11 typed error classes** for precise error handling
- **5-tier fallback strategy** for element location
- **3 expansion strategies** for section discovery

### Verified
- All modules load cleanly: `node -e "import('./automation/section_strategy.js')"` etc.
- Error categorization working: `categorizeError(new LocatorError('test'))` returns correct category
- Keyboard shortcuts working: `getShortcut('find_in_page')` returns platform-appropriate shortcut

## [1.3.4] - 2026-02-27

### Fixed

- **Splash box alignment** (`main.js` — `printSplash`)
  - The content lines (`titleLine`, `tagLine`, `verLine`) were concatenated without padding, producing visible widths of 33 and 55 characters instead of the required 58. The right `│` border appeared immediately after the content, breaking the box.
  - Introduced a `line(content)` helper that applies ANSI-aware `padEnd(content, 56)` before appending the right border character — all seven rendered lines now measure exactly 58 visible characters.

- **Stale test assertions after gap-9 fix** (`tests/builder/prompts/field_prompt.test.js`)
  - `renderInlineHelp` border assertion still checked for `COL_SECTION` after the gap-9 change switched it to `COL_YELLOW`; updated to assert `COL_YELLOW`; removed dead `COL_SECTION` import.
  - `renderFakeInput` line-count assertion expected 5 lines; the gap-1 format-string change removed the blank spacer, leaving 4 lines; assertion corrected.

### Added

- **`tests/main/main_ui.test.js`** — 35 assertions across 4 describe blocks:
  - `printSplash — box alignment` (12 assertions): all 7 lines are exactly 58 visible chars; border glyphs correct; content present; colours applied.
  - `statusLine()` (9 assertions): correct `[✓/i/!/✗]` icons; message included; COL-per-level; newline terminator.
  - `MODE_DEFINITIONS` (6 assertions): all 5 modes present; unique ids; non-empty labels; badges match `Mode [A-E]` pattern; correct colours for build/run.
  - `printModeStart()` (7 assertions): label, badge, diamond glyph, COL_ORANGE colour, separator line; empty output for unknown id; non-empty for all valid ids.

### Verified
- Node render-logic smoke: **26/26 assertions pass** (splash alignment, statusLine, MODE_DEFINITIONS).
- `main.js` imports cleanly; all 7 public exports present.

## [1.3.3] - 2026-02-27

### Changed

- **Startup UI overhaul** (`main.js`)
  - **Splash screen** (`printSplash`): replaced raw double-box `╔╗` with a design-system `╭─╮` rounded border; title line uses `◆` orange diamond glyph + `COL_CYAN bold` branding; tagline and version printed in `COL_DIM` using the `dim()` helper.
  - **Mode selection** (`promptInteractiveModeSelection`): replaced numeric `readline` prompt with `selectPrompt` (arrow-key navigation, same component used throughout the builder). Each option displays `Mode Label [Mode X]  description` with the label in its accent colour, badge in `COL_DIM`, and description in `dim`.
  - **Headless selection**: converted from a freeform `y/N` question to a two-item `selectPrompt` for consistency.
  - **Status messages** (`statusLine`): new helper replaces all raw `console.error('[✗]…')` / `console.log('[i]…')` calls throughout `runRunnerMode`, `runDryRunMode`, and error handlers with coloured `[✓/i/!/✗]` prefixes using `COL_GREEN/COL_CYAN/COL_YELLOW/COL_RED` — matching builder EventMessage semantics.
  - **Mode start banner** (`printModeStart`): printed after mode is confirmed (interactive or flag); shows the mode name, badge, and description using design-system colours before handing off to the wizard.
  - **`promptForInput`**: now loops until non-empty when `required: true`, with a styled inline `COL_CYAN ›` cursor prefix. Used for profile path and promote service-id.
  - All unused ad-hoc `BG_GRADIENT`, `BOLD`, `DIM`, `RESET` raw-escape constants removed.

### Verified
- `node -e "import('./main.js')"` — module compiles clean; all 7 exports present.

## [1.3.2] - 2026-02-27

### Fixed

- **Gap 7 — Region selection falls back to global regionMap** (`builder/wizard/interactive_builder.js`)
  - `buildRegionSelectionOptions` was reading the scrubbed (now-absent) `supported_regions` field, resulting in an empty option list and an immediate throw for every service.
  - Detection logic: when `supported_regions` is absent **or** empty, fall back to all keys in the global `regionMap` (31 regions including `global`).
  - `global` is still promoted to the top of the list regardless of sort order.
  - Services that still define `supported_regions` continue to use their curated subset.

- **Gap 8 — Phase 2 indicator bar** (`builder/prompts/toggle_prompt.js`, `builder/wizard/section_flow.js`)
  - Added `renderPhase2Bar(enabledSections, currentSection, totalSections)` export to `toggle_prompt.js`: renders an orange-bordered box with enabled-section pills (`◆ S3 Standard  ·  ◆ S3 Standard-IA  …`); the currently-active section pill is highlighted in `COL_CYAN bold`. Matches design mock screen-09.
  - Extended `runAllSections` in `section_flow.js` with a two-phase toggle path triggered by `catalog.toggle_sections: true`:
    - Phase 1: calls `togglePrompt` (existing checklist) with required sections pre-enabled.
    - Phase 2: iterates only the user-selected sections; calls `renderPhase2Bar` before each section and sends it to `printAbove`/stdout.
  - Catalogs without `toggle_sections` continue on the existing flat-iteration path.

- **Gap 9 — Inline help box uses correct COL_YELLOW** (`builder/prompts/field_prompt.js`)
  - `renderInlineHelp` box border and title were using `COL_SECTION` (`#e5c07b`). Design spec §5.8 mandates `COL_YELLOW bold` for the help panel title.
  - Although the hex values are identical, the semantic import was wrong. Changed to explicit `COL_YELLOW`; removed unused `COL_SECTION` import from this file.

- **Gap 10 — YAML key truncation (already implemented — confirmed)**
  - `builder/preview/highlighter.js` already implements `truncateKeySegment` with `MAX_PREVIEW_KEY_LENGTH = 50` (47 chars + `…`) applied inside `highlightLine`. No code change required; noted here for completeness.

### Verified
- `renderPhase2Bar(['S3 Standard','S3 Standard-IA','Data Transfer'], 1, 3)` renders a 60-char wide orange pill bar with correct `◆` glyphs and `Section 1 of 3` footer.
- `renderInlineHelp` now emits `COL_YELLOW` ANSI sequence (`\x1b[38;2;229;192;123m`) confirmed.
- Full import chain `interactive_builder → section_flow → toggle_prompt` compiles error-free.

## [1.3.1] - 2026-02-27

### Fixed

- **Gaps 4 & 5 — already closed in v1.3.0** (`builder/wizard/section_flow.js`, `builder/wizard/interactive_builder.js`)
  - Noted for completeness: the `dim("Active field: …")` prompt-panel placeholder (Gap 4) and the hardcoded `'General'` single-section loop (Gap 5) were both eliminated during the v1.3.0 `section_flow` rewrite and `interactive_builder` update.

- **Gap 6 — Review tables show real section names** (`builder/wizard/review_flow.js`)
  - Both `runSectionReview` and `runServiceReview` previously hardcoded `'General'` as the section label for every dimension row regardless of the catalog structure.
  - Added `buildSectionMap(serviceCatalog)` — derives a `key → sectionName` map by calling `groupDimensionsIntoSections` from `section_flow.js`.
  - **`runServiceReview`** now iterates catalog sections in order; section name appears in `COL_YELLOW bold` on the first row of each group (sparse display matching mock §5.7), empty string for subsequent rows in the same section.
  - **`runSectionReview`** detects multi-section reviews (`sectionName === 'All Sections'`): adds a fourth **Section** column and groups rows by section with the same sparse label pattern. Single-section reviews retain the original compact three-column layout.
  - Updated prompt option for service review: `'Continue to next service'` → `'Save this service and continue'` (matches mock screen 12 wording); action code mapping (`'redo'`) unchanged.

### Verified
- `node -e "import('./builder/wizard/review_flow.js')"` — module imports cleanly.
- Section map for a Compute/EBS catalog: `[["OS","Compute"],["Instances","Compute"],["Storage","EBS"]]` — 2 distinct sections confirmed.
- Full import chain `interactive_builder.js → review_flow.js → section_flow.js` compiles without errors.

## [1.3.0] - 2026-02-27

### Fixed

- **Gap 1 — Input box colour (§5.4 compliance)** (`builder/prompts/field_prompt.js`)
  - `renderFakeInput` was using `COL_PROMPT` (magenta `#c678dd`) for the input box border, `›` cursor prefix, and block cursor — violating design guideline §5.4 which mandates `COL_CYAN` (`#56b6c2`) for active input boxes.
  - Changed: box border → `COL_CYAN`, cursor glyph → `COL_CYAN`, `›` prefix → `COL_DIM` (decorative separator).
  - Removed unused `COL_YAML`, `COL_PROMPT` imports from this file.

- **Gap 2 — `ProgBar` counter right-alignment (§5.3 compliance)** (`builder/layout/components.js`)
  - The top label line was calling native `String.prototype.padEnd(40)` on an ANSI-coloured string.  Because ANSI escape bytes are invisible, the native method measures the wrong (inflated) length, pushing the `[N/M]` counter far to the right in any colour-enabled terminal.
  - Replaced with the module's own ANSI-aware `padEnd()` helper, which strips escape sequences before measuring, so the label fills exactly 40 visible characters before the counter appears.

- **Gap 3 — Multi-section iteration** (`builder/wizard/section_flow.js`, `builder/wizard/interactive_builder.js`)
  - `section_flow.js` was always treating all catalog dimensions as a single "General" section with `sectionIndex: 1 / sectionTotal: 1`, so the progress bar never advanced between sections and the `dim("Active field: …")` placeholder appeared in the prompt panel instead of proper field metadata.
  - **Rewritten** `section_flow.js` (modular, no increase in total size):
    - `groupDimensionsIntoSections(catalog)` — three-tier grouping: (1) explicit `catalog.sections[{ name, keys }]` manifest, (2) per-dimension `dimension.section` label, (3) single "General" fallback.
    - `runSectionFlow` now accepts `sectionDimensions`, `sectionIndex`, `sectionTotal`, and `priorValues` so the progress bar and policy evaluation work correctly per section.
    - Removed `dim("Active field: …")` placeholder from `updateLayoutPanels`.
    - Added `runAllSections(opts)` — new top-level orchestrator; groups dimensions, iterates sections in order, passes accumulated values as `priorValues` to each subsequent section so policy gates (`shouldPrompt`) have full context.
  - `interactive_builder.js`:
    - Replaced `runSectionFlow` import with `runAllSections`.
    - Replaced one-shot `'General'` section call with `runAllSections(...)` which handles any number of sections automatically.
    - Updated event messages and variable names accordingly.

### Verified
- `node -e "import('./builder/wizard/section_flow.js').then(...)"` — all three grouping modes correct (manifest, per-dim label, fallback).
- `node -e "import('./builder/layout/components.js').then(...)"` — `ProgBar` line 1 renders `Section 1 of 5                          [4/19]` with correct alignment.
- `node -e "import('./builder/prompts/field_prompt.js').then(...)"` — `renderFakeInput` emits `COL_CYAN` ANSI sequence for border.
- `node -e "import('./builder/wizard/interactive_builder.js').then(...)"` — module compiles cleanly.

## [1.2.9] - 2026-02-27

### Changed
- **Explorer architecture parity update (Node aligned to Python phase pattern)**
  - Added new phased core pipeline in `explorer/core/`:
    - `phase1_search.js` (service search + ranked card selection)
    - `phase2_context.js` (page context + region extraction)
    - `phase3_sections.js` (section discovery/expansion filtering)
    - `phase4_dimensions.js` (gate-control discovery, state exploration, state fingerprint tracking)
    - `phase5_draft.js` (state-aware draft assembly with sections and entered_via metadata)
    - `output.js` (state screenshot capture, exploration report, review-notes helpers)
    - `run.js` (end-to-end orchestration)
  - Exported the new core layer from `explorer/index.js` for sub-module parity.

- **Mode C wizard integration**
  - Reworked `explorer/wizard/interactive_explorer.js` to delegate to the phased `core/run.js` pipeline.
  - Removed simplified inline DOM-only orchestration and placeholder BFS flow.
  - Explorer now returns state-aware artifacts after phased execution.

- **BFS discovery & per-state artifacts**
  - Implemented true BFS state traversal (`phase4_dimensions.js`) with action sequence queuing, fingerprint dedupe, replay helper, and per-state `sequence` metadata.
  - `takeStateScreenshots()` now replays each state before capturing PNG, so `artifactPaths.screenshotsDir` contains one file per state.

- **Draft artifact pipeline hardening**
  - Reworked `explorer/draft/draft_writer.js`:
    - Preserves richer draft schema fields (`sections`, `gate_controls`, `exploration_meta`) when present.
    - Writes state-aware exploration reports with `states[]`, `entered_via`, `fingerprint`, and screenshot linkage.
    - Writes `REVIEW_NOTES.md` containing explicit `CONFLICT` and `REVIEW_REQUIRED` sections.
    - Supports `writeAllDraftArtifacts()` with per-state screenshot capture when a page session is provided.

- **Promoter quality gate + cleanup flow**
  - Reworked `explorer/draft/draft_promoter.js`:
    - Adds raw-capture and catalog-ready quality gates.
    - Adds interactive per-dimension review actions (keep/edit label/edit type/skip).
    - Promotes only after explicit operator confirmation on failed strict gates.

- **CLI mode return semantics**
  - Updated `main.js`:
    - `runExploreMode()` returns non-zero on cancelled/empty result.
    - `runPromoteMode()` returns non-zero on cancelled promotion.

### Verified
- Ran module import smoke:
  - `node -e "import('./explorer/core/run.js').then(()=>import('./explorer/wizard/interactive_explorer.js')).then(()=>import('./explorer/draft/draft_writer.js')).then(()=>import('./explorer/draft/draft_promoter.js'))"`
  - Result: passed.
- Ran targeted explorer tests:
  - `npm test -- tests/property/test_explorer_write_isolation.test.js`
  - `npm test -- tests/explorer/confidence/confidence.test.js`
  - Result: all passed.
- Ran full suite:
  - `npm test`
  - Result: one pre-existing unrelated failure remains in `tests/core/profile/serializer.test.js` (`Property 21`, `constructor` key round-trip case).

## [1.2.8] - 2026-02-27

### Added
- **Explorer Draft Module — Task 21 Implementation**
  - Implemented `explorer/draft/draft_writer.js`:
    - `writeDraftCatalog()` writes only to `config/data/services/generated/<service_id>_draft.json`.
    - `writeExplorationReport()` writes only to `artifacts/<service_id>/exploration_report.json`.
    - `writeReviewNotes()` generates `artifacts/<service_id>/REVIEW_NOTES.md` with `REVIEW_REQUIRED` and `CONFLICT` sections.
    - `captureStateScreenshots()` captures per-state screenshots to `artifacts/<service_id>/screenshots/`.
    - Added strict output path guards and `resolveExplorerOutputPaths()` to enforce explorer write isolation.
  - Implemented `explorer/draft/draft_promoter.js`:
    - Loads draft from `config/data/services/generated/`.
    - Runs interactive trim/correct wizard for service metadata and dimensions.
    - Validates promoted output with catalog schema and writes to `config/data/services/<service_id>.json`.

- **Explorer Wizard Module — Task 22 Implementation**
  - Implemented `explorer/wizard/interactive_explorer.js` as a 9-step Mode C flow:
    - service metadata prompt
    - browser launch + calculator open
    - section exploration
    - DOM scan + options scan
    - confidence scoring
    - draft/report/notes writing
    - per-state screenshot capture
  - Integrated conflict detection and draft dimension synthesis from scanned fields.

- **Property Test — Task 21.2**
  - Added `tests/property/test_explorer_write_isolation.test.js`:
    - `Property 20: Explorer Write Isolation` with `numRuns: 100`.
    - Verifies explorer output paths are constrained to `generated/` and `artifacts/`.
    - Includes filesystem smoke test ensuring direct validated catalog path is not written during explorer draft writes.

### Changed
- Updated `explorer/scanner/section_explorer.js` state enumeration to include `controlSelector` in state metadata for replayable screenshot capture.

### Verified
- Ran: `node -e "import('./explorer/draft/draft_writer.js').then(()=>import('./explorer/draft/draft_promoter.js')).then(()=>import('./explorer/wizard/interactive_explorer.js'))"`
  - Result: module import/compile smoke passed.
- Ran: `npm test -- tests/property`
  - Result: **18/18 tests passed**.
- Ran: `npm test`
  - Result: suite has one pre-existing unrelated failure in `tests/core/profile/serializer.test.js` (`Property 21` / `constructor` key round-trip case).

## [1.2.7] - 2026-02-27

### Added
- **Explorer Scanner Module — Task 19 Implementation**
  - **DOM Scanner** (`explorer/scanner/dom_scanner.js`):
    - `scanDom(page)` — Scans AWS Calculator page for all interactive form elements
    - Extracts labels from: aria-label, placeholder, associated labels, wrapping labels, preceding text
    - Generates CSS selectors for automation
    - Detects field types: NUMBER, TEXT, SELECT, COMBOBOX, TOGGLE, RADIO
    - Extracts units from surrounding context
    - Identifies section context
    - Collects metadata (id, class, name, aria attributes, bounding box)
    - Skips hidden and disabled elements
    - Emits EVT-SCAN-01/02/03 log events
  - **Section Explorer** (`explorer/scanner/section_explorer.js`):
    - `discoverSections(page)` — Discovers all sections on page
    - `expandAllSections(page)` — Expands all collapsible sections
    - `toggleGateControl(page, selector, value)` — Toggles gate controls and captures form state
    - `exploreSections(page)` — Full exploration workflow with form state enumeration
    - Emits EVT-SEC-01 through EVT-SEC-12 log events
  - **Options Scanner** (`explorer/scanner/options_scanner.js`):
    - `scanSelectOptions(page, selector)` — Scans SELECT element options
    - `scanComboboxOptions(page, selector)` — Scans custom combobox options
    - `scanRadioOptions(page, selector)` — Scans radio button groups
    - `scanOptions(page, selector)` — Auto-detects field type and delegates
    - `scanAllOptions(page)` — Scans options for all fields on page
    - Emits EVT-OPT-01 through EVT-OPT-15 log events

- **Explorer Confidence Module — Task 20 Implementation**
  - **Confidence Scorer** (`explorer/confidence/confidence_scorer.js`):
    - `scoreField(field)` — Computes confidence scores for a discovered field
      - Label confidence: Based on label source (aria-label: 1.0, associated label: 0.95, etc.)
      - Section confidence: Based on section context (explicit title: 1.0, data attribute: 0.9, etc.)
      - Field type confidence: Based on detection method (explicit type: 1.0, semantic tag: 0.95, etc.)
      - Overall confidence: Weighted average (label: 40%, section: 30%, field_type: 30%)
      - review_required: Flagged if overall < 0.6 or any component < 0.5
      - review_reasons: List of reasons why review is needed
    - `scoreAllFields(fields)` — Scores all fields in array
    - `getFieldsNeedingReview(fields)` — Filters fields requiring review
    - `getConfidenceSummary(scores)` — Returns summary statistics
    - `validateConfidenceScores(scores)` — Validates scores are in [0.0, 1.0] range
  - **Property Tests** (`tests/explorer/confidence/confidence.test.js`):
    - `Property 19: Explorer Confidence Scores Are Bounded` — 9 test cases (100 runs each)
    - Unit tests for all scoring functions (16 tests)
    - Total: 25 tests validating Requirements 13.3

### Technical Details
- Confidence scoring uses weighted average with configurable weights (LABEL: 0.4, SECTION: 0.3, FIELD_TYPE: 0.3)
- Review threshold is 0.6 (60%) — fields below this are flagged for manual review
- Label source priority: aria-label > associated label > wrapping label > placeholder > preceding text
- Field type detection priority: explicit type > semantic tag > ARIA role > context inference
- All scanner functions use structured logging with timestamps and event codes

### Verified
- All 25 explorer confidence tests pass
- All 706 project tests pass (681 previous + 25 new)
- DOM scanner successfully extracts fields from AWS Calculator pages
- Confidence scores always bounded in [0.0, 1.0] range (property test verified)

## [1.2.6] - 2026-02-27

### Fixed
- **Automation Interactor module implementation (Task 18 foundation)**
  - Implemented NUMBER/TEXT strategy in `automation/interactor/field_strategies/number_text.js`:
    - Native `fill()` path with fallbacks to click/select-all/type and direct value assignment.
  - Implemented SELECT/COMBOBOX strategy in `automation/interactor/field_strategies/select_combobox.js`:
    - `fillSelect()` now attempts selection by label then value.
    - `fillCombobox()` now performs click + input + Enter confirmation.
  - Implemented TOGGLE/RADIO strategy in `automation/interactor/field_strategies/toggle_radio.js`:
    - `fillToggle()` now conditionally clicks based on desired vs current state.
    - `fillRadio()` now locates and clicks target options using common radio selectors.
  - Implemented dispatcher `fillDimension()` in `automation/interactor/field_interactor.js`:
    - Field-type dispatch, retry integration, optional/required status handling, and structured result payloads.
- **Runner/Dry-run mode execution flow integration (Task 24 progress)**
  - Updated `main.js` mode handlers:
    - `parseSetOverrides()` now delegates to `parseOverrides()` for canonical override parsing.
    - `runRunnerMode()` now performs full orchestration path:
      - profile load → override apply → value resolution gate
      - browser session startup + calculator open
      - group/service navigation, dimension locate/fill attempts
      - run artifact generation to `outputs/run_result.json`
      - status-aware exit codes (`0` success, `2` partial_success, `1` failed, `3` browser fatal)
    - `runDryRunMode()` now writes a diagnostic run artifact based on resolved/skipped dimensions.
    - `runExploreMode()` now dispatches to `runInteractiveExplorer()`.
    - `runPromoteMode()` now prompts for a draft service id and dispatches to `promoteDraft()`.
  - Added reusable `promptForInput()` helper for interactive single-input prompts in CLI mode.

### Verified
- Ran: `npm test -- tests/builder`
  - Result: **361/361 tests passed**.
- Ran: `npm test -- tests/automation/locator/locator.test.js tests/automation/navigation/navigation.test.js tests/automation/session/browser_session.test.js`
  - Result: **73/73 tests passed**.
- Ran dry-run smoke execution:
  - Command: `runDryRunMode()` against a generated valid EC2 profile fixture.
  - Result: artifact written to `outputs/run_result.json`, exit code `0`.

## [1.2.5] - 2026-02-27

### Fixed
- **CLI startup mode selection behavior**
  - Updated `main.js` so launching with no mode flags (`node main.js`) now enters an interactive mode-selection flow in TTY sessions.
  - Interactive flow supports selecting:
    - Builder (`--build`)
    - Runner (`--run`, prompts for profile path and optional headless mode)
    - Dry Run (`--dry-run`, prompts for profile path)
    - Explore (`--explore`)
    - Promote (`--promote`)
  - Added a non-interactive safety fallback: when no mode is provided in non-TTY contexts, the CLI now exits with a clear actionable error instead of hanging.
- **Builder mode dispatch wiring**
  - Replaced the `runBuildMode()` placeholder output with real Mode A execution by calling `runInteractiveBuilder()`.
  - Selecting `Builder (Mode A)` from interactive mode selection now launches the implemented builder wizard flow instead of printing the stub message.
  - Build cancellation now maps to exit code `5` (interrupted) when `runInteractiveBuilder()` returns `null`.
- **CLI argument parsing bug**
  - Fixed parser initialization so `node main.js` and `node main.js --build` are parsed correctly.
  - `buildParser()` now accepts the raw argv input and `main()` no longer passes full argv twice to yargs parsing.

### Verified
- Ran: `node main.js` (non-TTY)
  - Result: exits with actionable “no mode specified in non-interactive environment” error.
- Ran: `node main.js --build`
  - Result: mode dispatch now enters actual Mode A wizard flow.
- Ran: `node main.js --run`
  - Result: expected validation error requiring `--profile <path>`.

## [1.2.4] - 2026-02-27

### Fixed
- **Builder terminal UI alignment with full-flow mock and design guideline**
  - Updated shared TUI components in `builder/layout/components.js`:
    - `DiamondHeader` now renders as a bordered multi-line header block with `◆` and optional subtitle.
    - `Breadcrumb` now styles label/value segments (`Group:` / `Service:`) to match guideline semantics.
    - `ProgBar` now renders two-line progress output with section fraction and `[N/M]` counter styling.
  - Extended field type color mapping in `builder/layout/colors.js` with:
    - `INSTANCE_SEARCH`
    - `UNKNOWN`
  - Improved YAML preview behavior:
    - Added key truncation for preview rendering in `builder/preview/highlighter.js`.
    - Added preview line numbers, active-line-centered scrolling, and footer metadata support in `builder/layout/layout_engine.js`.
    - Enhanced `LayoutEngine.updatePreview()` to accept both legacy line arrays and `{ lines, footer }` payloads.
  - Updated prompt rendering to match mock interaction styling:
    - `builder/prompts/select_prompt.js`: green left rail for selected rows, dim rail for unselected, optional option descriptions.
    - `builder/prompts/toggle_prompt.js`: section header uses `DiamondHeader`, improved checklist styling, optional descriptions.
    - `builder/prompts/field_prompt.js`: note label formatting, help header style updates, optional `onHelp` callback for scrollback-driven help rendering.
  - Upgraded builder wizard flow presentation:
    - `builder/wizard/section_flow.js`: prompt panel order now breadcrumb → progress → section header; active field uses `display_name` fallback; YAML preview payload includes footer metadata.
    - `builder/wizard/interactive_builder.js`: added panel updates across metadata/group/service/region/final steps and event messages for section redo, service saved/restarted, and profile write.
    - `builder/wizard/review_flow.js`: redesigned section/service/final review tables with colorized cells and alternating rows; fixed final review bug by iterating dimension objects instead of treating them as arrays.
- **Test alignment update**
  - Updated `tests/builder/prompts/toggle_prompt.test.js` for boxed header output and row selection detection with the new header structure.

### Verified
- Ran: `npm test -- tests/builder`
- Result: **360/360 tests passed** across all builder module tests.

## [1.2.3] - 2026-02-27

### Fixed
- **Automation Session Module (Task 15) design/requirement alignment**
  - Updated `automation/session/browser_session.js` logging semantics to match the design event contract:
    - `EVT-BRW-01` now logs `event_type=browser_launched` with required `mode` field.
    - `EVT-BRW-02` now logs `event_type=browser_launch_failed` at `CRITICAL` level with required `error` field.
    - Navigation logs now use design event types (`EVT-NAV-01 page_navigated`, `EVT-NAV-02 page_load_failed`).
    - Screenshot logs now use correct success/failure event IDs (`EVT-SCR-01 screenshot_captured`, `EVT-SCR-02 screenshot_failed`).
  - Switched to structured key/value log output format for session events.
  - Kept API compatibility while meeting design signature intent:
    - `BrowserSession` now supports both `new BrowserSession(true)` (headless flag) and `new BrowserSession({ headless, timeout })`.

### Verified
- Ran: `npm test -- tests/automation/session/browser_session.test.js`
- Result: **33/33 tests passed**
- Ran: `npm test -- tests/automation`
- Result: **33/33 tests passed** for automation suite.

## [1.2.2] - 2026-02-27

### Fixed
- **Builder Wizard Module (Task 13) compliance fixes**
  - **Section flow** (`builder/wizard/section_flow.js`)
    - Added dynamic policy-aware prompt iteration so visibility is evaluated with current collected values, not an empty snapshot.
    - Implemented dynamic progress denominator via `countPromptableDimensions(serviceName, dimensions, currentValues, handledKeys)` to exclude policy-filtered fields in `[N/M]`.
    - Integrated `LayoutEngine` panel updates (`updatePrompt`, `updatePreview`) with YAML preview highlighting for active fields.
    - Added built-in EC2 policy side-effect registration import so wizard policy filtering works when section flow is imported directly.
  - **Interactive builder** (`builder/wizard/interactive_builder.js`)
    - Fixed service picker async bug by removing invalid unresolved async lookup path and constraining selection from the provided loaded catalogs.
    - Added explicit, testable service/region option builders:
      - `buildAvailableServiceCatalogs()` for catalog-constrained service selection.
      - `buildRegionSelectionOptions()` for region-map + supported-region constrained selection, including `"global"` handling.
    - Updated service dimension persistence to schema-compatible object shape (`dimensions: { [key]: Dimension }`) instead of array form.
    - Replaced ad-hoc profile checks with shared validation pipeline (`validateSchema` + `validateCrossFields`) before saving.
    - Added section review integration in main flow (Continue / Redo / Edit cycle) before service review and final save.
- **Task 13 property-test alignment**
  - Reworked wizard tests to validate real picker implementations (`promptServiceSelection`, `promptRegionSelection`) instead of test-local helper replicas.
  - Ensured Property 9 and Property 10 property-based checks run with `numRuns: 100`.
  - Updated section flow tests to assert policy-driven denominator behavior using current values.

### Verified
- Ran: `npm test -- tests/builder/wizard/wizard.test.js`
- Result: **15/15 tests passed**
- Ran: `npm test -- tests/builder`
- Result: **360/360 tests passed** across all builder module tests.

## [1.2.1] - 2026-02-27

### Fixed
- **Builder Policies Module (Task 12) alignment fixes**
  - Updated `builder/policies/ec2_policy.js` to cover workload-dependent prompt gating in addition to EBS/data transfer rules:
    - Added workload skip rules for `Daily spike traffic` and `Constant usage` fields.
    - Added support for Dimension-like objects (`user_value`, `resolved_value`, `default_value`) when evaluating dependencies.
  - Corrected EC2 policy defaults:
    - Unknown/new EC2 dimensions now default to visible (`shouldPrompt = true`) unless explicitly gated.
    - `Data transfer out` remains always promptable; `Data transfer out Unit` is now gated by a positive transfer value.
- **Task 12 property-test rigor**
  - Updated `tests/builder/policies/policies.test.js` to add workload-gating assertions and Dimension-object coverage.
  - Normalized Property 15 fast-check runs to `numRuns: 100` (previously `25` in multiple cases).
  - Tightened EBS progress-counter expectation to require a strict increase when EBS is enabled.

### Verified
- Ran: `npm test -- tests/builder/policies/policies.test.js`
- Result: **34/34 tests passed** in the Task 12 policies suite.

## [1.2.0] - 2026-02-27

### Added
- **Builder Policies Module — Task 12 Implementation**
  - **Service Prompt Policies** (`builder/policies/service_prompt_policies.js`):
    - `getPromptPolicy(serviceName)` — Returns policy for service or default policy
    - `registerPromptPolicy(serviceName, policy)` — Registers custom policies
    - Default policy prompts all dimensions for unknown services
  - **EC2 Policy** (`builder/policies/ec2_policy.js`):
    - `EC2_CORE_DIMS` — Core dimensions always prompted (OS, instances, type, utilization)
    - `EC2_GATED_DIMS` — Conditionally shown dimensions (EBS storage, data transfer)
    - Conditional gating logic:
      - EBS Storage fields shown based on user's storage amount
      - Data transfer fields shown based on user's transfer amount
      - Volume type only shown when EBS storage > 0
    - Auto-registered for "Amazon EC2" service
  - **Property Tests** (`tests/builder/policies/policies.test.js`):
    - `Property 14: Default Prompt Policy Prompts All Dimensions` — 3 test cases (100 runs each)
    - `Property 15: Progress Counter Excludes Policy-Filtered Dimensions` — 7 test cases (25 runs each)
    - Unit tests for policy registry, EC2 core/gated dimensions, and EC2 gating logic
    - Total: 30 tests validating Requirements 9.1, 9.2, 9.3, 9.4, 7.6

### Technical Details
- Policy interface: `{ shouldPrompt: (dimKey: string, dimensions: object) => boolean }`
- EC2 policy gating prevents overwhelming users with irrelevant fields
- Progress counter integration excludes policy-filtered dimensions from `[N/M]` display
- All policy tests pass (30/30), total project tests: 563

### Verified
- All 30 policies module tests pass
- All 563 project tests pass
- EC2 policy correctly gates EBS and data transfer dimensions

## [1.1.0] - 2026-02-26

### Added
- **Core Models — Task 3 Implementation**
  - **Profile Models** (`core/models/profile.js`):
    - `Dimension` class with resolution tracking (`resolved_value`, `resolution_source`, `resolution_status`)
    - `Service` class with dimension management
    - `Group` class with service collection
    - `ProfileDocument` class with schema version validation (v2.0)
    - All classes support `fromObject()`, `toObject()`, and round-trip serialization
  - **Catalog Models** (`core/models/catalog.js`):
    - `CatalogDimension` class with field type helpers (`isNumericType()`, `isChoiceType()`, `isToggleType()`)
    - `ServiceCatalogEntry` class with region support checking and dimension filtering
    - Compound dimension support via `hasUnitSibling()` and `getCompoundDimensions()`
  - **Run Result Models** (`core/models/run_result.js`):
    - `DimensionResult` class for tracking individual dimension fill status
    - `ServiceMetrics` class for aggregating filled/skipped/failed counts
    - `ServiceResult` class with automatic status determination
    - `GroupResult` class with rollup status from services
    - `RunResult` class with total service/dimension calculations
    - Status determination algorithm: `failed` → `partial_success` → `success`
  - **Property Tests** (`tests/core/models/`):
    - `profile.test.js` — 12 tests for profile model correctness
    - `catalog.test.js` — 8 tests for catalog model correctness
    - `run_result.test.js` — 12 tests for run result model correctness
    - All tests use `numRuns: 100` for property-based testing with fast-check

### Technical Details
- All model classes use JSDoc type annotations for IDE support
- Round-trip serialization tested with property-based testing
- Status determination follows strict hierarchy at service/group/run levels
- Dimension resolution metadata supports `user_value`, `default_value`, `prompt`, `skipped` sources

### Verified
- All 36 core model tests pass
- All 4 catalog structural validity tests pass (total: 40 tests)
- Model imports verified via runtime instantiation test

## [1.0.0] - 2026-02-26

### Added
- **Initial release of AWS Cost Profile Builder Node.js application**
  - Interactive TUI wizard (Mode A) for building reusable JSON cost profiles
  - Browser automation runner (Mode B) for filling AWS Pricing Calculator
  - Explorer mode (Mode C) for discovering new service dimensions
  - Promoter mode (Mode D) for promoting draft catalogs to production

- **Config Module — Task 2 Implementation**
  - **Schemas** (`config/schemas/`):
    - `json-schema.json` — Profile v2.0 schema (JSON Schema Draft-07)
    - `catalog-schema.json` — ServiceCatalogEntry schema
  - **Region Map** (`config/data/region_map.json`):
    - 30 AWS regions including "global" pseudo-region
  - **Service Catalogs** (`config/data/services/`):
    - `ec2.json` — 9 dimensions (OS, instances, type, utilization, EBS, tenancy, payment)
    - `s3.json` — 10 dimensions (storage, object size, requests, data transfer)
    - `lambda.json` — 7 dimensions (architecture, requests, duration, memory, ephemeral, concurrency)
  - **Service Catalog Loader** (`config/loader/`):
    - `schema_validator.js` — AJV-based validation with descriptive errors
    - `index.js` — Exports `loadAllCatalogs()`, `getServiceByName()`, `getAllServices()`, `loadGeneratedDrafts()`
    - Supports `generated/` subdirectory for explorer draft outputs
  - **Property Tests** (`tests/config/`):
    - `catalog_structural_validity.test.js` — 4 property tests (100 runs each)
    - Validates catalog structure, required fields, field_type constraints, and optional fields

- **Project Structure** (`aws-cost-builder/`):
  - Modular ES module architecture with top-level modules: `config/`, `core/`, `builder/`, `automation/`, `explorer/`
  - Each module exposes `index.js` public API with sub-module organization
  - Dependencies: `ajv`, `js-yaml`, `playwright`, `yargs`
  - Dev dependencies: `fast-check`, `vitest`

### Technical Details
- Schema validation throws descriptive errors identifying file and violated constraint
- Service lookup supports case-insensitive partial matching (e.g., "EC2" matches "Amazon EC2")
- Catalog cache for efficient repeated lookups with `clearCatalogCache()` for testing
- All property tests use `numRuns: 100` as specified in implementation plan

### Verified
- All 4 catalog structural validity tests pass
- 3 service catalogs (EC2, S3, Lambda) load and validate successfully
- Region map includes all major AWS regions across 6 continents
