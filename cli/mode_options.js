import {
  COL_CYAN,
  COL_GREEN,
  COL_ORANGE,
  COL_YELLOW,
} from '../builder/layout/colors.js';
import { getCliRuntimeConfig } from '../config/runtime/index.js';

const cliConfig = getCliRuntimeConfig();
const colorMap = {
  COL_CYAN,
  COL_GREEN,
  COL_ORANGE,
  COL_YELLOW,
};

export const MODE_OPTIONS = cliConfig.modes.map((mode) => ({
  ...mode,
  color: colorMap[mode.colorKey],
}));
