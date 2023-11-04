import { camelCase, pascalCase } from "change-case"
import { Construct } from "constructs"
import { OpenAPIV3 } from "openapi-types"
import { join, relative } from "path"

import { SdfApp } from "../../SdfApp"
import { SdfBundlerTypeScript, SdfBundlerTypeScriptHandler } from "../../bundlers"
import { SdfLambda, SdfLambdaConfig } from "../../constructs/lambda/SdfLambda"
import { writeMustacheTemplate } from "../../utils/writeMustacheTemplate"
import { SdfHttpApi } from "../api/SdfHttpApi"
import { SdfHttpApiAuthorizer } from "./SdfHttpApiAuthorizer"
import entryPointTemplate from "./templates/entryPoint.ts.mu"
import handlerTemplate from "./templates/handler.ts.mu"

export interface SdfHttpApiLambdaAuthorizerConfig {
  context: OpenAPIV3.SchemaObject & Required<Pick<OpenAPIV3.SchemaObject, "title">>

  identitySource: string
  authorizerResultTtlInSeconds: number

  lambdaConfig?: Omit<SdfLambdaConfig<SdfBundlerTypeScript>, "handler" | "runtime" | "functionName">

  authorizerBody?: string

  prefix?: string
}

const entryPointFunctionName = "entrypoint"

export class SdfHttpApiLambdaAuthorizer extends SdfHttpApiAuthorizer {
  public lambda: SdfLambda<SdfBundlerTypeScript>
  private bundler: SdfBundlerTypeScript

  private entryPointsDirectory: string
  private authorizerDirectory: string

  private contextSchema: OpenAPIV3.SchemaObject

  private prefix: string

  constructor(
    scope: Construct,
    public id: string,
    public config: SdfHttpApiLambdaAuthorizerConfig,
  ) {
    super(scope, id)
    const app = SdfApp.getAppFromContext(this)
    this.bundler = SdfApp.getFromContext(this, SdfBundlerTypeScript)

    this.prefix = config.prefix ?? id

    this.bundler.registerSchema(config.context)

    this.entryPointsDirectory = join(this.bundler.entryPointsDir, this.prefix)
    this.authorizerDirectory = this.bundler.registerDirectory(this.prefix)

    this.lambda = new SdfLambda(this.bundler, `authorizer-${id}`, {
      timeout: 29,
      memorySize: 512,
      ...config.lambdaConfig,

      functionName: app._concatName(this.bundler.node.id, "authorizer", id),
      publish: true,

      bundler: () => this.renderLambda(),
    })

    this.contextSchema = {
      title: pascalCase(`AuthorzierContext-${id}`),
      type: "object",
      properties: {
        lambda: config.context,
      },
      required: ["lambda"],
    }
  }

  public spec(api: SdfHttpApi) {
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

  private async renderLambda(): Promise<SdfBundlerTypeScriptHandler> {
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
