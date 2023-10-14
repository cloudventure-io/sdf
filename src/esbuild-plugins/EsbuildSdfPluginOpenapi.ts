import SwaggerParser from "@apidevtools/swagger-parser"
import * as esbuild from "esbuild"
import { isAbsolute, join, relative } from "path"

import { Document } from "../http-api/openapi/types"

const name = "sdf-plugin-openapi"

export const createEsbuildSdfPluginOpenAPI = (): esbuild.Plugin => ({
  name,
  setup(build: esbuild.PluginBuild) {
    build.onResolve({ filter: /openapi.ya?ml$/ }, args => {
      return {
        path: isAbsolute(args.path) ? args.path : join(args.resolveDir, args.path),
        namespace: name,
      }
    })

    build.onLoad({ filter: /.*/, namespace: name }, async args => {
      // At this point we can only bundle and validate the spec.
      // Dereferencing will break the interface generation process and produce
      // duplicate interfaces.
      const spec = (await SwaggerParser.bundle(args.path)) as Document<object>

      spec["x-sdf-spec-path"] = relative(process.cwd(), args.path)

      return {
        contents: JSON.stringify(spec),
        loader: "json",
      }
    })
  },
})
