/**
 * Artifact writer — write run_result.json and manage output directories.
 *
 * Responsibilities:
 *   - Ensure `outputs/` and `outputs/screenshots/` directories exist.
 *   - Generate deterministic run IDs in format "run_YYYYMMDD_HHMMSS".
 *   - Serialize a RunResult to `outputs/run_result.json` (UTF-8, 2-space indent).
 *   - Emit EVT-ART-01 on success, EVT-ART-02 on failure.
 *   - Throw ArtifactWriteError with absolute path on any write/directory failure.
 *
 * Log events:
 *   EVT-ART-01  INFO      core/emitter/artifact_writer  artifact_written   path
 *   EVT-ART-02  CRITICAL  core/emitter/artifact_writer  artifact_write_failed  path
 *
 * @module core/emitter/artifact_writer
 */

import fs from 'fs';
import fsPromises from 'fs/promises';
import path from 'path';
import { buildScreenshotPath } from './screenshot_manager.js';

// ─── Re-export buildScreenshotPath so callers need only one import ────────────
export { buildScreenshotPath };

// ─── Error class ──────────────────────────────────────────────────────────────

/**
 * Thrown when writing the run artifact or creating output directories fails.
 */
export class ArtifactWriteError extends Error {
  /**
   * @param {string} message   - Human-readable description.
   * @param {string} filePath  - Absolute path that triggered the failure.
   * @param {Error}  [cause]   - Underlying OS/filesystem error.
   */
  constructor(message, filePath, cause) {
    super(message);
    this.name = 'ArtifactWriteError';
    this.path = filePath;
    this.cause = cause ?? null;
  }
}

// ─── Structured logger ────────────────────────────────────────────────────────

/**
 * Write one structured log line to stderr.
 *
 * Format: YYYY-MM-DD HH:MM:SS | LEVEL    | module                        | key=value ...
 *
 * @param {'INFO'|'CRITICAL'} level
 * @param {string} eventType
 * @param {Record<string, string>} fields
 */
function log(level, eventType, fields) {
  const now = new Date();
  const ts = now.toISOString().replace('T', ' ').substring(0, 19);
  const levelPadded = level.padEnd(8);
  const module = 'core/emitter/artifact_writer';
  const fieldStr = Object.entries({ event_type: eventType, ...fields })
    .map(([k, v]) => `${k}=${v}`)
    .join(' ');
  process.stderr.write(`${ts} | ${levelPadded} | ${module.padEnd(30)} | ${fieldStr}\n`);
}

// ─── Directory management ─────────────────────────────────────────────────────

/**
 * Ensure the standard output directories exist, creating them recursively
 * if they do not. Idempotent — safe to call multiple times.
 *
 * @param {string} baseDir - Root directory (typically the project root or
 *                           the `aws-cost-builder/` folder).
 * @returns {{ outputDir: string, screenshotsDir: string }}
 *   Absolute paths to the output and screenshots directories.
 * @throws {ArtifactWriteError} If directory creation fails.
 */
export function ensureOutputDirs(baseDir) {
  const outputDir      = path.resolve(baseDir, 'outputs');
  const screenshotsDir = path.resolve(outputDir, 'screenshots');

  for (const dir of [outputDir, screenshotsDir]) {
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch (err) {
      throw new ArtifactWriteError(
        `Failed to create output directory: ${dir} — ${err.message}`,
        dir,
        err
      );
    }
  }

  return { outputDir, screenshotsDir };
}

// ─── Run ID ───────────────────────────────────────────────────────────────────

/**
 * Build a run ID string in the format "run_YYYYMMDD_HHMMSS".
 *
 * @param {Date} [now=new Date()] - The timestamp to encode.
 * @returns {string} e.g. "run_20240315_143022"
 */
export function buildRunId(now = new Date()) {
  const pad = (n, len = 2) => String(n).padStart(len, '0');

  const year   = now.getUTCFullYear();
  const month  = pad(now.getUTCMonth() + 1);
  const day    = pad(now.getUTCDate());
  const hours  = pad(now.getUTCHours());
  const mins   = pad(now.getUTCMinutes());
  const secs   = pad(now.getUTCSeconds());

  return `run_${year}${month}${day}_${hours}${mins}${secs}`;
}

// ─── Artifact writer ──────────────────────────────────────────────────────────

/**
 * Serialize a RunResult to disk as UTF-8 JSON with 2-space indentation.
 *
 * Emits EVT-ART-01 on success or EVT-ART-02 + throws ArtifactWriteError on failure.
 *
 * @param {import('../models/run_result.js').RunResult} result
 * @param {string} outputFile - Absolute path of the target JSON file.
 * @returns {Promise<void>}
 * @throws {ArtifactWriteError}
 */
export async function writeRunResult(result, outputFile) {
  const absPath = path.resolve(outputFile);

  let json;
  try {
    // Serialize via .toObject() if available, otherwise use the value directly.
    const plain = typeof result.toObject === 'function' ? result.toObject() : result;
    json = JSON.stringify(plain, null, 2);
  } catch (err) {
    const msg = `Failed to serialize run result: ${err.message}`;
    log('CRITICAL', 'artifact_write_failed', { path: absPath });
    throw new ArtifactWriteError(msg, absPath, err);
  }

  try {
    // Ensure the parent directory exists before writing.
    await fsPromises.mkdir(path.dirname(absPath), { recursive: true });
    await fsPromises.writeFile(absPath, json, { encoding: 'utf-8' });
  } catch (err) {
    const msg = `Failed to write run result to ${absPath}: ${err.message}`;
    log('CRITICAL', 'artifact_write_failed', { path: absPath });
    throw new ArtifactWriteError(msg, absPath, err);
  }

  // EVT-ART-01
  log('INFO', 'artifact_written', { path: absPath });
}
