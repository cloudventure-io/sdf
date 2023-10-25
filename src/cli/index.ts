import { Command } from "commander"
import * as esbuild from "esbuild"
import { readFile, rm, writeFile } from "fs/promises"
import { join, relative, resolve } from "path"

import type { SdfApp, SdfAppManifest, SdfAppOptions } from "../SdfApp"
import { SdfBundleTypeScriptManifest } from "../bundlers/SdfBundlerTypeScript"
import { esbuildPlugins } from "../esbuild-plugins"
import { SdfConfig } from "../types"

const cmd = new Command("sdf")

const outdir = join(process.cwd(), "cdktf.out")

const target = `node${process.version.match(/^v(\d+)\./)?.[1] || "18"}`

const loadConfig = async (filename: string = "./sdf.config.ts"): Promise<SdfConfig> => {
  const transpilationResult = await esbuild.build({
    platform: "node",
    target,
    plugins: esbuildPlugins(),
    entryPoints: [filename],
    sourcemap: "inline",
    bundle: true,
    format: "cjs",
    keepNames: true,
    write: false,
  })

  const result = eval(transpilationResult.outputFiles[0].text)

  return result.default
}

cmd.command("synth").action(async () => {
  const config = await loadConfig()

  const options: SdfAppOptions = {
    outdir,
  }

  const app: SdfApp = await config.synth(options)
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
  const config = await loadConfig()

  const workdir = join(outdir, ".sdf")
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
