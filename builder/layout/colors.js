/**
 * All COL_* colour constants and layout constants for the TUI.
 *
 * Every hex value is the single source of truth — never hardcode these at call sites.
 * All modules that need colour must import from here.
 *
 * @module builder/layout/colors
 */

// ─── Background tokens ────────────────────────────────────────────────────────
export const COL_BG          = '#1e2127';   // outer / page background (matches guideline)
export const COL_BG_TERM     = '#1e2127';   // terminal window background
export const COL_BG_PANEL    = '#21252b';   // panel background
export const COL_BG_ACTIVE   = '#2c313c';   // active / highlighted row background
export const COL_BG_ROW      = '#252a33';   // alternating table row background

// ─── Border & Semantic tokens ─────────────────────────────────────────────────
export const COL_BORDER = '#3e4451'; // default border
export const COL_YAML   = '#56b6c2'; // YAML panel border + glyph + active line (cyan)
export const COL_PROMPT = '#c678dd'; // prompt panel border (magenta)
export const COL_SECTION = '#e5c07b'; // section header border (orange/yellow)
export const COL_GREEN_BORDER = '#98c379'; // success box border
export const COL_RED_BORDER   = '#e06c75'; // error box border

// ─── Text tokens ─────────────────────────────────────────────────────────────
export const COL_DIM   = '#5c6370';
export const COL_MUTED = '#abb2bf';
export const COL_BASE  = '#dcdfe4';

// ─── Accent tokens ────────────────────────────────────────────────────────────
export const COL_CYAN    = '#56b6c2';
export const COL_GREEN   = '#98c379';
export const COL_ORANGE  = '#e06c75';
export const COL_YELLOW  = '#e5c07b';
export const COL_MAGENTA = '#c678dd';
export const COL_BLUE    = '#61afef';

// ─── Layout constants ─────────────────────────────────────────────────────────

/** Minimum terminal column width to enter split-screen mode. */
export const MIN_SPLIT_WIDTH = 120;

/** Fixed character width of the YAML preview panel (left pane). */
export const YAML_PANEL_WIDTH = 62;

// ─── Field type → colour map ─────────────────────────────────────────────────

/** Maps each field_type value to its badge accent colour. */
export const FIELD_TYPE_COLORS = {
  NUMBER:   COL_CYAN,
  TEXT:     COL_CYAN,
  SELECT:   COL_YELLOW,
  RADIO:    COL_YELLOW,
  COMBOBOX: COL_MAGENTA,
  TOGGLE:   COL_GREEN,
  INSTANCE_SEARCH: COL_BLUE,
  UNKNOWN: COL_DIM,
};
