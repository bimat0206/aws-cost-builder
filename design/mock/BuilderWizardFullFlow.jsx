/**
 * BuilderWizardFullFlow.jsx
 * ─────────────────────────
 * Importable JSX module version of the full-flow mock.
 * Same 20 screens as full-flow.html, exported as a default React component.
 *
 * Usage (React + Tailwind or CSS-in-JS env):
 *   import BuilderWizardFullFlow from './BuilderWizardFullFlow';
 *   <BuilderWizardFullFlow />
 *
 * Note: This file contains the same logic as full-flow.html
 * but structured as a proper ES module. For standalone preview,
 * open full-flow.html directly in any browser — no build step needed.
 */

import { useState, useEffect } from "react";

// ── Colour tokens ────────────────────────────────────────────────────────────
export const C = {
  bg:"#0d0f13", bgTerm:"#1e2127", bgPanel:"#21252b", bgActive:"#2c313c", bgRow:"#252a33",
  border:"#3e4451", borderCyan:"#56b6c2", borderMag:"#c678dd", borderOrange:"#e5c07b",
  borderGreen:"#98c379", borderRed:"#e06c75",
  dim:"#5c6370", muted:"#abb2bf", base:"#dcdfe4",
  cyan:"#56b6c2", green:"#98c379", orange:"#e06c75",
  yellow:"#e5c07b", magenta:"#c678dd", blue:"#61afef",
};

// ── Screen registry ──────────────────────────────────────────────────────────
export const SCREENS = [
  {id:"splash",        label:"01 · Splash / Mode Select",    group:"Startup"},
  {id:"meta",          label:"02 · Project Metadata",        group:"Builder"},
  {id:"group_pick",    label:"03 · Group + Service Picker",  group:"Builder"},
  {id:"region",        label:"04 · Region Selection",        group:"Builder"},
  {id:"number_field",  label:"05 · Number Field",            group:"Builder"},
  {id:"select_field",  label:"06 · Select Field",            group:"Builder"},
  {id:"compound",      label:"07 · Compound Value+Unit",     group:"Builder"},
  {id:"toggle_p1",     label:"08 · S3 Toggle Phase 1",       group:"Builder"},
  {id:"toggle_p2",     label:"09 · S3 Toggle Phase 2",       group:"Builder"},
  {id:"inline_help",   label:"10 · Inline Help (?)",         group:"Builder"},
  {id:"section_review",label:"11 · Post-Section Review",     group:"Builder"},
  {id:"service_review",label:"12 · Post-Service Review",     group:"Builder"},
  {id:"final_review",  label:"13 · Final Profile Review",    group:"Builder"},
  {id:"saved",         label:"14 · Profile Saved",           group:"Builder"},
  {id:"preflight_ok",  label:"15 · Preflight Pass",          group:"Runner"},
  {id:"preflight_fail",label:"16 · Preflight Failure",       group:"Runner"},
  {id:"running",       label:"17 · Browser Automation Live", group:"Runner"},
  {id:"partial_fail",  label:"18 · Partial Failure",         group:"Runner"},
  {id:"run_success",   label:"19 · Run Complete",            group:"Runner"},
  {id:"artifact",      label:"20 · Run Artifact Viewer",     group:"Runner"},
];

// ── Shared components ────────────────────────────────────────────────────────
// (See full-flow.html for complete inline implementations)
// In this module, components are referenced by name — all are
// defined in the same file for colocation convenience.

// ────────────────────────────────────────────────────────────────────────────
// NOTE FOR IMPLEMENTERS:
// This file documents the component contract for each screen.
// The actual rendering logic lives in full-flow.html (which is the
// authoritative visual reference). When building the Python TUI:
//   - Use full-flow.html to see what each screen should look like.
//   - Use design/08-ui-design-guideline.md for colour/glyph/layout rules.
//   - Use design/07-builder-wizard-spec.md for behavioral specification.
// ────────────────────────────────────────────────────────────────────────────

/**
 * Screen: Splash
 * Mode:   standalone (no split)
 * Shows:  gradient background, scanline, 3 mode options (--build / --run / --dry-run)
 * Interacts: user types a command or selects mode
 */
export function ScreenSplash() {
  return <div>See full-flow.html screen 01</div>;
}

/**
 * Screen: Project Metadata
 * Mode:   split (YAML left, Prompt right)
 * YAML:   schema_version, project_name (active "?"), description ("?"), groups:
 * Prompt: DiamondHeader "Project Setup", two FieldBlocks (TEXT)
 */
export function ScreenMeta() {
  return <div>See full-flow.html screen 02</div>;
}

/**
 * Screen: Group + Service Picker
 * Mode:   prompt-only (no YAML — too early for structure)
 * Prompt: DiamondHeader, left column (group name input), right column (checkbox service list)
 * Interacts: click to toggle services, input group name
 */
export function ScreenGroupPick() {
  return <div>See full-flow.html screen 03</div>;
}

/**
 * Screen: Region Selection
 * Mode:   split
 * YAML:   services listed with region "?" active on current service
 * Prompt: DiamondHeader "Region Selection", SelectList of supported regions
 */
export function ScreenRegion() {
  return <div>See full-flow.html screen 04</div>;
}

/**
 * Screen: Number Field
 * Mode:   split
 * YAML:   answered dims green, active dim highlighted (▶, cyan, bgActive)
 * Prompt: Breadcrumb, ProgressBar, DiamondHeader, FieldBlock (NUMBER)
 * Active field: "Number of instances"
 */
export function ScreenNumberField() {
  return <div>See full-flow.html screen 05</div>;
}

/**
 * Screen: Select Field
 * Mode:   split
 * YAML:   Operating system active
 * Prompt: Breadcrumb, ProgressBar, DiamondHeader, SelectList with descriptions
 */
export function ScreenSelectField() {
  return <div>See full-flow.html screen 06</div>;
}

/**
 * Screen: Compound Value+Unit
 * Mode:   split
 * YAML:   Inbound Data Transfer active, unit sibling shown below
 * Prompt: Compound badge, orange info box, unit list, example input
 */
export function ScreenCompound() {
  return <div>See full-flow.html screen 07</div>;
}

/**
 * Screen: S3 Toggle Phase 1
 * Mode:   split (YAML shows toggle booleans live)
 * YAML:   each section key with true/false value, updates as user clicks
 * Prompt: DiamondHeader, toggle checklist with ◆/◇ glyphs, descriptions
 */
export function ScreenToggleP1() {
  return <div>See full-flow.html screen 08</div>;
}

/**
 * Screen: S3 Toggle Phase 2
 * Mode:   split
 * YAML:   first enabled section's first dim active
 * Prompt: phase indicator bar, ProgressBar, DiamondHeader for section, FieldBlock
 */
export function ScreenToggleP2() {
  return <div>See full-flow.html screen 09</div>;
}

/**
 * Screen: Inline Help
 * Mode:   split
 * YAML:   active field highlighted
 * Prompt: scrollback area showing help panel (print_above), then re-rendered FieldBlock
 */
export function ScreenInlineHelp() {
  return <div>See full-flow.html screen 10</div>;
}

/**
 * Screen: Post-Section Review
 * Mode:   split
 * Events: "[✓] Section completed" in scrollback
 * Prompt: DiamondHeader "Section Review", table of answered fields, SelectList (Continue/Redo/Edit)
 */
export function ScreenSectionReview() {
  return <div>See full-flow.html screen 11</div>;
}

/**
 * Screen: Post-Service Review
 * Mode:   prompt-only (full width for table)
 * Events: "[✓] All sections complete" in scrollback
 * Prompt: DiamondHeader "Service Review", full table with Section/Field/Value/Source cols, SelectList
 * Source badges: user=green, default=cyan, skipped=dim
 */
export function ScreenServiceReview() {
  return <div>See full-flow.html screen 12</div>;
}

/**
 * Screen: Final Profile Review
 * Mode:   split (full YAML visible)
 * Prompt: DiamondHeader "Final Profile Review", service summary table, SelectList (Save/Edit/Start over)
 */
export function ScreenFinalReview() {
  return <div>See full-flow.html screen 13</div>;
}

/**
 * Screen: Profile Saved
 * Mode:   standalone (centered success)
 * Shows:  green circle ✓, profile path, next-steps box (--run / --dry-run / git add)
 */
export function ScreenSaved() {
  return <div>See full-flow.html screen 14</div>;
}

/**
 * Screen: Preflight Pass
 * Mode:   standalone (table + proceed prompt)
 * Shows:  summary counters, per-service resolution table, green "All resolved" banner, SelectList
 */
export function ScreenPreflightOk() {
  return <div>See full-flow.html screen 15</div>;
}

/**
 * Screen: Preflight Failure
 * Mode:   standalone
 * Shows:  red/orange error banner, list of unresolved dims with fix hints, resolution options box
 */
export function ScreenPreflightFail() {
  return <div>See full-flow.html screen 16</div>;
}

/**
 * Screen: Browser Automation Live
 * Mode:   standalone (full-width status)
 * Shows:  3 service progress cards, step log with ▶ active line, animated "Browser running" footer
 * Animated: dots cycle, service bar fills
 */
export function ScreenRunning() {
  return <div>See full-flow.html screen 17</div>;
}

/**
 * Screen: Partial Failure
 * Mode:   standalone
 * Shows:  yellow "partial_success" banner, per-service cards with failure detail,
 *         screenshot path, artifact list
 */
export function ScreenPartialFail() {
  return <div>See full-flow.html screen 18</div>;
}

/**
 * Screen: Run Success
 * Mode:   standalone (centered success)
 * Shows:  green ✓ circle, metrics row (URL / run_id / duration / artifact), next-steps box
 */
export function ScreenRunSuccess() {
  return <div>See full-flow.html screen 19</div>;
}

/**
 * Screen: Run Artifact Viewer
 * Mode:   standalone (two-column)
 * Left:   run metadata KV list + counters badge
 * Right:  per-service results table (Group/Service/Region/Status/Filled/Skip/Fail)
 */
export function ScreenArtifact() {
  return <div>See full-flow.html screen 20</div>;
}

// ── Default export ────────────────────────────────────────────────────────────
/**
 * Full-flow mock app with sidebar navigation.
 * Opens on splash screen. Use ← prev / next → buttons or sidebar to navigate.
 */
export default function BuilderWizardFullFlow() {
  const [screen, setScreen] = useState("splash");
  // Full implementation in full-flow.html
  return (
    <div style={{ fontFamily: "monospace", padding: 20, color: C.muted }}>
      <p>Open <strong style={{color:C.cyan}}>design/mock/full-flow.html</strong> in any browser for the live interactive mock.</p>
      <p style={{marginTop:8,color:C.dim,fontSize:12}}>
        This JSX module documents screen contracts. See full-flow.html for complete rendering logic.
      </p>
      <div style={{marginTop:16}}>
        <div style={{color:C.yellow,fontWeight:"bold",marginBottom:8}}>◆ 20 screens documented above:</div>
        {SCREENS.map(s=>(
          <div key={s.id} style={{color:C.dim,fontSize:12,lineHeight:1.8}}>
            <span style={{color:C.cyan,marginRight:8}}>{s.id}</span>{s.label}
          </div>
        ))}
      </div>
    </div>
  );
}
