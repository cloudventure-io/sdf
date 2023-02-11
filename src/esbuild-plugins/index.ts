import { createEsbuildSdfPluginFilePathAPI } from "./EsbuildSdfPluginFilePath";
import {
  createEsbuildSdfPluginOpenAPI,
  EsbuildSdfPluginOpenAPIOptions,
} from "./EsbuildSdfPluginOpenapi";

export const esbuildPlugins = (options: EsbuildSdfPluginOpenAPIOptions) => [
  createEsbuildSdfPluginOpenAPI(options),
  createEsbuildSdfPluginFilePathAPI(),
];
