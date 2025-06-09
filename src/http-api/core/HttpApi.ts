import { Apigatewayv2Api } from "@cdktf/provider-aws/lib/apigatewayv2-api"
import { Apigatewayv2Stage } from "@cdktf/provider-aws/lib/apigatewayv2-stage"
import { DataAwsIamPolicyDocument } from "@cdktf/provider-aws/lib/data-aws-iam-policy-document"
import { IamRole } from "@cdktf/provider-aws/lib/iam-role"
import { IamRolePolicy } from "@cdktf/provider-aws/lib/iam-role-policy"
import { IamRolePolicyAttachment } from "@cdktf/provider-aws/lib/iam-role-policy-attachment"
import { AssetType, Fn, TerraformAsset, Token } from "cdktf"
import { camelCase, paramCase } from "change-case"
import { Construct } from "constructs"
import { OpenAPIV3 } from "openapi-types"

import { Bundler } from "../../bundler"
import { App, AppLifeCycle } from "../../core/App"
import { StackModule } from "../../core/StackModule"
import { AsyncResolvable } from "../../core/resolvable/AsyncResolvable"
import { Lambda, LambdaConfig } from "../../lambda/Lambda"
import { HttpApiAuthorizer } from "../authorizer/HttpApiAuthorizer"
import { Document } from "../openapi/Document"
import { BundledDocument } from "../openapi/types"
import { dereference } from "../openapi/utils"
import { DocumentSchemaAdapter, HttpApiOperationAuthorizer, OperationSchema } from "./DocumentSchemaAdapter"

type SchemaType = OpenAPIV3.SchemaObject

/**
 * Configuration for the HttpApi construct
 */
export interface HttpApiConfig {
  /** the OpenAPI Document */
  document: BundledDocument

  /** name of the API Gateway stage. defaults to `id` of the HttpApi */
  stageName?: string

  /** lambda function configuration */
  lambdaConfig?: Omit<LambdaConfig, "functionName">

  /** map of authorizers */
  authorizers?: Record<string, HttpApiAuthorizer | null>

  /** the API path prefix for the generated files, defaults to {id} */
  prefix?: string

  /** the name of the HTTP API. this value is used as name prefix for all sub-resources. */
  name: string

  /** the request interceptor path relative to the bundler path */
  middleware?: string

  /**
   * When true the list of security scopes will not be sent to API Gateway
   * allowing using those parameters for custom role based authorization.
   **/
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
export class HttpApi extends StackModule {
  /** lambda functions defined based on the provided OpenAPI Document */
  public readonly lambdas: { [operationId in string]: Lambda } = {}

  /** the bundler instance */
  private readonly bundler: Bundler

  /** the stage name of the API Gateway */
  private readonly stageName: string

  /** the API Gateway instance */
  public readonly apigw: Apigatewayv2Api

  /** the API Gateway stage instance */
  public readonly stage: Apigatewayv2Stage

  public readonly schemaAdapter: DocumentSchemaAdapter

  /** the document parser instance */
  public readonly document: Document<SchemaType>

  /** the integration role for the API Gateway */
  public readonly integrationRole: IamRole

  /** the API path prefix for the generated files */
  public readonly prefix: string

  /**
   * The asset path of the OpenAPI specification.
   * Note, that it contains a resolvable value pointing to the asset path.
   */
  public readonly apiSpecAssetPath?: string

  constructor(
    scope: Construct,
    public readonly id: string,
    public readonly config: HttpApiConfig,
  ) {
    const bundler = App.findInScopes(scope, s => Bundler.isBundler(s))
    super(scope, id)
    this.bundler = bundler
    this.prefix = config.prefix ?? id

    this.stageName = config.stageName || "$default"

    this.document = new Document(dereference(this.config.document))

    this.schemaAdapter = new DocumentSchemaAdapter({
      document: this.document,
      authorizers: config.authorizers || {},
      schemaRegistry: this.bundler.schemaRegistry,
    })

    // generate the API Gateway specification
    const apiSpecPath = this.bundler.generateHttpApiSpecification(this)

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

    // define authorizers
    Object.values(this.schemaAdapter.authorizers)
      .filter(
        (
          a: HttpApiOperationAuthorizer,
        ): a is {
          securityScheme: OpenAPIV3.SecuritySchemeObject
          authorizer: HttpApiAuthorizer
        } => !!a.authorizer,
      )
      .forEach(({ securityScheme, authorizer }) => {
        securityScheme["x-amazon-apigateway-authorizer"] = authorizer.spec(this)
      })

    // define lambda functions
    for (const operation of this.schemaAdapter.operations) {
      this.defineLambda(operation)
    }

    if (this.document.schemas) {
      Object.values(this.document.schemas).map(schema => {
        this.bundler.schemaRegistry.register(schema.value)
      })
    }

    if (config.stripSecurityScopes) {
      if (this.document.security) {
        this.document.security = this.document.security.map(security =>
          Object.keys(security).reduce((acc, key) => ({ ...acc, [key]: [] }), {}),
        )
      }

      // strip security scopes for AWS HTTP API
      this.schemaAdapter.operations.forEach(op => {
        if (op.operation.security) {
          op.operation.security = op.operation.security.map(security =>
            Object.keys(security).reduce((acc, key) => ({ ...acc, [key]: [] }), {}),
          )
        }
      })
    }

    const apiGwBody = new AsyncResolvable(this, `api-body`, async () =>
      Fn.jsonencode(
        await this.schemaAdapter.bundle(
          // do not include any schema for API Gateway v2 body, as it is unused
          () => undefined as unknown as OpenAPIV3.SchemaObject,
        ),
      ),
    ).asString()

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

    if (apiSpecPath) {
      // The TerraformAsset should be defined in AsyncResolvable
      // because the spec file is created with AsyncResolvable.
      this.apiSpecAssetPath = Token.asString(
        new AsyncResolvable(
          this,
          "openapi-json-asset",
          async () => {
            const asset = new TerraformAsset(this, "openapi-json-asset", {
              path: apiSpecPath,
              type: AssetType.FILE,
            })
            return asset.path
          },
          AppLifeCycle.generation,
        ),
      )
    }
  }

  private defineLambda<SchemaType>(op: OperationSchema<SchemaType>) {
    const { schemas, operation } = op

    // register the operation schema
    this.bundler.schemaRegistry.register(schemas.operation.value)

    // generate the function handler
    const entryPoint = this.bundler.generateHttpApiHandler(this, op)

    const lambda = new Lambda(this, `api-handler-${camelCase(operation.operationId)}`, {
      timeout: 29,
      memorySize: 512,
      ...this.config.lambdaConfig,

      functionName: `${this.config.name}-${paramCase(operation.operationId)}`,
      publish: true,
      resources: operation.resolveLinks(),

      entryPoint,
    })

    this.lambdas[operation.operationId] = lambda

    // Add AWS integration
    operation.data["x-amazon-apigateway-integration"] = {
      payloadFormatVersion: "2.0",
      type: "aws_proxy",
      httpMethod: "POST",
      uri: lambda.function.qualifiedInvokeArn,
      connectionType: "INTERNET",
      credentials: this.integrationRole.arn,
    }
  }
}
