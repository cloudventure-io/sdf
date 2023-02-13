import { BuildOptions } from "esbuild"

import { SdfBundlerMetadata } from "./SdfBundler"

export interface SdfConfig {
  buildConfig?: (buildOptions: BuildOptions) => BuildOptions
  postBuild?: (bundle: SdfBundlerMetadata, outdir: string) => Promise<void>
}
