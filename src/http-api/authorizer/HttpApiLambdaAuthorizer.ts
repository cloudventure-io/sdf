import { camelCase, paramCase, pascalCase } from "change-case"
import { Construct } from "constructs"
import { OpenAPIV3 } from "openapi-types"
import { join, relative } from "path"

import { App } from "../../App"
import { BundlerTypeScript, BundlerTypeScriptHandler } from "../../bundler"
import { Lambda, LambdaConfig } from "../../lambda/Lambda"
import { writeMustacheTemplate } from "../../utils/writeMustacheTemplate"
import { HttpApi } from "../HttpApi"
import { HttpApiAuthorizer } from "./HttpApiAuthorizer"
import entryPointTemplate from "./templates/entryPoint.ts.mu"
import handlerTemplate from "./templates/handler.ts.mu"

export interface HttpApiLambdaAuthorizerConfig {
  context: OpenAPIV3.SchemaObject & Required<Pick<OpenAPIV3.SchemaObject, "title">>

  identitySource: string
  authorizerResultTtlInSeconds: number

  lambdaConfig?: Omit<LambdaConfig<BundlerTypeScript>, "handler" | "runtime" | "functionName">

  authorizerBody?: string

  prefix?: string
}

const entryPointFunctionName = "entrypoint"

export class HttpApiLambdaAuthorizer extends HttpApiAuthorizer {
  public lambda: Lambda<BundlerTypeScript>
  private bundler: BundlerTypeScript

  private entryPointsDirectory: string
  private authorizerDirectory: string

  private contextSchema: OpenAPIV3.SchemaObject

  private prefix: string

  constructor(
    scope: Construct,
    public id: string,
    public config: HttpApiLambdaAuthorizerConfig,
  ) {
    super(scope, id)
    this.bundler = App.getFromContext(this, BundlerTypeScript)

    this.prefix = config.prefix ?? id

    this.bundler.registerSchema(config.context)

    this.entryPointsDirectory = join(this.bundler.entryPointsDir, this.prefix)
    this.authorizerDirectory = this.bundler.registerDirectory(this.prefix)

    this.lambda = new Lambda(this.bundler, `lambda`, {
      timeout: 29,
      memorySize: 512,
      ...config.lambdaConfig,

      functionName: paramCase(`${this.bundler.node.id}-${id}`),
      publish: true,

      bundler: () => this.renderLambda(),
    })

    this.contextSchema = {
      title: pascalCase(`AuthorizerContext-${id}`),
      type: "object",
      properties: {
        lambda: config.context,
      },
      required: ["lambda"],
    }
  }

  public spec(api: HttpApi) {
    return {
      type: "request",
      authorizerPayloadFormatVersion: "2.0",
      enableSimpleResponses: true,
      identitySource: this.config.identitySource,
      authorizerResultTtlInSeconds: this.config.authorizerResultTtlInSeconds,
      authorizerUri: this.lambda.function.qualifiedInvokeArn,
      authorizerCredentials: api.integrationRole.arn,
    }
  }

  private async renderLambda(): Promise<BundlerTypeScriptHandler> {
    const handlerPath = join(this.authorizerDirectory, camelCase(this.id))
    const entryPointPath = join(this.entryPointsDirectory, camelCase(this.id))

    await writeMustacheTemplate({
      template: entryPointTemplate,
      path: `${entryPointPath}.ts`,
      overwrite: true,
      context: {
        AuthorizerModel: this.config.context.title,
        InterfacesImport: relative(this.entryPointsDirectory, this.bundler._interfacesAbsPath),
        HandlerImport: relative(this.entryPointsDirectory, handlerPath),
        EntryPointFunctionName: entryPointFunctionName,
      },
    })

    await writeMustacheTemplate({
      template: handlerTemplate,
      path: `${handlerPath}.ts`,
      overwrite: false,
      context: {
        WrapperImport: relative(this.authorizerDirectory, entryPointPath),
        AuthorizerBody: this.config.authorizerBody || "{}",
      },
    })

    const entryPointRelPath = relative(this.bundler.bundleDir, entryPointPath)

    return {
      handler: `${entryPointRelPath}.${entryPointFunctionName}`,
      entryPoint: `${entryPointRelPath}.ts`,
    }
  }

  public context(): OpenAPIV3.SchemaObject {
    return this.contextSchema
  }
}
