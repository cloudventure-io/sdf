import type { BuildOptions } from "esbuild"

import type { SdfApp, SdfAppOptions } from "./SdfApp"
import type { SdfBundleManifest } from "./bundlers/SdfBundler"

export interface SdfConfig {
  buildConfig?: (buildOptions: BuildOptions) => BuildOptions
  postBuild?: (bundle: SdfBundleManifest, outdir: string) => Promise<void>
}

export type SdfSynth = (options: SdfAppOptions) => Promise<SdfApp>
