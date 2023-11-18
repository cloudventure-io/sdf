import { Apigatewayv2Api } from "@cdktf/provider-aws/lib/apigatewayv2-api"
import { Apigatewayv2Stage } from "@cdktf/provider-aws/lib/apigatewayv2-stage"
import { DataAwsIamPolicyDocument } from "@cdktf/provider-aws/lib/data-aws-iam-policy-document"
import { IamRole } from "@cdktf/provider-aws/lib/iam-role"
import { IamRolePolicy } from "@cdktf/provider-aws/lib/iam-role-policy"
import { IamRolePolicyAttachment } from "@cdktf/provider-aws/lib/iam-role-policy-attachment"
import Ajv, { Schema } from "ajv"
import standaloneCode from "ajv/dist/standalone"
import { camelCase, paramCase, pascalCase } from "change-case"
import { Construct } from "constructs"
import { OpenAPIV3 } from "openapi-types"
import { dirname, join } from "path"
import { relative } from "path"

import { SdfApp } from "../../SdfApp"
import { SdfBundlerTypeScript, SdfBundlerTypeScriptHandler } from "../../bundlers"
import { SdfLambda, SdfLambdaConfig } from "../../constructs/lambda/SdfLambda"
import { writeFile } from "../../utils/writeFile"
import { writeMustacheTemplate } from "../../utils/writeMustacheTemplate"
import { SdfHttpApiJwtAuthorizer, SdfHttpApiLambdaAuthorizer } from "../authorizer"
import { SdfHttpApiAuthorizer } from "../authorizer/SdfHttpApiAuthorizer"
import { DocumentTrace } from "../openapi/DocumentTrace"
import { Document } from "../openapi/types"
import { OperationBundle, OperationParser, ParsedOperation, ParsedOperationAuthorizer } from "./OperationParser"
import entryPointTemplate from "./templates/entryPoint.ts.mu"
import handlerTemplate from "./templates/handler.ts.mu"
import validatorTemplate from "./templates/validator.d.ts.mu"

export interface SdfHttpApiConfig<T extends object> {
  /** the OpenAPI Document */
  document: Document<T>

  /** name of the API Gateway stage. defaults to `id` of the SdfHttpApi */
  stageName?: string

  /** lambda function configuration */
  lambdaConfig?: Omit<SdfLambdaConfig<SdfBundlerTypeScript>, "handler" | "runtime" | "functionName">

  /** map of authorizers */
  authorizers?: Record<string, SdfHttpApiAuthorizer>

  /** the response body of the generated handler fuction, defaults to `{}` */
  handlerBody?: string

  /** the path prefix for the API */
  prefix?: string

  /** the request interceptor path relative to the bundler path */
  requestInterceptor?: string

  /** the response interceptor path relative to the bundler path */
  responseInterceptor?: string

  /**
   * When true the list of security scopes will not be sent to API Gateway
   * allowing using those parameters for role based authorization.
   * */
  stripSecurityScopes?: boolean
}

const entryPointFunctionName = "entrypoint"

export class SdfHttpApi<OperationType extends object = object> extends Construct {
  /** lambda functions defined based on the provided OpenAPI Document */
  public lambdas: { [operationId in string]: SdfLambda<SdfBundlerTypeScript> } = {}

  private bundler: SdfBundlerTypeScript
  private app: SdfApp
  private stageName: string

  private document: Document<OperationType>

  /**
   * the entry points directory of the api
   */
  private entryPointsDirectory: string

  /**
   * the validators directory of the api
   */
  private validatorsDirectory: string

  /**
   * the handlers directory of the api
   */
  private handlersDirectory: string

  public apigw: Apigatewayv2Api
  public stage: Apigatewayv2Stage

  private operationParser: OperationParser<OperationType>

  private authorizers: Record<string, SdfHttpApiAuthorizer> = {}

  public integrationRole: IamRole

  private prefix: string
  private documentOutputPath: string

  constructor(
    scope: Construct,
    private id: string,
    private config: SdfHttpApiConfig<OperationType>,
  ) {
    super(scope, id)
    this.bundler = SdfApp.getFromContext(this, SdfBundlerTypeScript) as SdfBundlerTypeScript
    this.app = SdfApp.getAppFromContext(this)
    this.prefix = config.prefix ?? id

    this.stageName = config.stageName || "$default"

    // define directories
    this.entryPointsDirectory = join(this.bundler.entryPointsDir, this.prefix)
    this.validatorsDirectory = join(this.entryPointsDirectory, "validators")
    this.handlersDirectory = this.bundler.registerDirectory(this.prefix)
    this.documentOutputPath = join(this.entryPointsDirectory, "openapi.json")

    // clone the document, since document will be mutated in further operations
    this.document = JSON.parse(JSON.stringify(this.config.document)) as Document<OperationType>
    this.operationParser = new OperationParser<OperationType>(this.document)

    // define API GW integration role
    this.integrationRole = new IamRole(this, "integration-role", {
      name: this.app._concatName(this.bundler.node.id, this.id, `integration`),
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

    // map provided authorizers with security schemes from Document
    this.authorizers = this.parseAuthorizers()

    // define lambda functions
    this.operationParser.walkOperations(operation => this.defineLambda(operation))

    let apiGwBody = this.document

    if (config.stripSecurityScopes) {
      apiGwBody = JSON.parse(JSON.stringify(this.document))

      new OperationParser<OperationType>(apiGwBody).walkOperations(operation => {
        if (operation.operationSpec.security) {
          operation.operationSpec.security = operation.operationSpec.security.map(security =>
            Object.keys(security).reduce((acc, key) => ({ ...acc, [key]: [] }), {}),
          )
        }
      })
    }

    // define the AWS HTTP API
    const api = (this.apigw = new Apigatewayv2Api(this, "api", {
      name: this.document.info.title,
      version: this.document.info.version,
      protocolType: "HTTP",
      body: JSON.stringify(apiGwBody),
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

    return this
  }

  private parseAuthorizers(): typeof this.authorizers {
    return Object.entries(this.document.components?.securitySchemes || {}).reduce<typeof this.authorizers>(
      (acc, [name, securityScheme]) => {
        const trace = new DocumentTrace(this.document["x-sdf-spec-path"], ["components", "securitySchemes", name])

        if ("$ref" in securityScheme) {
          throw new Error(`$ref in securityScheme definition is not supported at ${trace}`)
        }

        const authorizer = this.config.authorizers?.[name]
        if (!authorizer) {
          throw new Error(`authorizer '${name}' is defined in the document, but not provided at ${trace}`)
        }

        if (
          securityScheme.type === "apiKey" &&
          securityScheme.in === "header" &&
          !(authorizer instanceof SdfHttpApiLambdaAuthorizer)
        ) {
          throw new Error(`lambda authorizer is required for 'apiKey' authorization at ${trace}`)
        } else if (securityScheme.type === "oauth2" && !(authorizer instanceof SdfHttpApiJwtAuthorizer)) {
          throw new Error(`jwt authorizer is required for 'apiKey' authorization at ${trace}`)
        }

        securityScheme["x-amazon-apigateway-authorizer"] = authorizer.spec(this)

        return {
          ...acc,
          [name]: authorizer,
        }
      },
      {},
    )
  }

  private getOperationAuthorizer(
    operationAuthorizer: ParsedOperationAuthorizer | undefined,
  ): SdfHttpApiAuthorizer | undefined {
    if (operationAuthorizer) {
      const authorizer = this.authorizers[operationAuthorizer.name]
      if (!authorizer) {
        throw new Error(`authorizer '${operationAuthorizer.name}' not found`)
      }
      return authorizer
    }
  }

  private defineLambda(operation: OperationBundle<OperationType, OpenAPIV3.SchemaObject | OpenAPIV3.ReferenceObject>) {
    const operationId = operation.operationId

    const lambda = new SdfLambda(this.bundler, `api-handler-${camelCase(operationId)}`, {
      timeout: 29,
      memorySize: 512,
      ...this.config.lambdaConfig,

      functionName: this.app._concatName(this.bundler.node.id, this.id, paramCase(operationId)),
      publish: true,
      bundler: () => this.renderLambdaHandler(operation),
      resources: {
        ...this.config.lambdaConfig?.resources,
        ...this.document["x-sdf-resources"],
        ...operation.operationSpec["x-sdf-resources"],
      },
    })

    this.lambdas[operationId] = lambda

    // add api gateway integration into the operation
    operation.operationSpec["x-amazon-apigateway-integration"] = {
      payloadFormatVersion: "2.0",
      type: "aws_proxy",
      httpMethod: "POST",
      uri: lambda.function.qualifiedInvokeArn,
      connectionType: "INTERNET",
      credentials: this.integrationRole.arn,
    }
  }

  private registerSchema(operation: ParsedOperation<OperationType>): string {
    const {
      operationId,
      request: {
        parameters: { path, query, cookie, header },
        body,
      },
      responses,
    } = operation

    const authorizer = this.getOperationAuthorizer(operation.authorizer)

    const buildRequestSchema = (body?: {
      contentType: string
      schema: OpenAPIV3.SchemaObject
    }): OpenAPIV3.SchemaObject => {
      const properties = Object.fromEntries(
        Object.entries({
          path,
          query,
          cookie,
          header,
          contentType: body
            ? ({
                type: "string",
                enum: [body.contentType],
                "x-no-ts-enum": true,
              } as OpenAPIV3.SchemaObject)
            : undefined,
          body: body?.schema,
          authorizer: authorizer ? authorizer.context() : undefined,
        }).filter((value): value is [string, OpenAPIV3.SchemaObject] => value[1] !== undefined),
      )

      return {
        type: "object",
        properties: properties,
        required: Object.keys(properties),
        additionalProperties: false,
      }
    }

    const operationTitle = pascalCase(`operation-${operationId}`)

    const operationSchema: OpenAPIV3.SchemaObject = {
      title: operationTitle,
      type: "object",
      properties: {
        request: {
          title: pascalCase(`operation-${operationId}-request`),
          oneOf: [
            ...(body?.schemas
              ? Object.entries(body.schemas).map(([contentType, schema]) => buildRequestSchema({ contentType, schema }))
              : []),
            ...(body?.required ? [] : [buildRequestSchema()]),
          ],
        },
        responses: {
          title: pascalCase(`operation-${operationId}-responses`),
          oneOf: responses,
        },
      },
      required: ["request", "responses"],
      additionalProperties: false,
    }

    this.bundler.registerSchema(operationSchema)

    return operationTitle
  }

  private async renderLambdaHandler({
    pathPattern,
    method,
  }: OperationBundle<
    OperationType,
    OpenAPIV3.SchemaObject | OpenAPIV3.ReferenceObject
  >): Promise<SdfBundlerTypeScriptHandler> {
    // get dereferenced version of the operation
    const operation = await this.operationParser.parseOperation(pathPattern, method)
    const operationTitle = this.registerSchema(operation)

    // render lambda function entry point, handler and validator
    const entryPointPath = await this.renderLambdaFiles(operation, operationTitle)
    const entryPointRelPath = relative(this.bundler.bundleDir, entryPointPath)

    return {
      handler: `${entryPointRelPath}.${entryPointFunctionName}`,
      entryPoint: `${entryPointRelPath}.ts`,
    }
  }

  private createValidtors(operation: ParsedOperation<OperationType>): { ajv: Ajv; schemas: Array<Schema> } {
    const schemas = this.operationParser.createValidtorSchemas(operation)

    if (operation.authorizer) {
      const authorizer = this.authorizers[operation.authorizer.name]
      if (!authorizer) {
        throw new Error(
          `cannot find authorier '${operation.authorizer.name}' defined at ${operation.bundle.operationTrace.append(
            "security",
          )}`,
        )
      }
      schemas.push({
        $id: "authorizer",
        ...authorizer.context(),
      })
    }

    const ajv = new Ajv({
      code: { source: true, esm: true },
      strict: false,
      allErrors: true,
      schemas: schemas,
    })

    return { ajv, schemas }
  }

  private async renderValidator(operation: ParsedOperation<OperationType>): Promise<string> {
    const { operationId } = operation
    const { ajv, schemas } = this.createValidtors(operation)

    const moduleCode = standaloneCode(ajv)

    const validatorPath = join(this.validatorsDirectory, `${operationId}.validator`)

    await writeFile(`${validatorPath}.js`, moduleCode)

    await writeMustacheTemplate({
      template: validatorTemplate,
      path: `${validatorPath}.d.ts`,
      context: {
        Validators: schemas,
      },
      overwrite: true,
    })

    return validatorPath
  }

  private async renderLambdaFiles(operation: ParsedOperation<OperationType>, operationTitle: string): Promise<string> {
    const { operationId } = operation

    const validatorPath = await this.renderValidator(operation)

    const handlerPath = join(this.handlersDirectory, operationId)
    const entryPointPath = join(this.entryPointsDirectory, operationId)

    await writeMustacheTemplate({
      template: entryPointTemplate,
      path: `${entryPointPath}.ts`,
      overwrite: true,
      context: {
        PathPatternString: JSON.stringify(operation.bundle.pathPattern),
        MethodString: JSON.stringify(operation.bundle.method),
        DocumentImport: relative(dirname(entryPointPath), this.documentOutputPath),
        OperationModel: operationTitle,
        InterfacesImport: relative(dirname(entryPointPath), this.bundler._interfacesAbsPath),
        HandlerImport: relative(dirname(entryPointPath), handlerPath),
        ValidatorsImport: relative(dirname(entryPointPath), validatorPath),
        EntryPointFunctionName: entryPointFunctionName,
        RequestInterceptor:
          this.config.requestInterceptor === undefined
            ? undefined
            : relative(dirname(entryPointPath), join(this.bundler.bundleDir, this.config.requestInterceptor)),
        ResponseInterceptor:
          this.config.responseInterceptor === undefined
            ? undefined
            : relative(dirname(entryPointPath), join(this.bundler.bundleDir, this.config.responseInterceptor)),
      },
    })

    await writeMustacheTemplate({
      template: handlerTemplate,
      path: `${handlerPath}.ts`,
      overwrite: false,
      context: {
        WrapperImport: relative(dirname(handlerPath), entryPointPath),
        HandlerBody: this.config.handlerBody || "{}",
      },
    })

    return entryPointPath
  }

  public async _preSynth() {
    // write the OpenAPI document
    await writeFile(this.documentOutputPath, JSON.stringify(this.config.document, null, 2))
  }
}
