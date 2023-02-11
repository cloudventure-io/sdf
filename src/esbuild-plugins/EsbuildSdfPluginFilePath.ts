import * as esbuild from "esbuild";
import { isAbsolute, join } from "path";

const name = "sdf-plugin-filepath";

export const createEsbuildSdfPluginFilePathAPI = (): esbuild.Plugin => ({
  name,
  setup(build: esbuild.PluginBuild) {
    build.onResolve({ filter: /\?filepath$/ }, (args) => {
      const path = isAbsolute(args.path)
        ? args.path
        : join(args.resolveDir, args.path);
      return {
        path: path.replace(/\?filepath/, ""),
        namespace: name,
      };
    });

    build.onLoad({ filter: /.*/, namespace: name }, async (args) => {
      return {
        contents: JSON.stringify(args.path),
        loader: "json",
      };
    });
  },
});
