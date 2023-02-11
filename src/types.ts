import { BuildOptions } from "esbuild";
import { SdfServiceMetadata } from "./SdfService";

export interface SdfConfig {
  buildConfig?: (buildOptions: BuildOptions) => BuildOptions;
  postBuild?: (service: SdfServiceMetadata, outdir: string) => Promise<void>;
}
