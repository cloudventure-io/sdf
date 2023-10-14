import type { BuildOptions } from "esbuild"

import type { SdfBundleManifest } from "./bundlers/SdfBundler"
import type { SdfApp, SdfAppOptions } from "./SdfApp"

export interface SdfConfig {
  buildConfig?: (buildOptions: BuildOptions) => BuildOptions
  postBuild?: (bundle: SdfBundleManifest, outdir: string) => Promise<void>
}

export type SdfSynth = (options: SdfAppOptions) => Promise<SdfApp>
