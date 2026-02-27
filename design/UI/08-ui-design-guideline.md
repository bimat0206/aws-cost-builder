# AWS Cost Builder TUI — Design Guideline
_For coding agents and human implementers_

> **Reference mock:** `design/mock/index.html` (open in any browser — zero build step required)  
> **Target runtime:** Python + Rich + questionary, terminal ≥ 120 columns  
> **Spec:** `design/07-builder-wizard-spec.md`

---

## 1. Layout

### 1.1 Split-Screen Rule
The terminal is always divided into two panels rendered **side by side**:

```
┌── YAML Preview ───────────────┐  ┌── Prompt ─────────────────────────────┐
│  (fixed 62-char wide, left)   │  │  (fills remaining width, right)        │
│  scrollable, read-only        │  │  all user interaction happens here      │
└───────────────────────────────┘  └───────────────────────────────────────┘
```

- **Left panel width:** exactly 62 characters (including the 1-char border each side = 64 on screen).  
  Implement as `Layout("preview", size=64)`.
- **Right panel:** `Layout("prompt")` with no explicit size — fills the rest.
- **Fallback:** if terminal width < 120 columns, suppress YAML panel and use full-width single-column prompt.  
  Constant: `MIN_SPLIT_WIDTH = 120` in `layout_engine.py`.

### 1.2 Panel Order in Code
```python
layout.split_row(
    Layout("preview", size=64),   # LEFT  first
    Layout("prompt"),              # RIGHT second
)
```
Reversing this order breaks the layout. The YAML preview is always on the left.

### 1.3 Panel Heights
- YAML panel viewport: **75% of terminal height** (leaves room for footer metadata line).
- Prompt panel: auto — fills available height with `overflow: scroll`.

---

## 2. Colour System

All colours are defined once in `layout_engine.py` as module-level constants.
Never hardcode hex values at call sites.

| Constant         | Hex / Rich name  | Semantic                                        |
|------------------|------------------|-------------------------------------------------|
| `COL_BG`         | `#1e2127`        | Terminal background                             |
| `COL_BG_PANEL`   | `#21252b`        | Panel background                                |
| `COL_BG_ACTIVE`  | `#2c313c`        | Active YAML line / selected item / input box    |
| `COL_BORDER`     | `#3e4451`        | Dim border grey (table lines, dividers)         |
| `COL_YAML`       | `#56b6c2` (cyan) | YAML panel border + active glyph + active line  |
| `COL_PROMPT`     | `#c678dd` (mag)  | Prompt panel border                             |
| `COL_SECTION`    | `#e5c07b` (orange/yellow) | Section header border + diamond glyph  |
| `COL_DIM`        | `#5c6370`        | Dim text (line numbers, instructions, metadata) |
| `COL_MUTED`      | `#abb2bf`        | Muted base text (labels, descriptions)          |
| `COL_BASE`       | `#dcdfe4`        | Primary text                                    |
| `COL_CYAN`       | `#56b6c2`        | NUMBER badge, input border, breadcrumb accent   |
| `COL_GREEN`      | `#98c379`        | Selected radio ●, completed ✓, YAML strings     |
| `COL_ORANGE`     | `#e06c75`        | Question title (field label), required badge    |
| `COL_YELLOW`     | `#e5c07b`        | Unit display, SELECT badge, YAML numbers, ◆     |
| `COL_MAGENTA`    | `#c678dd`        | COMBOBOX badge, YAML booleans                   |
| `COL_BLUE`       | `#61afef`        | YAML keys, line numbers                         |

### Field-Type Badge Colours
```python
FIELD_TYPE_COLORS = {
    "NUMBER":    COL_CYAN,
    "TEXT":      COL_CYAN,
    "SELECT":    COL_YELLOW,
    "RADIO":     COL_YELLOW,
    "COMBOBOX":  COL_MAGENTA,
    "TOGGLE":    COL_GREEN,
    "INSTANCE_SEARCH": COL_BLUE,
    "UNKNOWN":   COL_DIM,
}
```

---

## 3. Typography & Glyphs

### 3.1 Font
Terminal monospace only. No icon fonts. All glyphs are Unicode characters available in standard nerd-font terminals.

### 3.2 Required Glyphs
| Glyph | Unicode | Usage                                      |
|-------|---------|--------------------------------------------|
| `◆`   | U+25C6  | Filled diamond — section headers (all)     |
| `◇`   | U+25C7  | Hollow diamond — unselected toggle bullets |
| `●`   | U+25CF  | Filled circle — selected radio option      |
| `○`   | U+25CB  | Empty circle — unselected radio option     |
| `▶`   | U+25B6  | Right-pointing triangle — active YAML line |
| `✓`   | U+2713  | Checkmark — completion messages            |
| `✗`   | U+2717  | Cross — error messages                     |
| `!`   | ASCII   | Warning prefix                             |
| `?`   | ASCII   | Help prefix                                |

### 3.3 Line-drawing
Use Rich's built-in `Panel` and `Table` borders for all box-drawing.
Do **not** manually construct `┌─┐│└┘` strings — they break on narrow terminals.

---

## 4. YAML Preview Panel

### 4.1 Content Rules
- Serialize via `pyyaml` with `sort_keys=False`, `indent=2`, `width=55`.
- Unanswered fields display `"?"` as a string sentinel — never empty, never `null`.
- Keys that exceed 50 chars are truncated to 47 + `…` in the preview **only**.
  The profile output is unaffected.

### 4.2 Syntax Colouring
Apply per-line after YAML serialization by scanning each line:

```
key lines     (end with ":")              → COL_BLUE
string values (start with '"' or "'")     → COL_GREEN
boolean values ("true" / "false")         → COL_MAGENTA
numeric values (parseable as float)       → COL_YELLOW
placeholder "?"                           → COL_DIM
```

### 4.3 Active Line
When a dimension prompt is active:
- The YAML line matching `<active_key>:` is highlighted:
  - Background: `COL_BG_ACTIVE`
  - Key text: bold `COL_CYAN`
  - Left gutter shows `▶` glyph in `COL_CYAN`
- All other lines show a space in the gutter.
- Auto-scroll: keep active line in the middle third of the viewport.

### 4.4 Line Numbers
- Left-aligned, width 3, colour `COL_DIM`, size 11pt (one step smaller than body).
- Format: `" 1"` → `"21"` (right-justify in fixed width).

### 4.5 Footer Line
Single line below the YAML content, colour `COL_DIM`, size 10pt:
```
Line {active_line}/{total_lines} · {service_id} · {region}
```

---

## 5. Prompt Panel Components

### 5.1 Section Header (DiamondHeader)
Every new section starts with a bordered box:

```
╭─ ◆ SectionName  ·  subtitle ─────╮
│                                    │
╰────────────────────────────────────╯
```

Implementation:
```python
Panel(
    Text.assemble(
        ("◆ ", COL_YELLOW + " bold"),
        (section_name, COL_YELLOW + " bold"),
        (" · ", COL_DIM),
        (subtitle, COL_DIM),
    ),
    border_style=COL_SECTION,  # #e5c07b
    padding=(0, 1),
)
```

**Rules:**
- Every section transition renders a `DiamondHeader`, no exceptions.
- `subtitle` format: `"Section N of M · K fields"`.
- Do not render section descriptions as separate lines — they belong in a dim subtitle paragraph below the header, not inside the header Panel itself.

### 5.2 Breadcrumb
```python
Text.assemble(
    ("Group: ", COL_DIM + " bold"),
    (group_name, COL_MUTED),
    (" › ", COL_DIM),
    ("Service: ", COL_DIM + " bold"),
    (service_name, COL_MUTED),
)
```
- Always rendered as the first line of the prompt panel content.
- Font size: 11pt (use Rich `Text` with `size=11` on the span or wrap in a dim rule).

### 5.3 Progress Bar
Two-line block above the section header:
```
Section 1 of 5                          [4/19]
████████░░░░░░░░░░░░░░░░░░  (21%)
```
- Section fraction: `COL_DIM`
- Field counter `[N/M]`: `COL_CYAN`
- Bar fill: `COL_CYAN`; bar track: `COL_BORDER`
- Height: 1 line using Rich's `Progress` or a manually drawn rule.
- **Denominator excludes skipped fields** (policy-filtered). Never count fields the user won't see.

### 5.4 Field Block (Number / Text)
```
[label]  [TYPE badge]  [required/optional badge]
Unit: [unit]
Default: [default]
Note: [note]
╭──────────────────────────────╮
│ › [current input]█           │   ← live questionary input
╰──────────────────────────────╯
Type a number · Enter to confirm · ? for help
```

Styling:
- Label: `COL_ORANGE bold`
- Type badge: background `type_color + "22"`, border `type_color + "55"`, text `type_color`
- Required badge: `COL_ORANGE`; optional badge: `COL_DIM`
- "Unit:" label: `COL_DIM`; unit value: `COL_YELLOW`
- "Default:" label: `COL_DIM`; value: `COL_MUTED`
- "Note:": `COL_DIM italic`
- Input box border: `COL_CYAN`
- Instruction line: `COL_DIM` size 10pt

### 5.5 Select / Radio Prompt
```
[label bold orange]

┌─────────────────────────────────┐
│ ● Linux                         │  ← selected: green border-left, COL_BG_ACTIVE bg
│   Standard EC2 pricing ...      │  ← description: COL_DIM
│ ○ Windows Server                │  ← unselected: COL_DIM border-left, transparent bg
│ ○ RHEL                          │
└─────────────────────────────────┘
↑↓ to move · Enter to select
```

Rules:
- Selected item: `COL_GREEN bold ●`, background `COL_BG_ACTIVE`, left border `COL_GREEN`.
- Unselected: `COL_DIM ○`, transparent background, dim left border.
- Description line: indented 20px from option text, `COL_DIM`, size 11pt.
- Instruction line: `COL_DIM` size 10pt.

### 5.6 Toggle Phase 1 (S3-style)
Header uses `DiamondHeader`. Sections listed with `◆` (enabled) / `◇` (disabled) glyphs.
```
◆ S3 Standard          ← enabled: COL_GREEN, COL_BG_ACTIVE bg
  General purpose...
◇ S3 Glacier           ← disabled: COL_DIM, transparent bg
  Archive storage...
```
- Clicking/spacing toggles between states.
- Instruction: `COL_DIM` size 10pt below list.

### 5.7 Review Table
After a section completes:
```
◆ Section Review  ·  Compute · 5 fields answered

 Field                Value                Unit
 ─────────────────────────────────────────────
 Tenancy              Shared Instances      —
 Operating system     Linux                 —
 Number of instances  3                     instances
```
- Header: `DiamondHeader`
- Table: Rich `Table` with no outer border, alternating row backgrounds (`COL_BG_PANEL` / `#252a33`).
- Field column: `COL_MUTED`
- Value column: `COL_GREEN`
- Unit column: `COL_YELLOW`
- Then a `SelectPrompt` for Continue / Redo / Edit a field.

### 5.8 Inline Help Panel (? key)
Rendered `print_above()` (in scrollback), not inside the Live panel:
```
╭─ ? Help: [field display name] ──────────────────────╮
│  Key:      [catalog key]                             │
│  Type:     NUMBER  |  Unit:  instances               │
│  Default:  1                                         │
│  Note:     Full text from catalog notes field.       │
╰──────────────────────────────────────────────────────╯
```
- Title colour: `COL_YELLOW bold`
- Label text: `COL_MUTED`
- Value text: `COL_BASE`
- Border: `COL_SECTION` (`#e5c07b`)

---

## 6. Event Messages (print_above)

All transient messages use `engine.print_above()` so they appear in scrollback, not inside the live panels. Format:

| Event                    | Format                                                     | Colour prefix |
|--------------------------|-------------------------------------------------------------|---------------|
| Section completed        | `[✓] Section '{name}' completed — {n} fields set`           | `COL_GREEN`   |
| Field edited             | `[✓] '{label}' updated → {new_value}`                      | `COL_GREEN`   |
| Section redone           | `[!] Redoing section '{name}'`                             | `COL_YELLOW`  |
| Service saved            | `[✓] {service_name} ({region}) saved — {n} dimensions`     | `COL_GREEN`   |
| Service restarted        | `[!] {service_name} restarted — all values cleared`        | `COL_YELLOW`  |
| Compound unit error      | `[✗] Unit '{x}' not recognized. Accepted: {list}`          | `COL_ORANGE`  |
| Help expanded            | `[?] Help: {display_name}` (+ help panel)                  | `COL_YELLOW`  |
| Profile written          | `[✓] Profile written: {path}`                              | `COL_GREEN`   |
| Builder cancelled        | `[!] Builder cancelled.`                                    | `COL_YELLOW`  |

---

## 7. Live Context Rules

### 7.1 One Live Context for the Whole Session
```python
with LayoutEngine() as engine:
    run_builder_session(engine)
```
Never create nested `Live` contexts. One per `run_builder` call.

### 7.2 Questionary Must Pause/Resume
Every questionary call must go through `engine.prompt_with_pause()`:
```python
# CORRECT
value = engine.prompt_with_pause(
    lambda: questionary.text("›").ask()
)

# WRONG — causes rendering artifacts
value = questionary.text("›").ask()
```

### 7.3 Non-TTY Fallback
If `not sys.stdout.isatty()` or if `rich.live.Live.__enter__` raises, fall back to:
- Suppress YAML preview panel.
- Print prompts directly to `console.print()` without Live.
- All functional behavior is identical.

---

## 8. Compound Value-Unit Inputs

When a catalog dimension has `unit_sibling` or the naming convention matches `*Amount` → `*Unit`:
- Collapse both into **one** combined prompt.
- Prompt format: `Enter a number followed by a unit: e.g.  500 GB  or  2 TB`
- Accepted formats: `"500"`, `"500 GB"`, `"500 GB per month"`.
- If unit omitted → apply sibling's `default_value`.
- If unit unrecognized → `print_above` error and reprompt.
- Result: **two** `Dimension` objects stored under their original catalog keys.

---

## 9. Do Nots

These are explicit anti-patterns that break the design:

1. **Do not** render section headers inside the YAML panel — it's read-only.
2. **Do not** use raw catalog `key` as the primary prompt label. Use `display_name` if available, else key (graceful degradation).
3. **Do not** show the YAML panel on the right and the prompt on the left. The order is always YAML left, prompt right.
4. **Do not** hardcode hex colour strings at call sites. Use the `COL_*` constants.
5. **Do not** call `questionary.*().ask()` directly inside the Live context without `prompt_with_pause`.
6. **Do not** use positional or class-based CSS selectors in automation output — that's for the browser mock only.
7. **Do not** emit bold or bright ANSI codes directly with `\033[1m` — always use Rich `Text` styles so they respect theme and TTY detection.
8. **Do not** collapse VALUE+UNIT pairs into a single stored key. They remain as two separate `Dimension` objects in the profile output.
9. **Do not** render the `◆` diamond glyph in any context other than section headers. Use plain text titles for subtitles, breadcrumbs, and badges.
10. **Do not** count policy-skipped fields in the `[N/M]` progress counter denominator.

---

## 10. Component Checklist

Before shipping any builder screen, verify:

- [ ] Breadcrumb appears at top of prompt panel
- [ ] Progress bar shows correct `[N/M]` with skipped fields excluded
- [ ] Section header uses `DiamondHeader` with `◆` glyph and orange border
- [ ] Field label is `display_name` (or key fallback), coloured `COL_ORANGE bold`
- [ ] Type badge uses `FIELD_TYPE_COLORS` lookup
- [ ] Required/optional badge present on every field
- [ ] Unit displayed in `COL_YELLOW` when present
- [ ] Active YAML line highlighted with `▶` glyph and bold cyan
- [ ] YAML panel is on the left; prompt panel is on the right
- [ ] questionary called via `prompt_with_pause`
- [ ] Completion message printed via `print_above` in `COL_GREEN`
- [ ] Terminal < 120 cols triggers single-column fallback (no YAML panel)

---

## 11. File Ownership

| File                              | Owns                                              |
|-----------------------------------|---------------------------------------------------|
| `builder/layout_engine.py`        | `LayoutEngine`, all `COL_*` constants, split/single-column mode, `prompt_with_pause`, `print_above` |
| `builder/yaml_preview.py`         | YAML serialization, syntax colouring, active-line highlight, scroll position |
| `builder/compound_input.py`       | Compound VALUE+UNIT detection, combined prompt, two-object output |
| `builder/interactive_builder.py`  | Wizard flow: section iteration, field dispatch, review loops, toggle phase handling |
| `builder/service_prompt_policies.py` | `should_prompt` filtering — not modified by this spec |
| `design/mock/index.html`          | Static visual reference — **not imported by Python** |

---

_Last updated: 2026-02-25 — matches spec version 07-builder-wizard-spec.md v1.0_
