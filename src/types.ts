import { BuildOptions } from "esbuild"

import { SdfBundleMetadata } from "./SdfBundler"

export interface SdfConfig {
  buildConfig?: (buildOptions: BuildOptions) => BuildOptions
  postBuild?: (bundle: SdfBundleMetadata, outdir: string) => Promise<void>
}
