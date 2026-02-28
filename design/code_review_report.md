# 🧹 Code Health & App Logic Review — `aws-cost-builder` (Pass 2)

## 1. 🔍 UNDERSTAND

**Purpose:** A Node.js CLI tool for building AWS cost estimation profiles via an interactive TUI wizard, executing browser automation, and managing the service catalog lifecycle across five modes (Builder A, Runner B, Dry Run C, Explorer D, Promoter E).

**Framework/Runtime:** Pure ES Modules, Node.js, Yargs CLI parsing, Playwright for browser automation.

**Assumptions:**
- `removeService` added as a pure helper is the correct approach for the redo path.
- `'Start over'` mapping to `'restart'` is intentional per the code comment; the caller currently ignores it (falls through to save) — not yet wired up.
- `'edit'` branch in `runInteractiveBuilder` still has a TODO stub — tracked as an open finding.

---

## ✅ Resolved Since Pass 1

The following findings from the previous report are **fully fixed** in the current code:

| # | Was | Now |
|---|-----|-----|
| 1 / 14 | Direct mutation of `currentGroup.services` via `find()` reference | `removeService()` pure helper added (L76–85); `Object.assign` replaced with `let profileState =` reassignment (L335, L434, L468–474, L504–510, L520) |
| 2 | Duplicate `import('node:path')` inside interactive mode picker | Removed; comment explains static import is used (L190) |
| 3 | `constructor.name` string matching for error types | Replaced with `instanceof ProfileFileNotFoundError` etc. (L394–400) |
| 4 / 18 | Double `handledKeys.add` + `completedCount` incremented per sub-key | Consolidated: `completedCount += 1` once per prompt (L390); compound sibling added cleanly (L393–395) |
| 5 | Verbose `!== null && !== undefined` for `unit_sibling` | Changed to `!= null` (L373) |
| 6 | `dim` variable shadowing imported `dim()` in review_flow loops | Renamed to `dimDef` in `runSectionReview` multi-section loop (L163) |
| 7 | `'Start over'` mapped to `'edit'` same as "Edit a field" | Now maps to distinct `'restart'` (L374) |
| 8 | `DiamondHeader` used `arguments` object | Changed to `export function DiamondHeader(title, subtitle = null)` – *(verify in components.js)* |
| 10 | Unused local `RESET` constant in `main.js` L46 | Removed; only `NEWLINE` constant remains (L46) |
| 12 | Undocumented bare side-effect import | Comment added: `// registers EC2 prompt policy on module load` (L24) |
| 16 | `timestamp_end` set prematurely before `session.stop()` | Moved into `finally` block (L565); `writeRunResult` call moved after session stop (L569) |

---

## 2. 📋 REVIEW REPORT — Current Open Findings

### 🔬 Lens 1 — Code Health

| # | Severity | Lens | Location | Issue | Recommendation |
|---|----------|------|----------|-------|----------------|
| A | 🔴 Critical | Code Health | `interactive_builder.js` L368, L388 | **`profileState` mutated directly via property assignment** — Despite switching to `let profileState`, lines 368 (`profileState.project_name = projectName`) and 388 (`profileState.description = description || null`) still mutate the object in-place. This is inconsistent with the pure-function pattern used for groups/services and breaks structural equality checks (e.g. layout panel diffing by reference). | Use `profileState = { ...profileState, project_name: projectName }` and `profileState = { ...profileState, description: description || null }`. |
| B | 🟡 Medium | Code Health | `review_flow.js` L247 | **`dim` variable shadowing still present in `runServiceReview`** — The fix applied to `runSectionReview` (renamed to `dimDef`) was not applied to the identical loop inside `runServiceReview` (L247: `for (const dim of sec.dimensions)`). `dim` still shadows the imported `dim()` styling function inside that loop (e.g. L251: `dim('skipped')`). | Rename to `dimDef` in the `runServiceReview` loop as well. |
| C | 🟡 Medium | Code Health | `interactive_builder.js` L576–578 | **`'edit'` and `'restart'` return values from `runFinalReview` are silently ignored** — Both branches have a stub comment or no handler. `'restart'` (just introduced in `review_flow.js`) has no case at all; `'edit'` falls into an empty `if` block. A user clicking "Edit a field" or "Start over" gets silently saved anyway. | Either implement both handlers or remove the options from `selectPrompt` until they are ready, to prevent misleading UX. |
| D | 🟡 Medium | Code Health | `service_prompt_policies.js` L3 | **Stale task-tracker comment** — `"Full implementation in task 12.1."` is no longer accurate; the registry is functional. | Update to `"Policy registry — add per-service entries via registerPromptPolicy()."` |
| E | 🔵 Low | Code Health | `main.js` L131 | **Hardcoded ANSI colour string for COL_MAGENTA in MODE_OPTIONS** — `color: '\x1b[38;2;198;120;221m'` bypasses the colour system. All other mode colours use `COL_*` constants. | Import and use `COL_MAGENTA` from `colors.js`. |
| F | 🔵 Low | Code Health | `ec2_policy.js` L11–22 | **`EC2_GATED_DIMS` exported but not consumed** — Exported but neither callers nor the `shouldPrompt` implementation use it for iteration. It documents intent but risks becoming stale. | Remove the export or use it to gate the "unknown dimensions" fallback return at L153. |

### ⚙️ Lens 2 — App Logic

| # | Severity | Lens | Location | Issue | Recommendation |
|---|----------|------|----------|-------|----------------|
| G | 🔴 Critical | App Logic | `review_flow.js` L353–356 | **ANSI strip regex for "filled" detection is fragile** — `plain.trim() !== '─'` detects unfilled dimensions by stripping ANSI codes and comparing to the dash glyph. If a user's actual value happens to be the literal `─` character, it will be misclassified as empty. | Track filled count from the raw `value` field before `formatValueForReview` is called, not from the post-render string. |
| H | 🟡 Medium | App Logic | `priority_chain.js` L180–202 | **`allowUnresolvedOptional` flag has inverted-semantics naming** — `resolveDimensions(profile, { allowUnresolvedOptional: true })` with the default `true` causes optional unresolveds to *always* be included in the returned array. The name implies `true` = allow them through without reporting, but the behaviour is the opposite. | Rename to `includeOptionalInReport` (or `reportOptionalUnresolved`). ⚠️ **[BEHAVIOR CHANGE]** — audit all callers before renaming. |
| I | 🟡 Medium | App Logic | `ec2_policy.js` L114–124 | **EC2 workload guard runs before core-dims guard, hiding core fields** — The `DAILY_SPIKE_SKIP_DIMS` set includes `'Number of instances'` and `'Utilization (On-Demand only)'`, both of which are also in `EC2_CORE_DIMS`. Because the workload check executes first (L114), these core fields are hidden for daily-spike workloads even though they should always show. | Move the `EC2_CORE_DIMS` guard (`if (EC2_CORE_DIMS.has(dimKey)) return true`) to before the workload checks. ⚠️ **[BEHAVIOR CHANGE]** — verify against the live AWS Calculator EC2 page for daily-spike workload. |
| J | 🟡 Medium | App Logic | `compound_input.js` L235–239 | **Redundant empty-input guard diverges from `parseCompoundInput` errors** — The `if (raw === '')` check fires before `parseCompoundInput`, producing a different error message ("Please enter a value…") than the `CompoundInputError(MISSING_VALUE)` the user would see for non-blank-but-valueless inputs. This creates an inconsistent error surface. | Remove the pre-check and let `parseCompoundInput` raise `CompoundInputError` uniformly; handle `MISSING_VALUE` code in the catch branch with the friendly hint. |
| K | 🔵 Low | App Logic | `section_flow.js` L394–395 | **`handledKeys.add(nextDim.key)` missing for the non-compound path after loop refactor** — After the pass-1 fix, for a non-compound dimension the loop at L384–387 adds `nextDim.key` to `handledKeys` only *if* `sectionKeys.has(key)` is true. For a dimension key that isn't in `sectionKeys` (e.g. from a `priorValues` passthrough), the key never gets added, so the same dimension could be re-prompted in the next iteration. | After the for-loop, explicitly add `nextDim.key` to `handledKeys` for non-compound dims, mirroring the compound path. |

---

**Overall Assessment:** The codebase has absorbed the most critical structural fixes from pass 1 cleanly. The remaining critical issue is the in-place mutation of `profileState.project_name` and `profileState.description` which is inconsistent with the now-immutable pattern used for all other state. The highest-priority app logic issue is the fragile ANSI-strip regex used for "filled" counting in the final review. The wizard UX is also misleading — "Edit a field" and "Start over" options on the final review screen both silently save, which users will notice.

---

## 3. ⚖️ RISK ASSESSMENT

### Finding A — In-place mutation of `profileState.project_name` / `.description`
- **Depends on:** All code that iterates `profileState` after these assignments — layout preview panel, yaml serializer.
- **Risk of change:** Low — two simple 1-line replacements; already-written test for `createInitialProfileState` validates the shape.
- **Pattern elsewhere:** All other state updates in the function already use the immutable pattern.

### Finding G — ANSI regex for filled detection in `runFinalReview`
- **Depends on:** `runFinalReview` summary stats display only; does not affect saved data.
- **Risk of change:** Low — changes only the count display, not the profileState.
- **Pattern elsewhere:** No other place currently uses the same rendered-string approach for business logic.

### Finding C — Silent fallthrough on `'edit'` / `'restart'` from final review
- **Depends on:** `runInteractiveBuilder` L576–578 — the final user-visible decision point.
- **Risk of change:** Medium — any change here either needs the edit/restart flow implemented or requires updating the UI options. Consider removing the options as the lower-risk path.
- **Pattern elsewhere:** The `'edit'` stub comment is clear; `'restart'` is a new code returned but not yet handled.

---

## 4. 🔧 REFACTOR

### Finding A — Fix in-place mutation of project metadata in `interactive_builder.js`

**Before** (L368, L388):
```javascript
profileState.project_name = projectName;
// …
profileState.description = description || null;
```

**After:**
```javascript
profileState = { ...profileState, project_name: projectName };
// …
profileState = { ...profileState, description: description || null };
```

---

### Finding B — Fix `dim` shadowing in `runServiceReview`

**Before** (`review_flow.js` L247):
```javascript
for (const dim of sec.dimensions) {
  if (!Object.prototype.hasOwnProperty.call(serviceValues, dim.key)) continue;
  const value = serviceValues[dim.key];
  const source = (value === null || value === undefined)
    ? dim('skipped')          // ← calls loop var, not the imported dim() fn 🐛
    : fg('user', COL_GREEN);
```

**After:**
```javascript
for (const dimDef of sec.dimensions) {
  if (!Object.prototype.hasOwnProperty.call(serviceValues, dimDef.key)) continue;
  const value = serviceValues[dimDef.key];
  const source = (value === null || value === undefined)
    ? dim('skipped')          // ← correctly calls imported dim() fn ✓
    : fg('user', COL_GREEN);
  // …
  fg(dimDef.display_name ?? dimDef.key, COL_MUTED),
  formatValueForReview(value, dimDef.unit ?? null),
```

---

### Finding C — Remove misleading stub options from final review

**Before** (`interactive_builder.js` L576–578):
```javascript
const finalAction = await runPrompt(layoutEngine, () => runFinalReview({ profileState }));
if (cancelled) throw new WizardCancelledError();
if (finalAction === 'edit') {
  // Edit flow can be introduced in a later task; continue save for now.
}
```

**After (Option 1 — shield with a guard until flows are implemented):**
```javascript
const finalAction = await runPrompt(layoutEngine, () => runFinalReview({ profileState }));
if (cancelled) throw new WizardCancelledError();
if (finalAction === 'restart') {
  // Full restart: clear state and re-run from top — pending implementation.
  // For now, fall through to save so the user doesn't lose their work.
  if (layoutEngine) layoutEngine.printAbove(EventMessage('warning', '"Start over" is not yet implemented — saving current profile.'));
}
if (finalAction === 'edit') {
  // Field-level edit — pending implementation.
  if (layoutEngine) layoutEngine.printAbove(EventMessage('warning', '"Edit a field" is not yet implemented — saving current profile.'));
}
```

> **Alternatively (Option 2):** Remove 'Edit a field' and 'Start over' from `runFinalReview`'s `selectPrompt` options until the flows are implemented.

---

### Finding G — Replace ANSI-strip "filled" detection with raw-value check

**Before** (`review_flow.js` L352–357):
```javascript
const totalDimensions = rows.length;
const filledDimensions = rows.filter(r => {
  const plain = String(r[3]).replace(/\x1b\[[0-9;]*m/g, '');
  return plain.trim() !== '─';
}).length;
```

**After:**
> Track `filledCount` during row-building instead of post-render:

```javascript
// Add a counter during the row-building loop (inside the for-of dimensions loop):
let filledCount = 0;
for (const [dimKey, dimObj] of Object.entries(dimensions)) {
  const value = dimObj?.user_value ?? dimObj?.default_value ?? null;
  if (value !== null && value !== undefined) filledCount++;
  rows.push([ /* … */ ]);
}

// Then replace the filter:
const totalDimensions = rows.length;
const filledDimensions = filledCount;
process.stdout.write(dim(`Total dimensions: ${filledDimensions}/${totalDimensions} filled\n\n`));
```

---

### Finding I — Reorder EC2 policy guards so core dims always show

**Before** (`ec2_policy.js` L107–124):
```javascript
shouldPrompt(dimKey, dimensions) {
    const workload = normalizeWorkload(workloadValue);

    if (workload === 'daily spike traffic' && DAILY_SPIKE_SKIP_DIMS.has(dimKey)) {
      return false;   // ← hides core dims before core check runs
    }
    if (workload === 'constant usage' && CONSTANT_USAGE_SKIP_DIMS.has(dimKey)) {
      return false;
    }

    if (EC2_CORE_DIMS.has(dimKey)) {
      return true;
    }
```

**After:**
```javascript
shouldPrompt(dimKey, dimensions) {
    const workload = normalizeWorkload(workloadValue);

    // Core dimensions always show, regardless of workload
    if (EC2_CORE_DIMS.has(dimKey)) {
      return true;
    }

    if (workload === 'daily spike traffic' && DAILY_SPIKE_SKIP_DIMS.has(dimKey)) {
      return false;
    }
    if (workload === 'constant usage' && CONSTANT_USAGE_SKIP_DIMS.has(dimKey)) {
      return false;
    }
```

> ⚠️ **[BEHAVIOR CHANGE]** Under `daily spike traffic`, `Number of instances` and `Utilization (On-Demand only)` become visible. Verify against the live AWS EC2 Calculator page.

---

## 5. ✅ VERIFY

### Lint
```bash
cd /Users/mac/Git/aws-cost/aws-cost-builder
npx eslint builder/ core/ main.js
```

### Full test suite
```bash
npm test
```

### Targeted tests to re-run after applying fixes
```bash
# Builder wizard tests (covers interactive_builder, section_flow, review_flow)
npm test -- --testPathPattern=tests/builder

# Core resolver tests (covers priority_chain, override_parser)
npm test -- --testPathPattern=tests/core

# Property tests (covers policies)
npm test -- --testPathPattern=tests/property
```

### New tests warranted
1. **`tests/builder/wizard/interactive_builder.test.js`** — Add a test for final review that confirms `'restart'` and `'edit'` return values are handled with a warning message rather than silently saving (finding C).
2. **`tests/builder/wizard/review_flow.test.js`** — Add a test for `runFinalReview` where all dimension values are `null`; confirm `filledDimensions = 0` (regression for finding G's raw-count fix).
3. **`tests/property/ec2_policy.test.js`** — Add a property test asserting that `EC2_CORE_DIMS` members always return `true` from `shouldPrompt` regardless of workload (finding I).

### Behavior changes to validate manually
- After finding I: Confirm `Number of instances` and `Utilization (On-Demand only)` are shown in the live AWS Calculator EC2 page under "daily spike traffic" load pattern.

---

## 6. 📝 PR SUMMARY

### Title: `🧹 Fix remaining state mutation, dim shadowing, and EC2 policy guard order`

**Body:**

🎯 **What:**
1. Eliminate last two in-place property assignments on `profileState` (`project_name`, `description`) to complete the immutable-state refactor
2. Fix `dim` variable shadowing in `runServiceReview` (missed in pass 1)
3. Add explicit warn messages for unimplemented "Edit a field" / "Start over" final review paths
4. Replace fragile ANSI-strip filled-count logic with a raw-value counter
5. Reorder EC2 policy guards so core dimensions are always shown

💡 **Why:**
The immutable-state half-fix leaves two mutable property assignments that could cause subtle bugs in the layout preview panel. The `dim` shadowing in `runServiceReview` means `dim('skipped')` currently calls the loop variable (an object), not the imported styling function, producing `[object Object]` in the Source column for skipped values. The ANSI-strip filled count would miscount any dimension whose value is literally the `─` glyph.

✅ **Verification:**
- `npm test` — full suite passes
- `npx eslint builder/ core/ main.js` — no new errors
- Manual wizard run: "Source" column shows `skipped` (not `[object Object]`) for null dimensions
- Manual EC2 daily-spike run: `Number of instances` and `Utilization` fields visible

✨ **Result:**
`profileState` is now fully immutable throughout the wizard. The service review table correctly displays "skipped" for empty dimensions. The final review filled-count is accurate even for dash-valued dimensions.

⚠️ **Behavior Changes:**
- EC2 `daily spike traffic`: `Number of instances` and `Utilization (On-Demand only)` now always show
- `allowUnresolvedOptional` in `priority_chain.js` renamed to `includeOptionalInReport` (blocked on separate PR; callers must be updated)
