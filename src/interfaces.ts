import type { BuildOptions } from "esbuild"

import type { App, AppOptions } from "./App"
import type { BundleManifest } from "./bundler/Bundler"

export interface SdfConfig {
  synth: (options: AppOptions) => Promise<App>
  buildConfig?: (buildOptions: BuildOptions) => BuildOptions
  postBuild?: (bundle: BundleManifest, outdir: string) => Promise<void>
}

export type SdfSynth = (options: AppOptions) => Promise<App>
