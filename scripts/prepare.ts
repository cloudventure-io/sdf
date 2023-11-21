import * as esbuild from "esbuild"

const run = async () => {
  await esbuild.build({
    entryPoints: ["scripts/build.ts", "scripts/jest-raw-transformer.ts"],
    outdir: "tmp/",
    bundle: true,
    external: ["esbuild", "typescript"],
    logLevel: "error",
    sourcemap: "inline",
    platform: "node",
  })
}

if (require.main === module) {
  run().catch(error => {
    console.error(error)
    process.exit(1)
  })
}
