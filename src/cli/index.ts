import { Command } from "commander"
import * as esbuild from "esbuild"
import { mkdir, readFile, rm, writeFile } from "fs/promises"
import { join } from "path"

import type { SdfApp, SdfAppMetadata, SdfAppOptions } from "../SdfApp"
import { esbuildPlugins } from "../esbuild-plugins"
import { SdfConfig } from "../types"
import { fileExists } from "../utils/fileExists"

const cmd = new Command("sdf-cli")

const rootDir = process.cwd()
const tmpDir = join(rootDir, "tmp")

const target = `node${process.version.match(/^v(\d+)\./)?.[1] || "14"}`

cmd
  .command("synth")
  .requiredOption("-e, --entryPoint <entryPoint>")
  .action(async ({ entryPoint }: { entryPoint: string }) => {
    await mkdir(tmpDir, { recursive: true })

    const outfile = join(tmpDir, `synth.js`)

    await esbuild.build({
      platform: "node",
      target,
      plugins: esbuildPlugins({ rootDir }),
      entryPoints: [entryPoint],
      outfile,
      sourcemap: "inline",
      bundle: true,
      format: "cjs",
      define: {
        "process.env.SDF_PROJECT_ROOT_DIR": JSON.stringify(rootDir),
        "process.env.SDF_PROJECT_TMP_DIR": JSON.stringify(tmpDir),
      },
      keepNames: true,
    })

    const synth: (options: SdfAppOptions) => Promise<SdfApp> = require(outfile).synth

    if (!synth || typeof synth !== "function") {
      throw new Error(`the entryPoint file ${entryPoint} must export an async function 'synth'`)
    }

    const options: SdfAppOptions = {
      rootDir,
      tmpDir,
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
    const configOutFile = join(tmpDir, "sdf.config.js")

    await esbuild.build({
      platform: "node",
      target,
      plugins: esbuildPlugins({ rootDir }),
      entryPoints: ["sdf.config.ts"],
      outfile: configOutFile,
      sourcemap: "inline",
      bundle: true,
      format: "cjs",
      keepNames: true,
    })

    config = require(configOutFile).default
  }

  const buildMetadata: SdfAppMetadata = JSON.parse(await readFile(join(tmpDir, "sdf.manifest.json"), "utf8"))

  await Promise.all(
    buildMetadata.stacks.map(async stack =>
      Promise.all(
        stack.services.map(async service => {
          const serviceSrcDir = join(process.cwd(), buildMetadata.path, stack.path, service.path)

          const outdir = join(tmpDir, stack.path, service.path)
          await rm(outdir, { recursive: true, force: true })

          const esbuildOptions: esbuild.BuildOptions = {
            absWorkingDir: serviceSrcDir,
            entryPoints: service.entryPoints,
            platform: "node",
            target,
            sourcemap: "inline",
            keepNames: true,
            outbase: join(process.cwd(), buildMetadata.path, stack.path, service.path),
            outdir,
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
          }

          await esbuild.build(config.buildConfig ? config.buildConfig(esbuildOptions) : esbuildOptions)

          const packageJson = JSON.parse(await readFile(join(serviceSrcDir, service.packageJsonPath), "utf8"))

          await writeFile(
            join(tmpDir, stack.path, service.path, "package.json"),
            JSON.stringify(
              {
                name: packageJson.name,
                version: packageJson.version,
                type: "module",
              },
              null,
              2,
            ),
          )

          if (config.postBuild) {
            await config.postBuild(service, outdir)
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
