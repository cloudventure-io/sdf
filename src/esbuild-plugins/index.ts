import { createEsbuildPluginFilePathAPI } from "./EsbuildPluginFilePath"
import { createEsbuildPluginOpenAPI } from "./EsbuildPluginOpenapi"

export const esbuildPlugins = () => [createEsbuildPluginOpenAPI(), createEsbuildPluginFilePathAPI()]
