// re-exports — public API for core/emitter sub-module
export {
  ArtifactWriteError,
  ensureOutputDirs,
  buildRunId,
  buildScreenshotPath,   // convenience re-export from artifact_writer (which re-exports from screenshot_manager)
  writeRunResult,
} from './artifact_writer.js';

export {
  slugify,
  buildScreenshotFilename,
} from './screenshot_manager.js';
