import { createEsbuildSdfPluginFilePathAPI } from "./EsbuildSdfPluginFilePath"
import { createEsbuildSdfPluginOpenAPI } from "./EsbuildSdfPluginOpenapi"

export const esbuildPlugins = () => [createEsbuildSdfPluginOpenAPI(), createEsbuildSdfPluginFilePathAPI()]
