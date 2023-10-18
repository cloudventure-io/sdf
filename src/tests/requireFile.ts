import { jest } from "@jest/globals"
import * as esbuild from "esbuild"
import { join } from "path"

export const requireFile = async <T>(path: string, tmpDir: string, bundleDir: string): Promise<T> => {
  const outfile = join(tmpDir, path).replace(/\.[^.]+$/, ".js")

  const options: esbuild.BuildOptions = {
    loader: {
      ".mu": "text",
    },
    absWorkingDir: bundleDir,
    platform: "node",
    entryPoints: [join(bundleDir, path)],
    outfile: outfile,
    format: "cjs",
    bundle: true,
  }

  await esbuild.build(options)

  return jest.requireActual(outfile)
}
