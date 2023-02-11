import * as esbuild from "esbuild";
import { readFile, writeFile } from "fs/promises";

const ADDED_STR = "// @ts-nocheck\n\n";

// List of broken modules
const FILES = [
  "node_modules/json-schema-to-typescript/src/utils.ts",
  "node_modules/json-schema-to-typescript/src/resolver.ts",
];

/**
 * This is a workaround to enforce tsc to no check types from
 * broken packages in node_modules.
 * https://github.com/microsoft/TypeScript/issues/38538#issuecomment-892555422
 *
 * Perhaps this will not be needed when https://github.com/microsoft/TypeScript/issues/40426
 * will land.
 */
const injectTsNoChecks = async () =>
  Promise.all(
    FILES.map(async (file: string) => {
      const content = await readFile(file, "utf-8");

      if (content.includes(ADDED_STR)) {
        console.log(JSON.stringify(ADDED_STR), "is already in", file);
      } else {
        await writeFile(file, ADDED_STR + content, "utf-8");
        console.log(JSON.stringify(ADDED_STR), "added into", file);
      }
    })
  );

const run = async () => {
  if (process.argv.includes("--inject-ts-no-checks")) {
    await injectTsNoChecks();
  }

  await esbuild.build({
    entryPoints: ["build.ts"],
    outfile: "tmp/build.js",
    bundle: true,
    external: ["esbuild", "typescript"],
    logLevel: "error",
    sourcemap: "inline",
    platform: "node"
  });
};

if (require.main === module) {
  run().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
