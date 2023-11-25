import { DataArchiveFile } from "@cdktf/provider-archive/lib/data-archive-file"
import { LambdaFunctionConfig } from "@cdktf/provider-aws/lib/lambda-function"
import { S3Object } from "@cdktf/provider-aws/lib/s3-object"
import { Resource } from "@cdktf/provider-null/lib/resource"
import { Fn } from "cdktf"
import { constantCase, pascalCase } from "change-case"
import { Construct } from "constructs"
import { mkdir, rm } from "fs/promises"
import { compile } from "json-schema-to-typescript"
import { OpenAPIV3 } from "openapi-types"
import { join, relative, resolve } from "path"

import { AsyncResolvable, ResolvableStage } from "../AsyncResolvable"
import { Lambda } from "../lambda/Lambda"
import { schemaHandlerOptions, walkSchema } from "../utils/walkSchema"
import { writeFile } from "../utils/writeFile"
import { writeMustacheTemplate } from "../utils/writeMustacheTemplate"
import { BundleManifest, Bundler } from "./Bundler"
import resoucesTemplate from "./resources.ts.mu"

export interface BundlerTypeScriptHandler {
  handler: string
  entryPoint: string
}

export type BundlerTypeScriptContext = BundlerTypeScriptHandler | (() => Promise<BundlerTypeScriptHandler>)

export interface BundleTypeScriptManifest extends BundleManifest {
  type: "typescript"

  /** Relative path of the bundle from App outdir */
  srcDir: string

  /** Relative path of the entryPoints from App outdir */
  bundleDir: string

  /** The path of dist */
  buildDir: string

  /** List of entryPoints */
  entryPoints: Array<string>
}

export interface BundlerTypeScriptConfig {
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

  /**
   * Indicates if zod schemas must be generated.
   * The file will be generated at {path}/{prefix}/.gen/zod.ts.
   */
  zod?: boolean
}

export class BundlerTypeScript extends Bundler {
  public _context_type?: BundlerTypeScriptContext

  /** The path of the source code root directory */
  private _srcDir: string
  get srcDir(): string {
    return this._srcDir
  }

  private _bundleDir: string
  get bundleDir(): string {
    return this._bundleDir
  }

  /** The path of the generated files directory */
  private _genDir: string
  get genDir(): string {
    return this._genDir
  }

  /** The path of the build output directory */
  private _buildDir: string
  get buildDir(): string {
    return this._buildDir
  }

  private _entryPointsDir: string
  get entryPointsDir(): string {
    return this._entryPointsDir
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
    public config: BundlerTypeScriptConfig,
  ) {
    super(scope, id)

    this._srcDir = config.path
    this._bundleDir = config.prefix === undefined ? this.srcDir : join(this.srcDir, config.prefix)
    this._genDir = this.registerDirectory(".gen", true)
    this._buildDir = join(this.app.workdir, "build", this.stack.node.id, this.node.id)
    this._entryPointsDir = join(this.genDir, "entrypoints")

    const codeArchive = new DataArchiveFile(this, "code-archive", {
      outputPath: `\${path.module}/${this.stack.node.id}-${this.node.id}.zip`,
      type: "zip",
      sourceDir: relative(join(this.app.outdir, "stacks", this.stack.node.id), this.buildDir),
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

    new AsyncResolvable(this, "init", () => this.init(), ResolvableStage.init)
    new AsyncResolvable(this, "generate", () => this.generate(), ResolvableStage.generation)
  }

  public registerDirectory(prefix: string, deleteBeforeSynth: boolean = false): string {
    const path = resolve(this.bundleDir, prefix)

    // make sure we will not remove a drectory which contains a directory that should not be removed
    for (const p in Object.keys(this.directories)) {
      if (path.startsWith(p) && this.directories[p] && !deleteBeforeSynth) {
        throw new Error(
          `the directory '${p}' was registered with deleteBeforeSynth=true,` +
            ` cannot register '${path}' with deleteBeforeSynth=false`,
        )
      } else if (p.startsWith(path) && !this.directories[p] && deleteBeforeSynth) {
        throw new Error(
          `the directory '${p}' was registered with deleteBeforeSynth=false,` +
            ` cannot register '${path}' with deleteBeforeSynth=true`,
        )
      }
    }

    this.directories[path] = deleteBeforeSynth
    return path
  }

  private async init() {
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

    if (this.config.zod) {
      const { jsonSchemaToZod } = await import("json-schema-to-zod").catch(err => {
        console.error("please install json-schema-to-zod for zod generation support")
        return Promise.reject(err)
      })

      const module = jsonSchemaToZod(rootSchema, { module: "esm" })

      await writeFile(`${join(this.genDir, "zod.ts")}`, module)
    }
  }

  async generate() {
    await this.renderInterfaces()
    await this.renderResources()
  }

  get _interfacesAbsPath(): string {
    return join(this.genDir, "interfaces")
  }

  get _resourcesAbsPath(): string {
    return join(this.genDir, "resources")
  }

  public getBundleManifest(): BundleTypeScriptManifest {
    return {
      id: this.node.id,
      type: "typescript",
      srcDir: relative(this.app.workdir, this.srcDir),
      bundleDir: relative(this.app.workdir, this.bundleDir),
      buildDir: relative(this.app.workdir, this.buildDir),
      entryPoints: Array.from(this.entryPoints),
    }
  }

  public lambdaConfig(lambda: Lambda<BundlerTypeScript>): Partial<LambdaFunctionConfig> {
    const handler = new AsyncResolvable(this, "handler", async (): Promise<string> => {
      const { handler, entryPoint } = typeof lambda.context == "function" ? await lambda.context() : lambda.context

      this.entryPoints.add(entryPoint)

      return handler
    }).asString()

    return {
      ...this.baseLambdaConfig,
      handler,
    }
  }
}
