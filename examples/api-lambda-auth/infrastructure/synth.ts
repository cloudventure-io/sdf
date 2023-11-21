import { ArchiveProvider } from "@cdktf/provider-archive/lib/provider"
import { AwsProvider } from "@cdktf/provider-aws/lib/provider"
import { S3Backend, TerraformOutput } from "cdktf"
import { Command, Option } from "commander"
import { config as configDotenv } from "dotenv"

import { App, AppOptions, Stack } from "@cloudventure/sdf"
import { BundlerTypeScript } from "@cloudventure/sdf/bundler"
import { HttpApi } from "@cloudventure/sdf/http-api"
import { HttpApiLambdaAuthorizer } from "@cloudventure/sdf/http-api/authorizer"

import document from "../backend/openapi.yml"
import srcpath from "../backend?filepath"

const region = "eu-central-1"

export const synth = async (options: AppOptions): Promise<App> => {
  configDotenv({ path: "../../.env" })

  const cmd = new Command()
  cmd.addOption(new Option("-n, --name <string>", "the name of the deployment").makeOptionMandatory())
  cmd.addOption(
    new Option("-b, --state-bucket <string>", "the s3 bucket for terraform state")
      .env("TF_STATE_BUCKET")
      .makeOptionMandatory(),
  )
  cmd.addOption(new Option("-l, --lock-table <string>", "the terraform lock table").env("TF_STATE_LOCK_TABLE"))

  const opts: {
    name: string
    stateBucket: string
    lockTable?: string
  } = (await cmd.parseAsync(options.argv)).opts()

  const app = new App(options)
  const stack = new Stack(app, "deployment")

  new AwsProvider(stack, "aws")
  new ArchiveProvider(stack, "archive")

  const bundler = new BundlerTypeScript(stack, "api-with-authorizer", {
    path: srcpath,
  })

  const authorizer = new HttpApiLambdaAuthorizer(bundler, "authorizer", {
    context: {
      title: "AuthContext",
      type: "object",
      properties: {
        name: {
          type: "string",
          minLength: 3,
        },
      },
      required: ["name"],
      additionalProperties: false,
    },
    authorizerResultTtlInSeconds: 300,
    identitySource: "$request.header.Authorization",
  })

  const httpApi = new HttpApi(bundler, "api", {
    document,
    authorizers: {
      authorizer,
    },
    requestInterceptor: "interceptors",
    generateClient: {
      name: "api",
    },
  })

  new TerraformOutput(stack, "api_url", {
    value: httpApi.apigw.apiEndpoint,
  })

  new S3Backend(stack, {
    encrypt: true,
    bucket: opts.stateBucket,
    key: `states/${opts.name}/terraform.tfstate`,
    region: region,
    acl: "bucket-owner-full-control",
    dynamodbTable: opts.lockTable,
  })

  return app
}
