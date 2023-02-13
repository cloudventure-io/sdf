import { createEsbuildSdfPluginFilePathAPI } from "./EsbuildSdfPluginFilePath"
import { EsbuildSdfPluginOpenAPIOptions, createEsbuildSdfPluginOpenAPI } from "./EsbuildSdfPluginOpenapi"

export const esbuildPlugins = (options: EsbuildSdfPluginOpenAPIOptions) => [
  createEsbuildSdfPluginOpenAPI(options),
  createEsbuildSdfPluginFilePathAPI(),
]
