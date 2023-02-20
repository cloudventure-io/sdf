import { DataArchiveFile } from "@cdktf/provider-archive/lib/data-archive-file"
import { constantCase, pascalCase } from "change-case"
import { Construct } from "constructs"
import { rm, writeFile } from "fs/promises"
import { compile } from "json-schema-to-typescript"
import { OpenAPIV3 } from "openapi-types"
import { join, relative } from "path"

import { SdfApp } from "./SdfApp"
import { SdfResource } from "./SdfResource"
import { SdfStack } from "./SdfStack"
import { SdfLambda } from "./constructs/lambda/SdfLambda"
import { schemaHandlerOptions, walkSchema } from "./http-api/openapi/walkSchema"
import resoucesTemplate from "./resources.ts.mu"
import { writeMustacheTemplate } from "./utils/writeMustacheTemplate"

export interface SdfBundleMetadata {
  name: string
  path: string
  packageJsonPath: string
  entryPoints: Array<string>
}

export interface SdfBundlerConfig {
  packageJsonPath: string
}

export class SdfBundler extends Construct {
  private sdfStack: SdfStack
  private sdfApp: SdfApp

  private schemas: { [key in string]: OpenAPIV3.SchemaObject } = {}

  constructor(public scope: Construct, public id: string, public config: SdfBundlerConfig) {
    super(scope, id)

    this.node.setContext(SdfBundler.name, this)
    this.sdfStack = SdfStack.getStackFromCtx(this)
    this.sdfApp = SdfApp.getAppFromContext(this)
  }

  static getBundlerFromCtx(construct: Construct): SdfBundler {
    return SdfApp.getFromContext(construct, SdfBundler)
  }

  get relDir(): string {
    return this.id
  }

  get absDir(): string {
    return join(this.sdfStack.absDir, this.relDir)
  }

  private codeArchive?: DataArchiveFile
  get code(): DataArchiveFile {
    if (!this.codeArchive) {
      this.codeArchive = new DataArchiveFile(this, "code", {
        outputPath: `\${path.module}/${this.id}.zip`,
        type: "zip",
        // TODO: make this relative
        sourceDir: join(this.sdfApp.tmpDir, this.sdfStack.relDir, this.relDir),
      })
    }
    return this.codeArchive
  }

  _getBuildManifest(): SdfBundleMetadata {
    return {
      name: this.node.id,
      path: this.relDir,
      packageJsonPath: relative(this.absDir, this.config.packageJsonPath),
      entryPoints: this.node
        .findAll()
        .filter((lambda): lambda is SdfLambda => lambda instanceof SdfLambda)
        .map(lambda => {
          if (!lambda.handler) {
            throw new Error(`the lambda function was not initialized properly, handler is undefined`)
          }
          return lambda.handler.entryPoint
        }),
    }
  }

  _registerSchema(schema: OpenAPIV3.SchemaObject) {
    if (!schema.title) {
      throw new Error(`schema does not have title`)
    }

    if (!this.schemas[schema.title]) {
      this.schemas[schema.title] = schema
    } else if (this.schemas[schema.title] !== schema) {
      throw new Error(`a schema with the same title '${schema.title}' is already exists`)
    }
  }

  get _interfacesAbsPath(): string {
    return join(this.absDir, "interfaces")
  }

  get _resourcesAbsPath(): string {
    return join(this.absDir, "resources")
  }

  private async _renderInterfaces() {
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

  private resources: { [id in string]: SdfResource } = {}
  _registerResource(resource: SdfResource, id: string) {
    if (this.resources[id] && this.resources[id] !== resource) {
      throw new Error(`resource with id '${id}' already exists in the bundler '${this.id}'`)
    }
    this.resources[id] = resource
  }

  _getResource(id: string) {
    const resource = this.resources[id]
    if (!resource) {
      throw new Error(`resource with id '${id}' was not found in the bundler '${this.id}'`)
    }
    return resource
  }

  private async _renderResources() {
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

  async _postSynth() {
    await this._renderInterfaces()
    await this._renderResources()
  }
}
