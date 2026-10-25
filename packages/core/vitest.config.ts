import type { ViteUserConfig } from "vitest/config";
import { defineConfig, mergeConfig } from "vitest/config";

import rootConfig from "../../vitest.config.ts";

const config: ViteUserConfig = mergeConfig(rootConfig, defineConfig({}));

export default config;
