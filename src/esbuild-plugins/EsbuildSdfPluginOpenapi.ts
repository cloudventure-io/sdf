import * as esbuild from "esbuild";
import { isAbsolute, join, relative } from "path";
import SwaggerParser from "@apidevtools/swagger-parser";
import { walkOperations } from "../openapi/walkOperations";
import { Document } from "../openapi/types";

export interface EsbuildSdfPluginOpenAPIOptions {
  rootDir: string;
}

const name = "sdf-plugin-openapi";

export const createEsbuildSdfPluginOpenAPI = (
  options: EsbuildSdfPluginOpenAPIOptions
): esbuild.Plugin => ({
  name,
  setup(build: esbuild.PluginBuild) {
    build.onResolve({ filter: /openapi.ya?ml$/ }, (args) => {
      return {
        path: isAbsolute(args.path)
          ? args.path
          : join(args.resolveDir, args.path),
        namespace: name,
      };
    });

    build.onLoad({ filter: /.*/, namespace: name }, async (args) => {
      // At this point we can only bundle and validate the spec.
      // Dereferencing will break the interface generation process and produce
      // duplicate interfaces.
      const spec = (await SwaggerParser.bundle(args.path)) as Document<{}>;

      const path = relative(options.rootDir, args.path);

      spec["x-sdf-spec-path"] = path;

      // Custom Validation
      walkOperations({
        document: spec,
        operationHandler({ operationSpec, pathPattern, method }) {
          if (!operationSpec.operationId) {
            throw new Error(
              `Each operation must have a unique operationId (${path}#/paths/${pathPattern}/${method})`
            );
          }
        },
      });
      // TODO: validate other conditions defined in types.ts

      return {
        contents: JSON.stringify(spec),
        loader: "json",
      };
    });
  },
});
