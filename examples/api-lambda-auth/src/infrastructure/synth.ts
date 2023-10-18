import { ArchiveProvider } from "@cdktf/provider-archive/lib/provider"
import { AwsProvider } from "@cdktf/provider-aws/lib/provider"

import {
  SdfApp,
  SdfAppOptions,
  SdfBundlerTypeScript,
  SdfHttpApi,
  SdfHttpApiLambdaAuthorizer,
  SdfStack,
} from "@cloudventure/sdf"

import document from "../api-with-authorizer/openapi.yml"
import srcpath from "../api-with-authorizer?filepath"

export const synth = async (options: SdfAppOptions): Promise<SdfApp> => {
  const app = new SdfApp(options)

  const stack = new SdfStack(app, "my-stack")

  new AwsProvider(stack, "aws")
  new ArchiveProvider(stack, "archive")

  const bundler = new SdfBundlerTypeScript(stack, "api-with-authorizer", {
    path: srcpath,
    layout: "compact",
  })

  const authorizer = new SdfHttpApiLambdaAuthorizer(bundler, "authorizer", {
    context: {
      title: "AuthContext",
      type: "object",
      properties: {
        name: {
          type: "string",
        },
      },
      required: ["name"],
      additionalProperties: false,
    },
    authorizerResultTtlInSeconds: 300,
    identitySource: "$request.header.Authorization",
  })

  new SdfHttpApi(bundler, "api", {
    document,
    authorizers: {
      authorizer,
    },
  })

  return app
}
