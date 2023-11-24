import * as esbuild from "esbuild"
import { copyFile, mkdir, rm, writeFile } from "fs/promises"
import * as glob from "glob"

import packageJson from "../package.json"

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
          outdir: "dist",
          format: "cjs",
        },
      ],
    },
    {
      entryPoints: glob.sync("./src/**/*.mu"),
      options: [
        {
          outdir: "dist",
          format: "cjs",
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
    sourcemap: "external",
    minify: true,
    keepNames: true,
    legalComments: "eof",
    outbase: "src",
    loader: {
      ".mu": "text",
    },
    treeShaking: true,
  }

  const dependencies = packageJson.dependencies
  const peerDependencies = packageJson["peerDependencies"] || {}

  const moveToPeerDependencies = ["@types/aws-lambda", "json-schema-to-zod"]

  moveToPeerDependencies.forEach(d => {
    const ver = dependencies[d]
    if (!ver) {
      throw new Error(`pacakge ${d} was not found in dependencies`)
    }
    peerDependencies[d] = ver
    delete dependencies[d]
  })

  if (Object.values(peerDependencies).length) {
    packageJson["peerDependencies"] = peerDependencies
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
          packageManager: undefined,
          bin: {
            sdf: "./cli/sdf.js",
          },
          main: "./index.js",
          types: "./index.d.ts",
        },
        null,
        2,
      ),
    ),

    await copyFile("publish/types.d.ts", "dist/types.d.ts"),
    await copyFile("README.md", "dist/README.md"),

    await esbuild.build({
      ...esbuildOptions,
      outdir: "dist",
      banner: {
        js: `#!/usr/bin/env node`,
      },
      entryPoints: ["src/cli/sdf.ts"],
      sourcemap: "external",
      format: "cjs",
      outExtension: {
        ".js": ".js",
      },
    }),
  ])
}

run().catch(err => {
  console.error(err)
  process.exit(1)
})
