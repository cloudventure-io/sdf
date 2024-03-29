import Ajv, { SchemaObject } from "ajv"
import standaloneCode from "ajv/dist/standalone"
import { TerraformStack } from "cdktf"
import { camelCase, constantCase, pascalCase } from "change-case"
import { Construct } from "constructs"
import { mkdir, rm } from "fs/promises"
import { compile } from "json-schema-to-typescript"
import { OpenAPIV3 } from "openapi-types"
import { dirname, join, relative } from "path"

import { App, AppLifeCycle } from "../../core/App"
import { Resource } from "../../core/Resource"
import { AsyncResolvable } from "../../core/resolvable/AsyncResolvable"
import { HttpApi } from "../../http-api"
import { HttpApiLambdaAuthorizer } from "../../http-api/authorizer"
import { OperationSchema } from "../../http-api/core/DocumentSchemaAdapter"
import { HttpStatusCodes } from "../../http-api/enum"
import { SchemaItem } from "../../http-api/openapi/SchemaItem"
import { LambdaConfig, LambdaEntryPoint } from "../../lambda"
import { writeFile } from "../../utils/writeFile"
import { writeMustacheTemplate } from "../../utils/writeMustacheTemplate"
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

  /** The path of the entry points directory */
  private entryPointsDir: string

  /** The path of the interfaces file (without ext.) */
  private interfacesPath: string

  /** The path of the resources files (without ext.) */
  private resourcesPath: string

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

    this.srcDir = config.path
    this.bundleDir = config.prefix === undefined ? this.srcDir : join(this.srcDir, config.prefix)
    this.genDir = join(this.bundleDir, ".gen")
    this.buildDir = join(this.app.workdir, "build", this.stack.node.id, bundler.node.id)
    this.entryPointsDir = join(this.genDir, "entrypoints")

    this.interfacesPath = join(this.genDir, "interfaces")
    this.resourcesPath = join(this.genDir, "resources")

    new AsyncResolvable(this, "reset-dirs", () => this.resetDirs())
  }

  // directory management
  private async resetDirs() {
    await rm(this.genDir, { recursive: true, force: true })
    await mkdir(this.genDir, { recursive: true })
  }

  // resource management
  private async renderResources(resources: Record<string, Resource>) {
    const resourcesPath = `${this.resourcesPath}.ts`
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

      await writeMustacheTemplate({
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

    await writeFile(`${this.interfacesPath}.ts`, interfaces)

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

  // HTTP API
  private httpApiHandlersDirectory(httpApi: HttpApi): string {
    return join(this.bundleDir, httpApi.prefix)
  }

  private httpApiEntryPointsDirectory(httpApi: HttpApi): string {
    return join(this.entryPointsDir, httpApi.prefix)
  }

  private httpApiSpecPath(httpApi: HttpApi): string {
    return join(this.httpApiEntryPointsDirectory(httpApi), "openapi.json")
  }

  private httpApiValidatorsDirectory(httpApi: HttpApi): string {
    return join(this.httpApiEntryPointsDirectory(httpApi), "validators")
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

    const validatorPath = join(this.httpApiValidatorsDirectory(httpApi), `${operationId}.validator`)

    await writeFile(`${validatorPath}.js`, moduleCode)

    await writeMustacheTemplate({
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

    const handlersDirectory = this.httpApiHandlersDirectory(httpApi)
    const entryPointsDirectory = this.httpApiEntryPointsDirectory(httpApi)

    const handlerPath = join(handlersDirectory, operationId)
    const entryPointPath = join(entryPointsDirectory, operationId)

    new AsyncResolvable(
      this,
      `http-api-handler-${operationId}`,
      async () => {
        const validatorPath = await this.renderValidator(httpApi, op)

        await writeMustacheTemplate({
          template: templates.httpApiHandlerEntryPoint,
          path: `${entryPointPath}.ts`,
          overwrite: true,
          context: {
            PathPatternString: JSON.stringify(operation.path.pattern),
            MethodString: JSON.stringify(operation.method),
            DocumentImport: relative(dirname(entryPointPath), this.httpApiSpecPath(httpApi)),
            OperationModel: schemas.title,
            InterfacesImport: relative(dirname(entryPointPath), this.interfacesPath),
            HandlerImport: relative(dirname(entryPointPath), handlerPath),
            ValidatorsImport: relative(dirname(entryPointPath), validatorPath),
            EntryPointFunctionName: entryPointFunctionName,
            RequestInterceptor:
              httpApi.config.requestInterceptor === undefined
                ? undefined
                : relative(dirname(entryPointPath), join(this.bundleDir, httpApi.config.requestInterceptor)),
            ResponseInterceptor:
              httpApi.config.responseInterceptor === undefined
                ? undefined
                : relative(dirname(entryPointPath), join(this.bundleDir, httpApi.config.responseInterceptor)),
          },
        })

        await writeMustacheTemplate({
          template: templates.httpApiHandler,
          path: `${handlerPath}.ts`,
          overwrite: false,
          context: {
            WrapperImport: relative(dirname(handlerPath), entryPointPath),
            HandlerBody: httpApi.config.handlerBody || "{}",
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
      PathPatternEscaped: string
      Method: string
      SuccessCodesList: string
      SuccessCodesUnion: string
      Description?: string
    }

    const operations: Array<TplOp> = []

    Object.values(httpApi.schemaAdapter.operations).forEach(({ operation, schemas }) => {
      const successCodes: Array<number> =
        (operation.data["x-sdf-success-codes"] as Array<number>) ??
        Object.keys(operation.responses)
          .map(parseInt)
          .filter(statusCode => statusCode < HttpStatusCodes.BadRequest)

      const isOperationEmpty = Object.values({ ...schemas.requestExpanded, authorizer: undefined }).every(
        schema => !schema,
      )

      operations.push({
        OperationName: camelCase(operation.operationId),
        OperationModel: pascalCase(`operation-${operation.operationId}`),
        IsOperationEmpty: isOperationEmpty,
        Method: operation.method.toUpperCase(),
        PathPatternEscaped: JSON.stringify(operation.path.pattern),
        SuccessCodesList: successCodes.join(", "),
        SuccessCodesUnion: successCodes.join(" | "),
        Description: operation.description?.replace(/\*\//g, "* /"), // break closing comments
      })
    })

    const className = pascalCase(`base-${httpApi.config.generateClient?.name}-client`)
    const clientClassPath = join(this.genDir, "client", className)

    await writeMustacheTemplate({
      template: templates.httpApiClient,
      path: `${clientClassPath}.ts`,
      context: {
        ClassName: className,
        Operations: operations,
        InterfacesImport: relative(dirname(clientClassPath), this.interfacesPath),
      },
      overwrite: true,
    })
  }

  public generateHttpApiSpecification(httpApi: HttpApi): void {
    const documentPromise = httpApi.schemaAdapter.bundle()

    new AsyncResolvable(this, "api-spec", async () => {
      await writeFile(this.httpApiSpecPath(httpApi), JSON.stringify(await documentPromise, null, 2))
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
    return join(this.entryPointsDir, authorizer.prefix)
  }

  private httpApiAuthorizerHandlersDirectory(authorizer: HttpApiLambdaAuthorizer): string {
    return join(this.bundleDir, authorizer.prefix)
  }

  public async generateHttpApiAuthorizer(authorizer: HttpApiLambdaAuthorizer): Promise<LambdaEntryPoint> {
    const authorizerDirectory = this.httpApiAuthorizerHandlersDirectory(authorizer)
    const entryPointsDirectory = this.httpApiAuthorizerEntryPointDirectory(authorizer)

    const handlerPath = join(authorizerDirectory, authorizer.id)
    const entryPointPath = join(entryPointsDirectory, authorizer.id)

    await writeMustacheTemplate({
      template: templates.httpApiAuthorizerEntryPoint,
      path: `${entryPointPath}.ts`,
      overwrite: true,
      context: {
        AuthorizerModel: authorizer.config.contextSchema.title,
        InterfacesImport: relative(entryPointsDirectory, this.interfacesPath),
        HandlerImport: relative(entryPointsDirectory, handlerPath),
        EntryPointFunctionName: entryPointFunctionName,
      },
    })

    await writeMustacheTemplate({
      template: templates.httpApiAuthorizerHandler,
      path: `${handlerPath}.ts`,
      overwrite: false,
      context: {
        WrapperImport: relative(authorizerDirectory, entryPointPath),
        AuthorizerBody: authorizer.config.authorizerBody || "{}",
      },
    })

    const entryPointRelPath = relative(this.bundleDir, entryPointPath)

    return [entryPointRelPath, entryPointFunctionName]
  }
}
