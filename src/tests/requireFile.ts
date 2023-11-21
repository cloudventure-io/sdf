// import { jest } from "@jest/globals"
import * as esbuild from "esbuild"
import { join } from "path"

export const requireFile = async <T>(path: string, bundleDir: string): Promise<T> => {
  const outfile = join(bundleDir, "tmp", path).replace(/\.[^.]+$/, ".js")

  const options: esbuild.BuildOptions = {
    loader: {
      ".mu": "text",
    },
    absWorkingDir: bundleDir,
    platform: "node",
    entryPoints: [join(bundleDir, path)],
    outfile: outfile,
    format: "esm",
    bundle: true,
    external: [
      "@cloudvanture/sdf",
      // the sdf src path relative to test's generated files
      "../../../src/*",
    ],
  }

  await esbuild.build(options)

  return await import(outfile)
  // return jest.requireActual(outfile)
}
