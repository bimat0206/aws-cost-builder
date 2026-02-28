/**
 * Compound value+unit input prompt.
 *
 * ## Accepted formats
 *
 *   "500"               → { value: "500", unit: <defaultUnit> }
 *   "500 GB"            → { value: "500", unit: "GB" }
 *   "500 GB per month"  → { value: "500", unit: "GB" }
 *
 * Parsing is case-insensitive for the unit token (normalised to the casing
 * in `acceptedUnits`).  The trailing "per month" / "per year" / "/ month"
 * suffix is stripped and ignored — only the unit token matters.
 *
 * ## Error handling
 *
 * `parseCompoundInput` is a pure synchronous function that throws
 * `CompoundInputError` on invalid input.  `compoundInputPrompt` catches the
 * error, prints a helpful message listing accepted units, and re-prompts.
 *
 * ## Two-dimension output
 *
 * After the prompt resolves, callers use `splitCompoundResult` to produce
 * exactly two `Dimension` objects — one for the value key and one for the
 * unit_sibling key — satisfying Property 13.
 *
 * @module builder/prompts/compound_input
 */

import * as readline from 'node:readline';
import {
  COL_ORANGE, COL_YELLOW, COL_CYAN, COL_DIM, COL_GREEN,
  COL_SECTION, COL_MUTED, COL_BASE,
} from '../layout/colors.js';
import { fg, bold, dim, italic } from '../layout/components.js';

// ─── Error type ───────────────────────────────────────────────────────────────

/**
 * Thrown by `parseCompoundInput` when input cannot be parsed.
 */
export class CompoundInputError extends Error {
  /**
   * @param {string} message
   * @param {'MISSING_VALUE'|'INVALID_NUMBER'|'UNKNOWN_UNIT'} code
   */
  constructor(message, code) {
    super(message);
    this.name = 'CompoundInputError';
    this.code = code;
  }
}

// ─── Pure parser ──────────────────────────────────────────────────────────────

/**
 * Parse a compound input string into `{ value, unit }`.
 *
 * Rules (in order):
 *  1. Trim whitespace.
 *  2. Strip trailing "per month", "per year", "/month", "/year" (case-insensitive).
 *  3. Split on whitespace — first token is the numeric value, second (if present)
 *     is the unit token.
 *  4. If value token is empty → throw CompoundInputError('MISSING_VALUE').
 *  5. If value token is not a valid finite number → throw CompoundInputError('INVALID_NUMBER').
 *  6. If unit token is present:
 *       - Find a case-insensitive match in `acceptedUnits`.
 *       - If not found → throw CompoundInputError('UNKNOWN_UNIT').
 *       - Use the casing from `acceptedUnits`.
 *  7. If unit token is absent:
 *       - Use `defaultUnit` if set; otherwise throw CompoundInputError('UNKNOWN_UNIT').
 *
 * @param {string}      input
 * @param {string[]}    acceptedUnits   - Allowed unit strings (e.g. ["GB", "TB"]).
 * @param {string|null} defaultUnit     - Unit to apply when none is specified.
 * @returns {{ value: string, unit: string }}
 * @throws {CompoundInputError}
 */
export function parseCompoundInput(input, acceptedUnits, defaultUnit) {
  if (typeof input !== 'string') {
    throw new CompoundInputError('Input must be a string', 'MISSING_VALUE');
  }

  // Strip trailing time-period qualifiers
  let cleaned = input.trim()
    .replace(/\s+per\s+(month|year|day|hour)\s*$/i, '')
    .replace(/\s*\/\s*(month|year|day|hour)\s*$/i, '')
    .trim();

  if (cleaned === '') {
    throw new CompoundInputError('Input is empty', 'MISSING_VALUE');
  }

  const tokens = cleaned.split(/\s+/);
  const valueToken = tokens[0];
  const unitToken  = tokens[1] ?? null;

  // Validate numeric value
  const num = Number(valueToken);
  if (!isFinite(num) || valueToken === '') {
    throw new CompoundInputError(
      `"${valueToken}" is not a valid number`,
      'INVALID_NUMBER',
    );
  }

  // Resolve unit
  let resolvedUnit;
  if (unitToken) {
    const match = acceptedUnits.find(u => u.toLowerCase() === unitToken.toLowerCase());
    if (!match) {
      throw new CompoundInputError(
        `Unknown unit "${unitToken}". Accepted: ${acceptedUnits.join(', ')}`,
        'UNKNOWN_UNIT',
      );
    }
    resolvedUnit = match;
  } else {
    if (!defaultUnit) {
      throw new CompoundInputError(
        `No unit provided and no default unit is set. Accepted: ${acceptedUnits.join(', ')}`,
        'UNKNOWN_UNIT',
      );
    }
    resolvedUnit = defaultUnit;
  }

  return { value: valueToken, unit: resolvedUnit };
}

// ─── Two-dimension splitter ───────────────────────────────────────────────────

/**
 * Convert a compound prompt result into two separate Dimension-like objects
 * suitable for insertion into the profile under their catalog keys.
 *
 * This satisfies Property 13: exactly two dimension objects for any
 * dimension that has a `unit_sibling`.
 *
 * @param {string} valueKey      - Catalog key for the numeric value dimension.
 * @param {string} unitKey       - Catalog key for the unit sibling dimension.
 * @param {{ value: string, unit: string }} result - Output of `parseCompoundInput`.
 * @returns {[{ key: string, user_value: string }, { key: string, user_value: string }]}
 */
export function splitCompoundResult(valueKey, unitKey, result) {
  return [
    { key: valueKey, user_value: result.value },
    { key: unitKey,  user_value: result.unit  },
  ];
}

// ─── Render helpers ───────────────────────────────────────────────────────────

/**
 * Render the compound-input info box.
 *
 * Shows the accepted units and example inputs in an orange-bordered panel.
 *
 * @param {string}      label
 * @param {string[]}    acceptedUnits
 * @param {string|null} defaultUnit
 * @returns {string}
 */
export function renderCompoundInfo(label, acceptedUnits, defaultUnit) {
  const border = (s) => fg(s, COL_SECTION);
  const width  = 56;
  const inner  = width - 2;

  const titleText = ` \u25C6 Compound input \u2014 ${label} `;
  const dashRight = Math.max(0, inner - 2 - titleText.length);
  const top = border('\u256D') + border('\u2500\u2500') + bold(fg(titleText, COL_ORANGE))
            + border('\u2500'.repeat(dashRight)) + border('\u256E');
  const bot = border('\u2570') + border('\u2500'.repeat(inner)) + border('\u256F');

  const line = (text) => border('\u2502') + ' ' + text;

  const unitList = fg(acceptedUnits.join(' \u00B7 '), COL_YELLOW);
  const defLine  = defaultUnit
    ? line(`Default unit: ${fg(defaultUnit, COL_CYAN)}`)
    : null;

  const examples = [
    fg('500', COL_YELLOW) + dim(' (uses default unit)'),
    fg(`500 ${acceptedUnits[0] ?? 'GB'}`, COL_YELLOW),
    fg(`2 ${acceptedUnits[1] ?? acceptedUnits[0] ?? 'TB'}`, COL_YELLOW),
  ];

  const rows = [
    line(`Accepted units: ${unitList}`),
    ...(defLine ? [defLine] : []),
    line(dim('Examples: ') + examples.join(dim(' \u00B7 '))),
  ];

  return [top, ...rows, bot].join('\n');
}

// ─── Core prompt ──────────────────────────────────────────────────────────────

/**
 * Prompt for a compound value+unit field.
 *
 * Prints the compound info box, reads a line, validates via `parseCompoundInput`,
 * and re-prompts on any `CompoundInputError` with a descriptive hint.
 *
 * @param {object}       opts
 * @param {string}       opts.label
 * @param {string[]}     opts.acceptedUnits
 * @param {string|null}  opts.defaultUnit
 * @param {object|null}  [opts.rl]          Existing readline.Interface to reuse.
 * @returns {Promise<{ value: string, unit: string }>}
 */
export async function compoundInputPrompt(opts) {
  const {
    label,
    acceptedUnits,
    defaultUnit    = null,
    rl: externalRl = null,
  } = opts;

  process.stdout.write('\n' + renderCompoundInfo(label, acceptedUnits, defaultUnit) + '\n');

  const ownRl = !externalRl;
  const rl = externalRl ?? readline.createInterface({
    input:  process.stdin,
    output: process.stdout,
  });

  const ask = () => new Promise(resolve => {
    rl.question(fg('› ', COL_CYAN), resolve);
  });

  try {
    while (true) {                                   // eslint-disable-line no-constant-condition
      const raw = (await ask()).trim();

      try {
        return parseCompoundInput(raw, acceptedUnits, defaultUnit);
      } catch (err) {
        if (err instanceof CompoundInputError) {
          // Handle MISSING_VALUE with friendly hint
          if (err.code === 'MISSING_VALUE') {
            process.stdout.write(
              fg('  \u2717 Please enter a value (e.g. "500 GB").\n', COL_ORANGE),
            );
          } else {
            process.stdout.write(fg(`  \u2717 ${err.message}\n`, COL_ORANGE));
          }
          const unitHint = `  Accepted units: ${fg(acceptedUnits.join(', '), COL_YELLOW)}\n`;
          process.stdout.write(dim(unitHint));
        } else {
          throw err;
        }
      }
    }
  } finally {
    if (ownRl) rl.close();
  }
}
