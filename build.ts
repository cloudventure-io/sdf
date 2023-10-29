import * as esbuild from "esbuild"
import { copyFile, mkdir, rm, writeFile } from "fs/promises"
import * as glob from "glob"

import packageJson from "./package.json"

const run = async () => {
  await rm("dist", { recursive: true, force: true })
  await mkdir("dist")

  const builds: Array<{
    entryPoints: Array<string>
    options: Array<Partial<esbuild.BuildOptions>>
  }> = [
    {
      entryPoints: glob.sync("src/**/*.ts").filter(name => !name.endsWith("d.ts") && !name.startsWith("src/cli")),
      options: [
        {
          outdir: "dist/cjs",
          format: "cjs",
        },
        {
          format: "esm",
          outdir: "dist/esm",
        },
      ],
    },
    {
      entryPoints: glob.sync("./src/**/*.mu"),
      options: [
        {
          outdir: "dist/cjs",
          format: "cjs",
          outExtension: {
            ".js": ".mu.js",
          },
        },
        {
          outdir: "dist/esm",
          format: "esm",
          outExtension: {
            ".js": ".mu.js",
          },
        },
      ],
    },
  ]

  const esbuildOptions: esbuild.BuildOptions = {
    outdir: "dist",
    platform: "node",
    target: "node18",
    bundle: false,
    sourcemap: "inline",
    minify: true,
    keepNames: true,
    legalComments: "external",
    outbase: "src",
    loader: {
      ".mu": "text",
    },
  }

  await Promise.all([
    ...builds
      .map(build =>
        build.options.map(
          (options): esbuild.BuildOptions => ({
            ...esbuildOptions,
            ...options,
            entryPoints: build.entryPoints,
          }),
        ),
      )
      .flat(1)
      .map(options => esbuild.build(options)),

    await writeFile(
      "dist/package.json",
      JSON.stringify(
        {
          ...packageJson,
          devDependencies: undefined,
          scripts: undefined,
          bin: {
            sdf: "cjs/cli/index.js",
          },
          main: "cjs/index.js",
          module: "esm/index.js",
          types: "types/index.d.ts",
        },
        null,
        2,
      ),
    ),

    await copyFile("publish/types.d.ts", "dist/types.d.ts"),
    await copyFile("README.md", "dist/README.md"),

    await esbuild.build({
      ...esbuildOptions,
      outdir: "dist/cjs",
      banner: {
        js: `#!/usr/bin/env node`,
      },
      entryPoints: ["src/cli/index.ts"],
      sourcemap: "inline",
      format: "cjs",
    }),
  ])
}

run().catch(err => {
  console.error(err)
  process.exit(1)
})
