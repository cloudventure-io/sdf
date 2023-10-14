import { constantCase, pascalCase } from "change-case"
import { SdfBundleManifest, SdfBundler } from "./SdfBundler"
import { writeMustacheTemplate } from "../utils/writeMustacheTemplate"
import { mkdir, rm, writeFile } from "fs/promises"
import { OpenAPIV3 } from "openapi-types"
import { compile } from "json-schema-to-typescript"
import resoucesTemplate from "./resources.ts.mu"
import { schemaHandlerOptions, walkSchema } from "../utils/walkSchema"
import { Construct } from "constructs"
import { join, relative } from "path"
import { DataArchiveFile } from "@cdktf/provider-archive/lib/data-archive-file"
import { LambdaFunctionConfig } from "@cdktf/provider-aws/lib/lambda-function"
import { Token } from "cdktf"
import { SdfLambda } from "../constructs"

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

    this._distdir = join(this.sdfApp.workdir, "build", this.sdfStack.node.id, this.node.id)
  }

  private codeArchive?: DataArchiveFile
  get code(): DataArchiveFile {
    if (!this.codeArchive) {
      this.codeArchive = new DataArchiveFile(this, "code", {
        outputPath: `\${path.module}/${this.node.id}.zip`,
        type: "zip",
        sourceDir: relative(join(this.sdfApp.outdir, "stacks", this.sdfStack.node.id), this.distdir),
      })
    }
    return this.codeArchive
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

    if (Object.keys(this.resources).length) {
      const resourceSchemasMap: { [name in string]: OpenAPIV3.SchemaObject } = {}
      Object.entries(this.resources).map(([id, resource]) => {
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
          resources: Object.keys(this.resources).map(id => ({
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
    walkSchema(rootSchema, async ({ schema }: schemaHandlerOptions) => {
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
      path: relative(this.sdfApp.workdir, this.srcdir),
      prefix: relative(this.sdfApp.workdir, this.gendir),
      dist: relative(this.sdfApp.workdir, this.distdir),
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
      runtime: "nodejs18.x",

      filename: this.code.outputPath,
      sourceCodeHash: this.code.outputBase64Sha256,
      handler: Token.asString(handlerResolvable),

      environment: {
        variables: {
          NODE_OPTIONS: "--enable-source-maps",
        },
      },
    }
  }
}
