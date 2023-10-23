import { DataArchiveFile } from "@cdktf/provider-archive/lib/data-archive-file"
import { LambdaFunctionConfig } from "@cdktf/provider-aws/lib/lambda-function"
import { S3Object } from "@cdktf/provider-aws/lib/s3-object"
import { Resource } from "@cdktf/provider-null/lib/resource"
import { Token } from "cdktf"
import { Fn } from "cdktf"
import { constantCase, pascalCase } from "change-case"
import { Construct } from "constructs"
import { mkdir, rm } from "fs/promises"
import { compile } from "json-schema-to-typescript"
import { OpenAPIV3 } from "openapi-types"
import { join, relative } from "path"

import { SdfLambda } from "../constructs"
import { schemaHandlerOptions, walkSchema } from "../utils/walkSchema"
import { writeFile } from "../utils/writeFile"
import { writeMustacheTemplate } from "../utils/writeMustacheTemplate"
import { SdfBundleManifest, SdfBundler } from "./SdfBundler"
import resoucesTemplate from "./resources.ts.mu"

export interface SdfBundlerTypeScriptHandler {
  handler: string
  entryPoint: string
}

export interface SdfBundlerTypeScriptContext {
  handler: SdfBundlerTypeScriptHandler | (() => Promise<SdfBundlerTypeScriptHandler>)
}

export interface SdfBundleTypeScriptManifest extends SdfBundleManifest {
  type: "typescript"

  /** Relative path of the bundle from SdfApp outdir */
  path: string

  /** Relative path of the entryPoints from SdfApp outdir */
  prefix: string

  /** The path of dist */
  dist: string

  /** List of entryPoints */
  entryPoints: Array<string>
}

export interface SdfBundlerTypeScriptConfig {
  /**
   * The layout of the files and directories. The default
   * value is `compact`.
   *
   * `compact` mode:
   * ```
   * ├── entrypoints
   * │   ├── myApiOperation.ts
   * │   └── myAuthorizer.ts
   * ├── handlers
   * │   └── myApiOperation.ts
   * └── authorizers
   *     └── myAuthorizer.ts
   * ```
   *
   * `expanded` mode:
   * ```
   * ├── my-api
   * │   ├── entrypoints
   * │   │   └── myApiOperation.ts
   * │   └── handlers
   * │       └── myApiOperation.ts
   * └── my-authorizer
   *     ├── entrypoints
   *     │   └── myAuthorizer.ts
   *     └── authorizers
   *         └── myAuthorizer.ts
   * ```
   */
  layout?: "compact" | "expanded"

  /**
   * The path of the bundle. Build of this bundle
   * will run from this path. This path usually includes
   * package.json file.
   */
  path: string

  /**
   * If specified generated files will resolve relative to this path.
   */
  prefix?: string

  /**
   * The S3 bucket location for using for storing the code. The bucket must have
   * versioning enabled for proper operation.
   */
  s3?: {
    /**
     * S3 bucket name
     */
    bucket: string

    /**
     * The path prefix
     */
    prefix?: string
  }
}

export class SdfBundlerTypeScript extends SdfBundler {
  public _context_type?: SdfBundlerTypeScriptContext

  /** The path of the source code root directory */
  private _srcdir: string
  get srcdir(): string {
    return this._srcdir
  }

  /** The path of the generated files directory */
  private _gendir: string
  get gendir(): string {
    return this._gendir
  }

  /** The path of the build output directory */
  private _distdir: string
  get distdir(): string {
    return this._distdir
  }

  private directories: Record<string, boolean> = {}

  public entryPoints: Set<string> = new Set<string>()

  private baseLambdaConfig: Partial<{
    -readonly [P in keyof LambdaFunctionConfig]: LambdaFunctionConfig[P]
  }> = {
    runtime: "nodejs18.x",

    environment: {
      variables: {
        NODE_OPTIONS: "--enable-source-maps",
      },
    },
  }

  constructor(
    scope: Construct,
    id: string,
    public config: SdfBundlerTypeScriptConfig,
  ) {
    super(scope, id)

    this._srcdir = config.path

    if (config.prefix) {
      this._gendir = join(this._srcdir, config.prefix)
    } else {
      this._gendir = this._srcdir
    }

    this._distdir = join(this.app.workdir, "build", this.stack.node.id, this.node.id)

    const codeArchive = new DataArchiveFile(this, "code-archive", {
      outputPath: `\${path.module}/${this.stack.node.id}-${this.node.id}.zip`,
      type: "zip",
      sourceDir: relative(join(this.app.outdir, "stacks", this.stack.node.id), this.distdir),
    })

    if (config.s3) {
      const key = `${config.s3.prefix ? `${config.s3.prefix}/` : ""}${this.stack.node.id}-${this.node.id}.zip`

      const s3Object = new S3Object(this, "code-s3", {
        bucket: config.s3.bucket,
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

      this.baseLambdaConfig.s3Bucket = config.s3.bucket
      this.baseLambdaConfig.s3Key = s3Object.key
      this.baseLambdaConfig.s3ObjectVersion = Fn.lookupNested(updateTrigger.triggers, ["version"])
    } else {
      this.baseLambdaConfig.filename = codeArchive.outputPath
      this.baseLambdaConfig.sourceCodeHash = codeArchive.outputBase64Sha256
    }
  }

  public registerDirectory(scope: Construct, type: string, deleteBeforeSynth: boolean): string {
    let result: string

    if (this.config.layout == "expanded") {
      result = join(this.gendir, scope.node.id, type)
    } else {
      result = join(this.gendir, type)
    }

    if (result in this.directories && this.directories[result] !== deleteBeforeSynth) {
      throw new Error(`the directory ${result} was already registered with different deleteBeforeSynth value`)
    }

    this.directories[result] = deleteBeforeSynth

    return result
  }

  async _preSynth() {
    for (const [path] of Object.entries(this.directories).filter(([, clean]) => clean)) {
      await rm(path, { recursive: true, force: true })
    }

    for (const path in this.directories) {
      await mkdir(path, { recursive: true })
    }
  }

  private async renderResources() {
    const resourcesPath = `${this._resourcesAbsPath}.ts`
    await rm(resourcesPath, { force: true })

    if (Object.keys(this.stack.resources).length) {
      const resourceSchemasMap: { [name in string]: OpenAPIV3.SchemaObject } = {}
      Object.entries(this.stack.resources).map(([id, resource]) => {
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
        template: resoucesTemplate,
        overwrite: true,
        context: {
          interfaces: resourceInterfaces,
          resources: Object.keys(this.stack.resources).map(id => ({
            type: `${pascalCase(id)}Config`,
            envName: constantCase(`RESOURCE_${id}`),
            id,
          })),
        },
      })
    }
  }

  private async renderInterfaces() {
    const rootSchema: OpenAPIV3.SchemaObject = {
      type: "object",
      properties: this.schemas,
      additionalProperties: false,
    }

    // add tsEnumNames to all enums. this is required by
    // json-schema-to-typescript library to generate enum values
    walkSchema(rootSchema, ({ schema }: schemaHandlerOptions) => {
      if ("enum" in schema && schema.enum && !schema["x-no-ts-enum"]) {
        ;(schema as any).tsEnumNames = (schema.enum as Array<string>).map(e =>
          e.replace(/-(.)/g, m => m[1].toUpperCase()),
        )
      }
    })

    const interfaces = await compile(rootSchema, "_", {
      strictIndexSignatures: true,
      declareExternallyReferenced: true,
      $refOptions: {
        continueOnError: false,
      },
      enableConstEnums: false,
    })

    await writeFile(`${this._interfacesAbsPath}.ts`, interfaces)
  }

  async _postSynth() {
    await this.renderInterfaces()
    await this.renderResources()
  }

  get _interfacesAbsPath(): string {
    return join(this.gendir, "interfaces")
  }

  get _resourcesAbsPath(): string {
    return join(this.gendir, "resources")
  }

  public getBundleManifest(): SdfBundleTypeScriptManifest {
    return {
      id: this.node.id,
      type: "typescript",
      path: relative(this.app.workdir, this.srcdir),
      prefix: relative(this.app.workdir, this.gendir),
      dist: relative(this.app.workdir, this.distdir),
      entryPoints: Array.from(this.entryPoints),
    }
  }

  public lambdaConfig(lambda: SdfLambda<SdfBundlerTypeScript>): Partial<LambdaFunctionConfig> {
    const handlerResolvable = lambda.createResolvable("handler", async (): Promise<string> => {
      const { handler, entryPoint } =
        typeof lambda.context.handler == "function" ? await lambda.context.handler() : lambda.context.handler

      this.entryPoints.add(entryPoint)

      return handler
    })

    return {
      ...this.baseLambdaConfig,
      handler: Token.asString(handlerResolvable),
    }
  }
}
