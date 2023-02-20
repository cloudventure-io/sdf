import { camelCase } from "change-case"
import { Construct } from "constructs"
import { OpenAPIV3 } from "openapi-types"
import { join, relative } from "path"

import { SdfApp } from "../../SdfApp"
import { SdfBundler } from "../../SdfBundler"
import { SdfLambda, SdfLambdaConfig, SdfLambdaHandler } from "../../constructs/lambda/SdfLambda"
import { writeMustacheTemplate } from "../../utils/writeMustacheTemplate"
import entryPointTemplate from "./templates/entryPoint.ts.mu"
import handlerTemplate from "./templates/handler.ts.mu"

export interface SdfApiGatewayV2AuthorizerConfig {
  context: OpenAPIV3.SchemaObject & Required<Pick<OpenAPIV3.SchemaObject, "title">>

  identitySource: string
  authorizerResultTtlInSeconds: number

  lambdaConfig?: Omit<SdfLambdaConfig, "handler" | "runtime" | "functionName">

  authorizerBody?: string
}

const entryPointFunctionName = "entrypoint"

export class SdfHttpApiAuthorizer extends Construct {
  public lambda: SdfLambda
  private bundler: SdfBundler

  constructor(scope: Construct, public id: string, public config: SdfApiGatewayV2AuthorizerConfig) {
    super(scope, id)
    const app = SdfApp.getAppFromContext(this)
    this.bundler = SdfBundler.getBundlerFromCtx(this)

    this.bundler._registerSchema(config.context)

    this.lambda = new SdfLambda(this, `authorizer-${id}`, {
      timeout: 29,
      memorySize: 512,
      ...config.lambdaConfig,

      functionName: app._concatName(this.bundler.id, "authorizer", id),
      publish: true,
      runtime: "node16.x",
      handler: async () => this.renderLambda(),
    })
  }

  public getApiGatewaySpec() {
    return {
      type: "request",
      authorizerPayloadFormatVersion: "2.0",
      enableSimpleResponses: false,
      identitySource: this.config.identitySource,
      authorizerResultTtlInSeconds: this.config.authorizerResultTtlInSeconds,
      authorizerUri: this.lambda.function.invokeArn,
    }
  }

  private async renderLambda(): Promise<SdfLambdaHandler> {
    const authorizersDir = join(this.bundler.absDir, this.id)
    const entryPointsDirectory = join(authorizersDir, "entrypoints")
    const handlersDirectory = join(authorizersDir, "authorizers")

    const handlerPath = join(handlersDirectory, camelCase(this.id))
    const entryPointPath = join(entryPointsDirectory, camelCase(`authorizer-${this.id}`))

    await writeMustacheTemplate({
      template: entryPointTemplate,
      path: `${entryPointPath}.ts`,
      overwrite: true,
      context: {
        AuthorizerModel: this.config.context.title,
        InterfacesImport: relative(entryPointsDirectory, this.bundler._interfacesAbsPath),
        HandlerImport: relative(entryPointsDirectory, handlerPath),
        EntryPointFunctionName: entryPointFunctionName,
      },
    })

    await writeMustacheTemplate({
      template: handlerTemplate,
      path: `${handlerPath}.ts`,
      overwrite: false,
      context: {
        WrapperImport: relative(handlersDirectory, entryPointPath),
        AuthorizerBody: this.config.authorizerBody || "{}",
      },
    })

    const entryPointRelPath = relative(this.bundler.absDir, entryPointPath)

    return {
      handler: `${entryPointRelPath}.${entryPointFunctionName}`,
      entryPoint: `${entryPointRelPath}.ts`,
    }
  }
}
