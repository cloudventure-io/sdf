import { Command } from "commander"
import * as esbuild from "esbuild"
import { readFile, rm, writeFile } from "fs/promises"
import { join, relative, resolve } from "path"

import type { App, AppManifest, AppOptions } from "../App"
import { BundleTypeScriptManifest } from "../bundler/BundlerTypeScript"
import { esbuildPlugins } from "../esbuild-plugins"
import { SdfConfig } from "../interfaces"

const cmd = new Command("sdf")

const outdir = join(process.cwd(), "cdktf.out")

const target = `node${process.version.match(/^v(\d+)\./)?.[1] || "18"}`

const configFilename = "./sdf.config.ts"

const loadConfig = async (): Promise<SdfConfig> => {
  const outfile = join(outdir, ".sdf/config.cjs")

  await esbuild.build({
    outfile,
    platform: "node",
    target,
    plugins: esbuildPlugins(),
    entryPoints: [configFilename],
    sourcemap: "inline",
    bundle: true,
    format: "cjs",
    treeShaking: true,
    keepNames: true,
    packages: "external",
  })

  const result = require(outfile)

  return result.default
}

cmd
  .command("synth")
  .allowUnknownOption(true)
  .action(async (_, cmd: Command) => {
    const config = await loadConfig()

    const options: AppOptions = {
      argv: [process.argv[0], resolve(configFilename), ...cmd.args],
      outdir,
    }

    const app: App = await config.synth(options)
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
  const buildMetadata: AppManifest = JSON.parse(await readFile(join(workdir, "sdf.manifest.json"), "utf8"))

  await Promise.all(
    buildMetadata.stacks.map(async stack =>
      Promise.all(
        stack.bundles.map(async bundleUntyped => {
          if (bundleUntyped.type !== "typescript") {
            return
          }

          const bundle: BundleTypeScriptManifest = bundleUntyped as BundleTypeScriptManifest

          const srcDir = resolve(workdir, bundle.srcDir)
          const bundleDir = resolve(workdir, bundle.bundleDir)
          const buildDir = resolve(workdir, bundle.buildDir)

          await rm(buildDir, { recursive: true, force: true })

          const esbuildOptions: esbuild.BuildOptions = {
            absWorkingDir: srcDir,
            entryPoints: bundle.entryPoints.map(entryPoint => relative(srcDir, join(bundleDir, entryPoint))),
            platform: "node",
            target,
            sourcemap: "inline",
            keepNames: true,
            outbase: bundleDir,
            outdir: buildDir,
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
            join(buildDir, "package.json"),
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
            await config.postBuild(bundle, buildDir)
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
