import { Command } from "commander"
import * as esbuild from "esbuild"
import { readFile, rm, writeFile } from "fs/promises"
import { join, relative, resolve } from "path"

import type { SdfApp, SdfAppManifest, SdfAppOptions } from "../SdfApp"
import { SdfBundleTypeScriptManifest } from "../bundlers/SdfBundlerTypeScript"
import { esbuildPlugins } from "../esbuild-plugins"
import { SdfConfig, SdfSynth } from "../types"
import { fileExists } from "../utils/fileExists"

const cmd = new Command("sdf")

// const rootDir = process.cwd()
// const tmpDir = join(rootDir, "tmp")
const outdir = join(process.cwd(), "cdktf.out")
const workdir = join(outdir, ".sdf")

const target = `node${process.version.match(/^v(\d+)\./)?.[1] || "18"}`

cmd
  .command("synth")
  .requiredOption("-e, --entryPoint <entryPoint>")
  .action(async ({ entryPoint }: { entryPoint: string }) => {
    // await mkdir(tmpDir, { recursive: true })

    const outfile = join(workdir, `synth.js`)

    await esbuild.build({
      platform: "node",
      target,
      plugins: esbuildPlugins(),
      entryPoints: [entryPoint],
      outfile,
      sourcemap: "inline",
      bundle: true,
      format: "cjs",
      keepNames: true,
    })

    const synth: SdfSynth = require(outfile).synth

    if (!synth || typeof synth !== "function") {
      throw new Error(`the entryPoint file ${entryPoint} must export an async function 'synth'`)
    }

    const options: SdfAppOptions = {
      outdir,
    }

    const app: SdfApp = await synth(options)
    await app.synth()
  })

/**
 * https://github.com/evanw/esbuild/pull/2067#issuecomment-1073039746
 */
const ESM_REQUIRE_SHIM = `
 await (async () => {
    const { dirname } = await import('path')
    const { fileURLToPath } = await import('url')
 
    /**
     * Shim entry-point related paths.
     */
    if (typeof globalThis.__filename === 'undefined') {
      globalThis.__filename = fileURLToPath(import.meta.url)
    }
    if (typeof globalThis.__dirname === 'undefined') {
      globalThis.__dirname = dirname(globalThis.__filename)
    }
 
    /**
     * Shim require if needed.
     */
    if (typeof globalThis.require === 'undefined') {
      const { default: module } = await import('module')
      globalThis.require = module.createRequire(import.meta.url)
    }
 })()
 `

cmd.command("build").action(async () => {
  let config: SdfConfig = {}
  if (await fileExists("sdf.config.ts")) {
    const configOutFile = join(workdir, "sdf.config.js")

    await esbuild.build({
      platform: "node",
      target,
      plugins: esbuildPlugins(),
      entryPoints: ["sdf.config.ts"],
      outfile: configOutFile,
      sourcemap: "inline",
      bundle: true,
      format: "cjs",
      keepNames: true,
    })

    config = require(configOutFile).default
  }

  const buildMetadata: SdfAppManifest = JSON.parse(await readFile(join(workdir, "sdf.manifest.json"), "utf8"))

  await Promise.all(
    buildMetadata.stacks.map(async stack =>
      Promise.all(
        stack.bundles.map(async bundleUntyped => {
          if (bundleUntyped.type !== "typescript") {
            return
          }

          const bundle: SdfBundleTypeScriptManifest = bundleUntyped as SdfBundleTypeScriptManifest

          const bundlePath = resolve(workdir, bundle.path)
          const bundlePrefix = resolve(workdir, bundle.prefix)
          const bundleDist = resolve(workdir, bundle.dist)
          // console.log("bundlePath", bundlePath)
          // console.log("bundlePrefix", bundlePrefix)
          // console.log("bundleDist", bundleDist)

          // const outdir = join(tmpDir, stack.name, bundle.name)
          await rm(bundleDist, { recursive: true, force: true })

          const esbuildOptions: esbuild.BuildOptions = {
            absWorkingDir: bundlePath,
            entryPoints: bundle.entryPoints.map(entryPoint => relative(bundlePath, join(bundlePrefix, entryPoint))),
            platform: "node",
            target,
            sourcemap: "inline",
            keepNames: true,
            outbase: bundlePrefix,
            outdir: bundleDist,
            bundle: true,
            format: "esm",
            splitting: true,
            chunkNames: `chunks/[name]-[hash]`,
            treeShaking: true,
            legalComments: "external",
            banner: {
              js: ESM_REQUIRE_SHIM,
            },
            mainFields: ["module", "main"],
            external: ["@aws-sdk"],
          }

          await esbuild.build(config.buildConfig ? config.buildConfig(esbuildOptions) : esbuildOptions)

          await writeFile(
            join(bundleDist, "package.json"),
            JSON.stringify(
              {
                name: `${stack.id}-${bundle.id}`,
                type: "module",
              },
              null,
              2,
            ),
          )

          if (config.postBuild) {
            await config.postBuild(bundle, bundleDist)
          }
        }),
      ),
    ),
  )
})

cmd.parseAsync().catch(error => {
  console.error(error)
  process.exit(1)
})
