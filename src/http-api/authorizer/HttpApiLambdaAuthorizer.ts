import { pascalCase } from "change-case"
import { Construct } from "constructs"
import { OpenAPIV3 } from "openapi-types"

import { Bundler } from "../../bundler"
import { App } from "../../core/App"
import { Lambda, LambdaConfig } from "../../lambda/Lambda"
import { HttpApi } from "../core/HttpApi"
import { HttpApiAuthorizer } from "./HttpApiAuthorizer"

export interface HttpApiLambdaAuthorizerConfig {
  contextSchema: OpenAPIV3.SchemaObject & Required<Pick<OpenAPIV3.SchemaObject, "title">>

  identitySource: string
  authorizerResultTtlInSeconds: number

  lambdaConfig?: Omit<LambdaConfig, "handler" | "runtime" | "functionName">

  authorizerBody?: string

  prefix?: string
  name: string
}

export class HttpApiLambdaAuthorizer extends HttpApiAuthorizer {
  public lambda: Lambda
  private bundler: Bundler

  public contextSchema: OpenAPIV3.SchemaObject

  public readonly prefix: string

  constructor(
    scope: Construct,
    public id: string,
    public config: HttpApiLambdaAuthorizerConfig,
  ) {
    super(scope, id)
    this.bundler = App.getFromContext(this, Bundler)

    this.prefix = config.prefix ?? id

    this.bundler.registerSchema(config.contextSchema)

    this.contextSchema = {
      title: pascalCase(`AuthorizerContext-${this.config.name}`),
      type: "object",
      properties: {
        lambda: config.contextSchema,
      },
      required: ["lambda"],
    }

    this.lambda = new Lambda(this, `lambda`, {
      timeout: 29,
      memorySize: 512,
      ...config.lambdaConfig,

      functionName: this.config.name,
      publish: true,

      entryPoint: () => this.bundler.generateHttpApiAuthorizer(this),
    })
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
}
