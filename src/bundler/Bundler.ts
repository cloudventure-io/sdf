import { DataArchiveFile } from "@cdktf/provider-archive/lib/data-archive-file"
import { S3Object } from "@cdktf/provider-aws/lib/s3-object"
import { Resource } from "@cdktf/provider-null/lib/resource"
import { Fn, TerraformStack, Token } from "cdktf"
import { Construct } from "constructs"
import { join, relative } from "path"

import { App, AppLifeCycle } from "../core/App"
import { Module, TerraformProviders, TerraformVariables } from "../core/Module"
import { SchemaRegistry } from "../core/SchemaRegistry"
import { AsyncResolvable } from "../core/resolvable/AsyncResolvable"
import { HttpApi } from "../http-api"
import { HttpApiLambdaAuthorizer } from "../http-api/authorizer"
import { OperationSchema } from "../http-api/core/DocumentSchemaAdapter"
import { Lambda, LambdaConfig, LambdaConfigCore, LambdaEntryPoint } from "../lambda/Lambda"
import { BundlerLanguage } from "./language/BundlerLanguage"
import { BundlerLanguageCustom } from "./language/BundlerLanguageCustom"
import { BundlerLanguageTypeScript } from "./language/BundlerLanguageTypeScript"

export interface BundlerConfigTypeScript {
  language: "typescript"

  /**
   * The absolute path of the bundle. This path usually contains a package.json file.
   */
  path: string

  /**
   * If specified generated files will be stored relative to this prefix.
   */
  prefix?: string

  /**
   * Typescript specific configurations.
   */
  typescript?: {
    /** if true the zod schemas file will be generated */
    zod?: boolean
  }
}

export interface BundlerConfigLanguageContainer {
  /** the language of the bundler */
  language: "container"
}

export interface BundlerConfigCustom {
  /** the language of the bundler */
  language: "custom"
}

export interface BundlerConfigNone {
  /** the language of the bundler */
  bundle: "none"
}

export interface BundlerConfigDirect {
  /** the direct bundle method */
  bundle: "direct"

  /**
   * If language if typescript, this is the path of the source code.
   * If language is custom, this is the path of the directory that will be deployed to the lambda.
   * */
  path: string
}

export type VariableRef<Variables, T> = (variables: Variables) => T

export interface BundlerConfigS3<Variables extends TerraformVariables = TerraformVariables> {
  /** the s3 bundle method */
  bundle: "s3"

  /** the s3 bucket */
  s3Bucket: string | VariableRef<Variables, string>

  /** the s3 prefix */
  s3Prefix?: string | VariableRef<Variables, string>

  /**
   * If language if typescript, this is the path of the source code.
   * If language is custom, this is the path of the directory that will be deployed to the lambda.
   * */
  path: string
}

export interface BundlerConfigContainer<Variables extends TerraformVariables = TerraformVariables> {
  /** the container bundle method */
  bundle: "container"

  /** The image URI */
  imageUri: string | VariableRef<Variables, string>

  /** The default image config for the Lambda Function */
  imageConfig?: BundlerContainerImageConfig<Variables>
}

export interface BundlerContainerImageConfig<Variables extends TerraformVariables = TerraformVariables> {
  /** The command that is passed to the container */
  command?: Array<string> | VariableRef<Variables, Array<string>>

  /** the entrypoint that is passed to the container */
  entryPoint?: Array<string>

  /** The working directory for the container */
  workingWirectory?: string
}

export type BundlerConfig<
  Variables extends TerraformVariables = TerraformVariables,
  Providers extends TerraformProviders = TerraformProviders,
> = ((BundlerConfigTypeScript | BundlerConfigCustom | BundlerConfigLanguageContainer) &
  (BundlerConfigDirect | BundlerConfigS3<Variables> | BundlerConfigContainer<Variables> | BundlerConfigNone)) & {
  /** the language of the bundler */
  language: "typescript" | "custom" | "container"

  /** the bundle method */
  bundle: "direct" | "s3" | "container" | "none"

  /** external variables */
  variables?: Variables
  providers?: Providers
}

export type BundleManifest = Omit<BundlerConfig, "variables" | "providers"> & {
  /** The id of the bundle */
  id: string
}

export class Bundler<
  Variables extends TerraformVariables = TerraformVariables,
  Providers extends TerraformProviders = TerraformProviders,
> extends Module<Variables, Providers> {
  private app: App
  private stack: TerraformStack

  private language: BundlerLanguage

  public readonly lambdaConfigCustomization: Partial<LambdaConfigCore> = {}

  public readonly schemaRegistry: SchemaRegistry = new SchemaRegistry()

  private config: BundlerConfig<Variables>

  constructor(scope: Construct, id: string, { variables, providers, ...config }: BundlerConfig<Variables, Providers>) {
    super(scope, id, { variables, providers }, (self: Construct) => {
      self.node.setContext(Bundler.name, self)
      self.node.setContext(self.constructor.name, self)
    })

    this.config = config

    this.app = App.getAppFromContext(this)
    this.stack = this.app.getStack(this)

    if (config.language === "typescript") {
      this.language = new BundlerLanguageTypeScript(this, "typescript", {
        path: config.path,
        prefix: config.prefix,
        zod: config.typescript?.zod,
      })
    } else if (config.language === "container") {
      this.language = new BundlerLanguageCustom(this, "container", {
        generateHttpApiHandler(httpApi, operation) {
          return [httpApi.id, operation.operation.operationId]
        },
        async generateHttpApiAuthorizer(authorizer) {
          return authorizer.id
        },
      })
    } else {
      this.language = new BundlerLanguageCustom(this, "custom", {
        path: config.bundle === "direct" || config.bundle === "s3" ? config.path : undefined,
      })
    }

    const buildDir = this.language.buildDir

    new AsyncResolvable(
      this,
      "typescript-generate",
      async () =>
        await this.language.generate({
          schemas: this.schemaRegistry.schemas,
          resources: this.app.getResources(this),
        }),
      AppLifeCycle.generation,
    )

    if (buildDir && (config.bundle === "direct" || config.bundle === "s3")) {
      const codeArchive = new DataArchiveFile(this, "code-archive", {
        outputPath: `\${path.module}/${this.stack.node.id}-${this.node.id}.zip`,
        type: "zip",
        sourceDir: relative(join(this.app.outdir, "stacks", this.stack.node.id), buildDir),
      })

      if (config.bundle === "s3") {
        const key = `${config.s3Prefix ? `${config.s3Prefix}/` : ""}${this.stack.node.id}-${this.node.id}.zip`

        const s3Object = new S3Object(this, "code-s3", {
          bucket: this.resolveVariableRef(config.s3Bucket),
          key: key,
          source: codeArchive.outputPath,
          sourceHash: codeArchive.outputMd5,
          contentType: "application/zip",
        })

        const updateTrigger = new Resource(this, "code-update-trigger", {
          triggers: {
            hash: codeArchive.outputMd5,
            version: s3Object.versionId,
          },
        })

        this.lambdaConfigCustomization.s3Bucket = this.resolveVariableRef(config.s3Bucket)
        this.lambdaConfigCustomization.s3Key = s3Object.key
        this.lambdaConfigCustomization.s3ObjectVersion = Fn.lookupNested(updateTrigger.triggers, ["version"])
      } else {
        this.lambdaConfigCustomization.filename = codeArchive.outputPath
        this.lambdaConfigCustomization.sourceCodeHash = codeArchive.outputBase64Sha256
      }
    } else if (config.bundle === "container") {
      this.lambdaConfigCustomization.packageType = "Image"
      this.lambdaConfigCustomization.imageUri = this.resolveVariableRef(config.imageUri)

      if (config.imageConfig && Object.keys(config.imageConfig).length > 0) {
        this.lambdaConfigCustomization.imageConfig = {
          command: config.imageConfig.command && this.resolveVariableRef(config.imageConfig.command),
          entryPoint: config.imageConfig.entryPoint,
          workingDirectory: config.imageConfig.workingWirectory,
        }
      }
    }
  }

  private resolveVariableRef<T extends string | Array<string>>(value: T | VariableRef<Variables, T>): T {
    if (typeof value === "function") {
      return value(this.variables)
    }
    return value as T
  }

  /** returns the manifest of the bundler */
  public manifest(): BundleManifest {
    return {
      id: this.node.id,
      ...this.config,
      ...this.language.manifest(),
    }
  }

  /**
   * lambdaConfig function is invoked by the Lambda construct
   * for getting bundling the lambda function configurations.
   **/
  public bundleLambdaConfig(lambda: Lambda, { entryPoint, ...lambdaConfig }: LambdaConfig): LambdaConfigCore {
    const bundlerConfig = this.config

    // merge configurations
    const result = [this.lambdaConfigCustomization, this.language.lambdaConfigCustomization].reduce<LambdaConfigCore>(
      (acc, config) => ({ ...config, ...acc }),
      { ...lambdaConfig },
    )

    // merge non-empty environment variables
    const envs = [this.language.lambdaConfigCustomization, this.lambdaConfigCustomization, lambdaConfig]
      .filter(
        (config): config is { environment: { variables: Record<string, string> } } =>
          !!(config && config.environment?.variables),
      )
      .map(config => config.environment?.variables)

    if (envs.length) {
      lambdaConfig.environment = {
        variables: Token.asStringMap(Fn.merge(envs)),
      }
    }

    // helper function for construcring the handler configuration
    const getHandlerConfig = (handler: string | [string, string] | undefined): Partial<LambdaConfigCore> => {
      if (!handler || bundlerConfig.bundle === "none") {
        // if there is no handler and the bundler is "none" we do not add any handler configuration
        return {}
      } else if (bundlerConfig.bundle === "container") {
        return {
          imageConfig: {
            command: typeof handler === "string" ? [handler] : handler,
            ...(bundlerConfig.imageConfig?.entryPoint ? { entryPoint: bundlerConfig.imageConfig.entryPoint } : {}),
            ...(bundlerConfig.imageConfig?.workingWirectory
              ? { workingDirectory: bundlerConfig.imageConfig.workingWirectory }
              : {}),
          },
        }
      } else {
        return { handler: typeof handler === "string" ? handler : handler.join(".") }
      }
    }

    // when entryPoint is not defined or available syncronously, we can imediately construct the final configuration
    if (!entryPoint || Array.isArray(entryPoint) || typeof entryPoint === "string") {
      if (entryPoint) {
        this.language.registerEntryPoint(entryPoint)
      }
      return {
        ...result,
        ...getHandlerConfig(entryPoint || undefined),
      }
    }

    // helper function for resolving the entryPoint asyncronously
    const resolveField = (configField: "handler" | "imageConfig") =>
      new AsyncResolvable(
        lambda,
        "entryPoint",
        async (): Promise<LambdaConfig[typeof configField] | undefined> => {
          const handler = await entryPoint()
          if (!handler) {
            // fallback to the original field value
            return result[configField]
          }
          this.language.registerEntryPoint(handler)
          return getHandlerConfig(handler)[configField]
        },
        AppLifeCycle.generation,
      )

    // otherwise we need to resolve the entryPoint asyncronously
    if (bundlerConfig.bundle === "container") {
      result.imageConfig = Token.asAnyMap(resolveField("imageConfig"))
    } else if (bundlerConfig.bundle !== "none") {
      result.handler = Token.asString(resolveField("handler"))
    }

    return result
  }

  /**
   * generateLambdaEntryPoint function is invoked by the Lambda construct
   * for generating the LambdaEntryPoint for lambda functions of HttpApi integration.
   * It returns the LambdaEntryPoint or undefined if the bundler does not support
   * generating the LambdaEntryPoint.
   */
  public generateHttpApiHandler<SchemaType>(
    httpApi: HttpApi,
    operation: OperationSchema<SchemaType>,
  ): LambdaEntryPoint | void {
    return this.language.generateHttpApiHandler(httpApi, operation)
  }

  /**
   * generateLambdaEntryPoint function is invoked by the Lambda construct
   * for generating the http api client for the HttpApi.
   */
  public async generateHttpApiClient(httpApi: HttpApi): Promise<void> {
    await this.language.generateHttpApiClient(httpApi)
  }

  /**
   * generateLambdaEntryPoint function is invoked by the Lambda construct
   * for generating the http api specification for the HttpApi.
   */
  public generateHttpApiSpecification(httpApi: HttpApi): string | void {
    return this.language.generateHttpApiDocument(httpApi)
  }

  /**
   * generateLambdaEntryPoint function is invoked by the Lambda construct
   * for generating the LambdaEntryPoint for lambda functions of HttpApi authorizer integration.
   * It returns the LambdaEntryPoint or undefined if the bundler does not support
   * generating the LambdaEntryPoint.
   */
  public async generateHttpApiAuthorizer(authorizer: HttpApiLambdaAuthorizer): Promise<LambdaEntryPoint | void> {
    return await this.language.generateHttpApiAuthorizer(authorizer)
  }
}
