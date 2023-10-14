import { camelCase } from "change-case"
import { Construct } from "constructs"
import { OpenAPIV3 } from "openapi-types"
import { join, relative } from "path"

import { SdfApp } from "../../SdfApp"
import { SdfLambda, SdfLambdaConfig } from "../../constructs/lambda/SdfLambda"
import { writeMustacheTemplate } from "../../utils/writeMustacheTemplate"
import entryPointTemplate from "./templates/entryPoint.ts.mu"
import handlerTemplate from "./templates/handler.ts.mu"
import { SdfHttpApiAuthorizer } from "./SdfHttpApiAuthorizer"
import { SdfHttpApi } from "../SdfHttpApi/SdfHttpApi"
import { SdfBundlerTypeScript, SdfBundlerTypeScriptHandler } from "../../bundlers"

export interface SdfHttpApiLambdaAuthorizerConfig {
  context: OpenAPIV3.SchemaObject & Required<Pick<OpenAPIV3.SchemaObject, "title">>

  identitySource: string
  authorizerResultTtlInSeconds: number

  lambdaConfig?: Omit<SdfLambdaConfig<SdfBundlerTypeScript>, "handler" | "runtime" | "functionName">

  authorizerBody?: string
}

const entryPointFunctionName = "entrypoint"

export class SdfHttpApiLambdaAuthorizer extends SdfHttpApiAuthorizer {
  public lambda: SdfLambda<SdfBundlerTypeScript>
  private bundler: SdfBundlerTypeScript

  private entryPointsDirectory: string
  private authorizersDirectory: string

  constructor(
    scope: Construct,
    public id: string,
    public config: SdfHttpApiLambdaAuthorizerConfig,
  ) {
    super(scope, id)
    const app = SdfApp.getAppFromContext(this)
    this.bundler = SdfApp.getFromContext(this, SdfBundlerTypeScript)

    this.bundler._registerSchema(config.context)

    this.entryPointsDirectory = this.bundler.registerDirectory(this, "entrypoints", true)
    this.authorizersDirectory = this.bundler.registerDirectory(this, "authorizers", false)

    this.lambda = new SdfLambda(this.bundler, `authorizer-${id}`, {
      timeout: 29,
      memorySize: 512,
      ...config.lambdaConfig,

      functionName: app._concatName(this.bundler.node.id, "authorizer", id),
      publish: true,

      bundler: {
        handler: () => this.renderLambda(),
      },
    })
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
    const handlerPath = join(this.authorizersDirectory, camelCase(this.id))
    const entryPointPath = join(this.entryPointsDirectory, camelCase(`authorizer-${this.id}`))

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
        WrapperImport: relative(this.authorizersDirectory, entryPointPath),
        AuthorizerBody: this.config.authorizerBody || "{}",
      },
    })

    const entryPointRelPath = relative(this.bundler.gendir, entryPointPath)

    return {
      handler: `${entryPointRelPath}.${entryPointFunctionName}`,
      entryPoint: `${entryPointRelPath}.ts`,
    }
  }

  public context(): OpenAPIV3.SchemaObject {
    return this.config.context
  }
}
