import Ajv, { SchemaObject } from "ajv"
import standaloneCode from "ajv/dist/standalone"
import { TerraformStack } from "cdktf"
import { camelCase, constantCase, pascalCase } from "change-case"
import { Construct } from "constructs"
import { mkdir, rm } from "fs/promises"
import { JSONSchemaFaker } from "json-schema-faker"
import { compile } from "json-schema-to-typescript"
import { OpenAPIV3 } from "openapi-types"
import { dirname, join, relative } from "path"

import { App, AppLifeCycle } from "../../core/App"
import { Resource } from "../../core/Resource"
import { AsyncResolvable } from "../../core/resolvable/AsyncResolvable"
import { HttpApi } from "../../http-api"
import { HttpApiLambdaAuthorizer } from "../../http-api/authorizer"
import { HttpStatusCodesNames } from "../../http-api/common/HttpStatusCodes"
import { OperationSchema } from "../../http-api/core/DocumentSchemaAdapter"
import { SchemaItem } from "../../http-api/openapi/SchemaItem"
import { ApiResponseByMediaType, DefaultMediaType, EmptyResponse } from "../../http-api/runtime/common/ApiResponse"
import { LambdaConfig, LambdaEntryPoint } from "../../lambda"
import { writeFile } from "../../utils/writeFile"
import { writeHbsTemplate } from "../../utils/writeHbsTemplate"
import { Bundler } from "../Bundler"
import { BundlerLanguage } from "./BundlerLanguage"
import * as templates from "./typescript/Templates"

const entryPointFunctionName = "entrypoint"

export type BundlerLanguageTypeScriptManifest = {
  /** The node id of the bundler */
  id: string

  /** The name of the language */
  language: "typescript"

  /** The path of the source dir relative to `App.outdir` */
  srcDir: string

  /** The path of the bundle dir relative to `App.outdir` */
  bundleDir: string

  /** The path of build output dir relative to the `App.outdir` */
  buildDir: string

  /** List of entryPoints. Paths are relative to `bundleDir` */
  entryPoints: Array<string>
}

export interface BundlerLanguageTypeScriptConfig {
  /** The absolute path of the bundle.*/
  path: string

  prefix?: string

  zod?: boolean
}

export class BundlerLanguageTypeScript extends Construct implements BundlerLanguage {
  public readonly language = "typescript"

  /** The app this bundler belongs to */
  private app: App

  /** The stack this bundler belongs to */
  private stack: TerraformStack

  /** The path of the source code root directory */
  private srcDir: string

  public bundleDir: string

  /** The path of the generated files directory */
  private genDir: string

  /** The path of the build output directory */
  public readonly buildDir: string

  /** The path of the HTTP API directory */
  private httpApiHandlersDirectory(httpApi: HttpApi): string {
    return join(this.bundleDir, httpApi.prefix)
  }

  /** The path of the HTTP API directory */
  private httpApiHandlerPath(httpApi: HttpApi, operationId: string): string {
    return join(this.httpApiHandlersDirectory(httpApi), operationId)
  }

  /** The path of the HTTP API directory */
  private httpApiDir(httpApi: HttpApi): string {
    return join(this.genDir, httpApi.prefix)
  }

  /** The path of the OpenAPI document */
  private httpApiSpecPath(httpApi: HttpApi): string {
    return join(this.httpApiDir(httpApi), "openapi.json")
  }

  private httpApiDocumentPath(httpApi: HttpApi): string {
    return join(this.httpApiDir(httpApi), "document")
  }

  /** The path of the operations directory */
  private httpApiOperationsDir(httpApi: HttpApi): string {
    return join(this.httpApiDir(httpApi), "operations")
  }

  /** The path of the operation file */
  private httpApiOperationPath(httpApi: HttpApi, operationId: string): string {
    return join(this.httpApiOperationsDir(httpApi), operationId)
  }

  /** The path of the validators directory */
  private httpApiValidatorsDirectory(httpApi: HttpApi): string {
    return join(this.httpApiDir(httpApi), "validators")
  }

  private httpApiValidatorPath(httpApi: HttpApi, operationId: string): string {
    return join(this.httpApiValidatorsDirectory(httpApi), `${operationId}.validator`)
  }

  /** The path of the entry points directory */
  private httpApiEntryPointsDir(httpApi: HttpApi): string {
    return join(this.genDir, ".entrypoints", httpApi.prefix)
  }

  private httpApiEntryPointPath(httpApi: HttpApi, operationId: string): string {
    return join(this.httpApiEntryPointsDir(httpApi), operationId)
  }

  private httpApiClientClassPath(httpApi: HttpApi, className: string): string {
    return join(this.httpApiDir(httpApi), className)
  }

  /** The path of the interfaces file (without ext.) */
  private interfacesPath(): string {
    return join(this.genDir, "interfaces")
  }

  /** The path of the resources files (without ext.) */
  private resourcesPath(): string {
    return join(this.genDir, "resources")
  }

  private importPath(from: string, module: string): string {
    return relative(dirname(from), module)
  }

  /** generated entry points */
  private entryPoints: Set<string> = new Set<string>()

  public get lambdaConfigCustomization(): Partial<LambdaConfig> {
    return {
      runtime: "nodejs18.x",

      environment: {
        variables: {
          NODE_OPTIONS: "--enable-source-maps",
        },
      },
    }
  }

  constructor(
    bundler: Bundler,
    id: string,
    private config: BundlerLanguageTypeScriptConfig,
  ) {
    super(bundler, id)

    this.app = App.getAppFromContext(this)
    this.stack = this.app.getStack(this)

    this.buildDir = join(this.app.workdir, "build", this.stack.node.id, bundler.node.id)

    this.srcDir = config.path
    this.bundleDir = config.prefix === undefined ? this.srcDir : join(this.srcDir, config.prefix)

    this.genDir = join(this.bundleDir, ".gen")

    new AsyncResolvable(this, "reset-dirs", () => this.resetDirs())
  }

  // directory management
  private async resetDirs() {
    await rm(this.genDir, { recursive: true, force: true })
    await mkdir(this.genDir, { recursive: true })
  }

  // resource management
  private async renderResources(resources: Record<string, Resource>) {
    const resourcesPath = `${this.resourcesPath()}.ts`
    await rm(resourcesPath, { force: true })

    if (Object.keys(resources).length) {
      const resourceSchemasMap: { [name in string]: OpenAPIV3.SchemaObject } = {}
      Object.entries(resources).map(([id, resource]) => {
        const title = `${pascalCase(id)}Config`

        resourceSchemasMap[title] = {
          ...resource.configSpec,
          title,
        }
      })

      const resourceInterfaces = await compile(
        {
          type: "object",
          properties: resourceSchemasMap,
          additionalProperties: false,
        },
        "_",
        {
          declareExternallyReferenced: true,
          $refOptions: {
            continueOnError: false,
          },
          enableConstEnums: false,
        },
      )

      await writeHbsTemplate({
        path: resourcesPath,
        template: templates.resources,
        overwrite: true,
        context: {
          interfaces: resourceInterfaces,
          resources: Object.keys(resources).map(id => ({
            type: `${pascalCase(id)}Config`,
            envName: constantCase(`RESOURCE_${id}`),
            id,
          })),
        },
      })
    }
  }

  // schema management
  private async renderSchemas(schemas: Record<string, OpenAPIV3.SchemaObject>) {
    const rootSchema: OpenAPIV3.SchemaObject = {
      type: "object",
      properties: schemas,
      additionalProperties: false,
    }

    const interfaces = await compile(rootSchema, "_", {
      strictIndexSignatures: true,
      declareExternallyReferenced: true,
      $refOptions: {
        continueOnError: false,
      },
      enableConstEnums: false,
    })

    await writeFile(`${this.interfacesPath()}.ts`, interfaces)

    if (this.config.zod) {
      const { jsonSchemaToZod } = await import("json-schema-to-zod").catch(err => {
        console.error("please install json-schema-to-zod for zod generation support")
        return Promise.reject(err)
      })

      const module = jsonSchemaToZod(rootSchema, { module: "esm" })

      await writeFile(`${join(this.genDir, "zod.ts")}`, module)
    }
  }

  public async generate({ schemas, resources }) {
    await this.renderSchemas(schemas)
    await this.renderResources(resources)
  }

  /** Generates the handler for the given HTTP API operation and returns the validator path. */
  private async renderValidator<SchemaType>(httpApi: HttpApi, op: OperationSchema<SchemaType>): Promise<string> {
    const { operation } = op
    const { operationId } = operation

    const schemas = Object.entries(op.schemas.requestExpanded)
      .filter((e): e is [string, SchemaItem] => e[1])
      .map<SchemaObject>(([key, schema]) => ({
        $id: key,
        ...schema.value,
      }))

    const ajv = new Ajv({
      code: { source: true, esm: true },
      strict: false,
      allErrors: true,
      schemas,
    })

    const moduleCode = standaloneCode(ajv)

    const validatorPath = this.httpApiValidatorPath(httpApi, operationId)

    await writeFile(`${validatorPath}.js`, moduleCode)

    await writeHbsTemplate({
      template: templates.httpApiHandlerValidator,
      path: `${validatorPath}.d.ts`,
      context: {
        Validators: schemas,
      },
      overwrite: true,
    })

    return validatorPath
  }

  /**
   * Generates the handler for the given HTTP API operation
   * and returns the handler name.
   */
  public generateHttpApiHandler<SchemaType>(httpApi: HttpApi, op: OperationSchema<SchemaType>): LambdaEntryPoint {
    const { operation, schemas } = op
    const { operationId } = operation

    const operationPath = this.httpApiOperationPath(httpApi, operationId)
    const handlerPath = this.httpApiHandlerPath(httpApi, operationId)
    const entryPointPath = this.httpApiEntryPointPath(httpApi, operationId)

    new AsyncResolvable(
      this,
      `http-api-handler-${operationId}`,
      async () => {
        const responses = Object.fromEntries(
          Object.entries(operation.responses)
            .map(
              ([s, response]): Array<
                [string, { class: string; statusCode: number; isSuccess: boolean; mediaType?: string }]
              > => {
                const statusCode = parseInt(s)
                const isSuccess = operation.successCodes.includes(statusCode)

                // When no content is defined and empty response is expected
                if (!response.content || !Object.keys(response.content).length) {
                  return [[s, { class: EmptyResponse.name, statusCode, isSuccess }]]
                }

                return Object.keys(response.content).map(
                  (
                    mediaType,
                  ): [string, { class: string; statusCode: number; isSuccess: boolean; mediaType?: string }] => {
                    return [
                      `${statusCode}-${mediaType}`,
                      {
                        class:
                          mediaType in ApiResponseByMediaType
                            ? ApiResponseByMediaType[mediaType].name
                            : ApiResponseByMediaType[DefaultMediaType],
                        statusCode,
                        isSuccess,
                        mediaType,
                      },
                    ]
                  },
                )
              },
            )
            .flat(),
        )

        await writeHbsTemplate({
          template: templates.httpApiOperation,
          path: `${operationPath}.ts`,
          overwrite: true,
          context: {
            OperationModel: schemas.title,
            InterfacesImport: this.importPath(entryPointPath, this.interfacesPath()),
            DocumentImport: this.importPath(entryPointPath, this.httpApiDocumentPath(httpApi)),
            Responses: Object.values(responses),
            PathPatternString: JSON.stringify(operation.path.pattern),
            MethodString: JSON.stringify(operation.method),
          },
        })

        const validatorPath = await this.renderValidator(httpApi, op)

        await writeHbsTemplate({
          template: templates.httpApiHandlerEntryPoint,
          path: `${entryPointPath}.ts`,
          overwrite: true,
          context: {
            ValidatorsImport: this.importPath(entryPointPath, validatorPath),
            HandlerImport: this.importPath(entryPointPath, handlerPath),
            DocumentImport: this.importPath(entryPointPath, this.httpApiDocumentPath(httpApi)),
            OperationImport: this.importPath(entryPointPath, operationPath),
            OperationId: operationId,
            EntryPointFunctionName: entryPointFunctionName,
            MiddlewareImport:
              httpApi.config.middleware &&
              this.importPath(entryPointPath, join(this.srcDir, httpApi.config.middleware)),
          },
        })

        const opDefaultResponse = operation.defaultResponse()
        const opDefaultMediaType = opDefaultResponse.defaultMediaType()

        const handlerStatusCode = operation.gen?.statusCode || opDefaultResponse.statusCode
        const handlerMediaType = operation.gen?.content.mediaType || opDefaultMediaType?.mediaType

        const defaultResponse = responses[`${handlerStatusCode}${handlerMediaType ? `-${handlerMediaType}` : ""}`]

        if (!defaultResponse) {
          throw new Error(`No default response found for operation ${operationId}`)
        }

        const handlerBody =
          operation.gen?.content.body ||
          JSON.stringify(
            opDefaultMediaType?.schema?.value && JSONSchemaFaker.generate(opDefaultMediaType?.schema?.value),
          )

        await writeHbsTemplate({
          template: templates.httpApiHandler,
          path: `${handlerPath}.ts`,
          overwrite: false,
          context: {
            WrapperImport: relative(dirname(handlerPath), entryPointPath),
            HandlerBody: {
              class: defaultResponse.class,
              statusCode: handlerStatusCode,
              statusCodeName: HttpStatusCodesNames[handlerStatusCode],
              body: handlerBody,
            },
          },
        })
      },
      AppLifeCycle.generation,
    )

    const entryPointRelPath = relative(this.bundleDir, entryPointPath)

    return [entryPointRelPath, entryPointFunctionName]
  }

  async generateHttpApiClient(httpApi: HttpApi): Promise<void> {
    interface TplOp {
      OperationName: string
      OperationModel: string
      IsOperationEmpty: boolean
      IsSingleRequestBody: boolean
      PathPatternEscaped: string
      Method: string
      Description?: string
      OperationId: string
      OperationImport: string
    }

    const className = pascalCase(`base-${httpApi.config.generateClient?.name}-client`)
    const clientClassPath = this.httpApiClientClassPath(httpApi, className)

    const documentPath = this.httpApiSpecPath(httpApi)

    const operations: Array<TplOp> = []

    Object.values(httpApi.schemaAdapter.operations).forEach(({ operation, schemas }) => {
      const isOperationEmpty = Object.values({ ...schemas.requestExpanded, authorizer: undefined }).every(
        schema => !schema,
      )
      const isSingleRequestBody = Object.keys(operation.requestBody?.content || {}).length === 1

      operations.push({
        OperationName: camelCase(operation.operationId),
        OperationModel: pascalCase(`operation-${operation.operationId}`),
        IsOperationEmpty: isOperationEmpty,
        IsSingleRequestBody: isSingleRequestBody,
        Method: operation.method.toUpperCase(),
        PathPatternEscaped: JSON.stringify(operation.path.pattern),
        Description: operation.description?.replace(/\*\//g, "* /"), // break closing comments
        OperationId: operation.operationId,
        OperationImport: this.importPath(clientClassPath, this.httpApiOperationPath(httpApi, operation.operationId)),
      })
    })

    await writeHbsTemplate({
      template: templates.httpApiClient,
      path: `${clientClassPath}.ts`,
      context: {
        ClassName: className,
        Operations: operations,
        InterfacesImport: this.importPath(clientClassPath, this.interfacesPath()),
        DocumentImport: this.importPath(clientClassPath, documentPath),
      },
      overwrite: true,
    })
  }

  public generateHttpApiDocument(httpApi: HttpApi): void {
    const documentPromise = httpApi.schemaAdapter.bundle()

    new AsyncResolvable(this, "api-spec", async () => {
      await writeFile(this.httpApiSpecPath(httpApi), JSON.stringify(await documentPromise, null, 2))
      await writeHbsTemplate({
        template: templates.httpApiDocument,
        path: `${this.httpApiDocumentPath(httpApi)}.ts`,
        overwrite: true,
      })
    })
  }

  public manifest(): BundlerLanguageTypeScriptManifest {
    return {
      id: this.node.id,
      language: this.language,
      srcDir: relative(this.app.workdir, this.srcDir),
      bundleDir: relative(this.app.workdir, this.bundleDir),
      buildDir: relative(this.app.workdir, this.buildDir),
      entryPoints: Array.from(this.entryPoints),
    }
  }

  public registerEntryPoint(handler: LambdaEntryPoint): string {
    this.entryPoints.add(`${handler[0]}.ts`)
    return handler.join(".")
  }

  private httpApiAuthorizerEntryPointDirectory(authorizer: HttpApiLambdaAuthorizer): string {
    return join(this.genDir, ".entrypoints", authorizer.prefix)
  }

  private httpApiAuthorizerEntryPointPath(authorizer: HttpApiLambdaAuthorizer): string {
    return join(this.httpApiAuthorizerEntryPointDirectory(authorizer), authorizer.id)
  }

  private httpApiAuthorizerHandlersDirectory(authorizer: HttpApiLambdaAuthorizer): string {
    return join(this.bundleDir, authorizer.prefix)
  }

  private httpApiAuthorizerHandlerPath(authorizer: HttpApiLambdaAuthorizer): string {
    return join(this.httpApiAuthorizerHandlersDirectory(authorizer), authorizer.id)
  }

  public async generateHttpApiAuthorizer(authorizer: HttpApiLambdaAuthorizer): Promise<LambdaEntryPoint> {
    const handlerPath = this.httpApiAuthorizerHandlerPath(authorizer)
    const entryPointPath = this.httpApiAuthorizerEntryPointPath(authorizer)

    await writeHbsTemplate({
      template: templates.httpApiAuthorizerEntryPoint,
      path: `${entryPointPath}.ts`,
      overwrite: true,
      context: {
        AuthorizerModel: authorizer.config.contextSchema.title,
        InterfacesImport: this.importPath(entryPointPath, this.interfacesPath()),
        HandlerImport: this.importPath(entryPointPath, handlerPath),
        EntryPointFunctionName: entryPointFunctionName,
      },
    })

    await writeHbsTemplate({
      template: templates.httpApiAuthorizerHandler,
      path: `${handlerPath}.ts`,
      overwrite: false,
      context: {
        WrapperImport: this.importPath(handlerPath, entryPointPath),
        AuthorizerBody: authorizer.config.authorizerBody || "{}",
      },
    })

    const entryPointRelPath = relative(this.bundleDir, entryPointPath)

    return [entryPointRelPath, entryPointFunctionName]
  }
}
