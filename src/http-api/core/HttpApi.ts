import { Apigatewayv2Api } from "@cdktf/provider-aws/lib/apigatewayv2-api"
import { Apigatewayv2Stage } from "@cdktf/provider-aws/lib/apigatewayv2-stage"
import { DataAwsIamPolicyDocument } from "@cdktf/provider-aws/lib/data-aws-iam-policy-document"
import { IamRole } from "@cdktf/provider-aws/lib/iam-role"
import { IamRolePolicy } from "@cdktf/provider-aws/lib/iam-role-policy"
import { IamRolePolicyAttachment } from "@cdktf/provider-aws/lib/iam-role-policy-attachment"
import { SchemaObject } from "ajv"
import { camelCase, paramCase } from "change-case"
import { Construct } from "constructs"
import { OpenAPIV3 } from "openapi-types"

import { Bundler } from "../../bundler"
import { App, AppLifeCycle } from "../../core/App"
import { AsyncResolvable } from "../../core/resolvable/AsyncResolvable"
import { Lambda, LambdaConfig } from "../../lambda/Lambda"
import { HttpApiJwtAuthorizer, HttpApiLambdaAuthorizer } from "../authorizer"
import { HttpApiAuthorizer } from "../authorizer/HttpApiAuthorizer"
import { Document } from "../openapi/types"
import { DocumentParser, OperationBundle, ParsedOperationSecurity } from "./DocumentParser"

export interface HttpApiOperation extends OperationBundle {
  operationSchema: OpenAPIV3.SchemaObject & Required<Pick<OpenAPIV3.SchemaObject, "title">>
  validatorSchemas: Array<SchemaObject>
}

/**
 * Configuration for the HttpApi construct
 */
export interface HttpApiConfig<T extends object> {
  /** the OpenAPI Document */
  document: Document<T>

  /** name of the API Gateway stage. defaults to `id` of the HttpApi */
  stageName?: string

  /** lambda function configuration */
  lambdaConfig?: LambdaConfig

  /** map of authorizers */
  authorizers?: Record<string, HttpApiAuthorizer>

  /** the response body of the generated handler fuction, defaults to `{}` */
  handlerBody?: string

  /** the API path prefix for the generated files, defaults to {id} */
  prefix?: string

  /** the name of the HTTP API. this value is used as name prefix for all sub-resources. */
  name: string

  /** the request interceptor path relative to the bundler path */
  requestInterceptor?: string

  /** the response interceptor path relative to the bundler path */
  responseInterceptor?: string

  /**
   * When true the list of security scopes will not be sent to API Gateway
   * allowing using those parameters for role based authorization.
   * */
  stripSecurityScopes?: boolean

  /** generate client code for the API */
  generateClient?: {
    name: string
  }
}

/**
 * HttpApi is a construct that generates a HTTP API Gateway based on the provided OpenAPI Document.
 * It also generates lambda functions for the API Gateway operations.
 */
export class HttpApi<OperationType extends object = object> extends Construct {
  /** lambda functions defined based on the provided OpenAPI Document */
  public lambdas: { [operationId in string]: Lambda } = {}

  /** the bundler instance */
  private bundler: Bundler

  /** the stage name of the API Gateway */
  private stageName: string

  /** the API Gateway instance */
  public readonly apigw: Apigatewayv2Api

  /** the API Gateway stage instance */
  public readonly stage: Apigatewayv2Stage

  /** the document parser instance */
  public readonly documentParser: DocumentParser

  /** the authorizers defined in the document */
  private authorizers: Record<string, HttpApiAuthorizer> = {}

  /** the integration role for the API Gateway */
  public readonly integrationRole: IamRole

  /** the API path prefix for the generated files */
  public readonly prefix: string

  constructor(
    scope: Construct,
    private id: string,
    public readonly config: HttpApiConfig<OperationType>,
  ) {
    super(scope, id)
    this.bundler = App.getFromContext(this, Bundler)
    this.prefix = config.prefix ?? id

    this.stageName = config.stageName || "$default"

    // clone the document, since document will be mutated in further operations
    this.documentParser = new DocumentParser(JSON.parse(JSON.stringify(this.config.document)))

    // define API GW integration role
    this.integrationRole = new IamRole(this, "integration-role", {
      name: `${this.config.name}-integration`,
      assumeRolePolicy: new DataAwsIamPolicyDocument(this, "integration-role-assume-role-policy-doc", {
        statement: [
          {
            actions: ["sts:AssumeRole"],
            principals: [{ type: "Service", identifiers: ["apigateway.amazonaws.com"] }],
          },
        ],
      }).json,
    })
    new IamRolePolicyAttachment(this, "integration-role-policy-attachment", {
      role: this.integrationRole.name,
      policyArn: "arn:aws:iam::aws:policy/service-role/AmazonAPIGatewayPushToCloudWatchLogs",
    })
    new IamRolePolicy(this, "integration-role-access-policy", {
      role: this.integrationRole.name,
      policy: new DataAwsIamPolicyDocument(this, "integration-role-access-policy-doc", {
        statement: [
          {
            actions: ["lambda:InvokeFunction"],
            resources: ["*"],
          },
        ],
      }).json,
    })

    // define lambda functions
    const apiGwBody = new AsyncResolvable(this, `lambdas`, async () => {
      // extract the authorizers from the document and map to the input authorizers.
      await this.parseAuthorizers()

      // walk through the operations and define the lambda functions
      await this.documentParser.walkOperations(async operation => this.defineLambda(operation))

      const doc = await this.documentParser.document
      if (doc.components?.schemas) {
        doc.components.schemas = Object.fromEntries(
          Object.entries(doc.components.schemas).map(([name, schema]) => [name, this.bundler.registerSchema(schema)]),
        )
      }

      // generate the OpenAPI specification file of this API
      await this.bundler.generateHttpApiSpecification(this)

      if (config.stripSecurityScopes) {
        // strip security scopes for AWS HTTP API
        this.documentParser.walkOperations(async operation => {
          if (operation.operationSpec.security) {
            operation.operationSpec.security = operation.operationSpec.security.map(security =>
              Object.keys(security).reduce((acc, key) => ({ ...acc, [key]: [] }), {}),
            )
          }
        })
      }

      return JSON.stringify(await this.documentParser.bundle())
    }).asString()

    // define the AWS HTTP API
    const api = (this.apigw = new Apigatewayv2Api(this, "api", {
      name: config.document.info.title,
      version: config.document.info.version,
      protocolType: "HTTP",
      body: apiGwBody,
      corsConfiguration: {
        allowHeaders: ["*"],
        allowMethods: ["*"],
        allowOrigins: ["*"],
        maxAge: 3600,
        exposeHeaders: ["*"],
        allowCredentials: false,
      },
    }))

    this.stage = new Apigatewayv2Stage(this, "deployment", {
      apiId: api.id,
      name: this.stageName,
      autoDeploy: true,
    })

    if (config.generateClient) {
      new AsyncResolvable(
        this,
        "client-generator",
        async () => this.bundler.generateHttpApiClient(this),
        AppLifeCycle.generation,
      )
    }
  }

  /** parse the authorizers from the document and map to the input authorizers */
  private async parseAuthorizers() {
    this.authorizers = Object.entries((await this.documentParser.document).components?.securitySchemes || {}).reduce(
      (acc, [name, securityScheme]) => {
        const trace = this.documentParser.trace(["components", "securitySchemes", name])

        const authorizer = this.config.authorizers?.[name]
        if (!authorizer) {
          throw new Error(`authorizer '${name}' is defined in the document, but not provided at ${trace}`)
        }

        if (
          securityScheme.type === "apiKey" &&
          securityScheme.in === "header" &&
          !(authorizer instanceof HttpApiLambdaAuthorizer)
        ) {
          throw new Error(`lambda authorizer is required for 'apiKey' authorization at ${trace}`)
        } else if (securityScheme.type === "oauth2" && !(authorizer instanceof HttpApiJwtAuthorizer)) {
          throw new Error(`jwt authorizer is required for 'apiKey' authorization at ${trace}`)
        }

        // NOTICE: mutating the document
        securityScheme["x-amazon-apigateway-authorizer"] = authorizer.spec(this)

        return {
          ...acc,
          [name]: authorizer,
        }
      },
      {},
    )
  }

  /** get the authorizer for the given operation */
  private getOperationAuthorizer(
    operationAuthorizer: ParsedOperationSecurity | undefined,
  ): HttpApiAuthorizer | undefined {
    if (operationAuthorizer) {
      const authorizer = this.authorizers[operationAuthorizer.name]
      if (!authorizer) {
        throw new Error(`authorizer '${operationAuthorizer.name}' not found`)
      }
      return authorizer
    }
  }

  private async defineLambda(operation: OperationBundle) {
    // create the http api operation object from the parsed operation
    const authorizer = this.getOperationAuthorizer(operation.security)

    const httpOperation = this.documentParser.createHttpApiOperation(operation, authorizer?.contextSchema)

    const { operationId, document, operationSpec, operationSchema } = httpOperation

    // register the operation schema
    this.bundler.registerSchema(operationSchema)

    // generate the function handler
    const entryPoint = await this.bundler.generateHttpApiHandler(this, httpOperation)

    const lambda = new Lambda(this, `api-handler-${camelCase(operationId)}`, {
      timeout: 29,
      memorySize: 512,
      ...this.config.lambdaConfig,

      functionName: `${this.config.name}-${paramCase(operationId)}`,
      publish: true,
      resources: {
        ...this.config.lambdaConfig?.resources,
        ...document["x-sdf-resources"],
        ...operationSpec["x-sdf-resources"],
      },

      entryPoint,
    })

    this.lambdas[operationId] = lambda

    // NOTICE: mutating the document
    operationSpec["x-amazon-apigateway-integration"] = {
      payloadFormatVersion: "2.0",
      type: "aws_proxy",
      httpMethod: "POST",
      uri: lambda.function.qualifiedInvokeArn,
      connectionType: "INTERNET",
      credentials: this.integrationRole.arn,
    }
  }
}
