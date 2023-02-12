import { SdfStack } from "./SdfStack";
import { join, relative } from "path";
import { Construct } from "constructs";
import { SdfApp } from "./SdfApp";
import { SdfLambda } from "./constructs/lambda/SdfLambda";
import { OpenAPIV3 } from "openapi-types";
import { schemaHandlerOptions, walkSchema } from "./openapi/walkSchema";
import { compile } from "json-schema-to-typescript";
import { open, rm } from "fs/promises";
import { SdfResource } from "./SdfResource";
import { pascalCase, constantCase } from "change-case";
import { writeMustacheTemplate } from "./utils/writeMustacheTemplate";
import resoucesTemplate from "./resources.ts.mu";
import { DataArchiveFile } from "@cdktf/provider-archive/lib/data-archive-file";

export interface SdfServiceMetadata {
  name: string;
  path: string;
  packageJsonPath: string;
  entryPoints: Array<string>;
}

export interface SdfServiceConfig {
  packageJsonPath: string;
}

export interface SdfServiceRenderInterfacesResult {
  schemas: { [key in string]: OpenAPIV3.SchemaObject };
  header?: string;
  footer?: string;
}

export type SdfServiceRenderInterfacesCallback =
  () => Promise<SdfServiceRenderInterfacesResult>;

export class SdfService extends Construct {
  private sdfStack: SdfStack;
  private sdfApp: SdfApp;

  private schemas: { [key in string]: OpenAPIV3.SchemaObject } = {};
  private schemaCallbacks: Array<SdfServiceRenderInterfacesCallback> = [];

  constructor(
    public scope: Construct,
    public id: string,
    public config: SdfServiceConfig
  ) {
    super(scope, id);

    this.node.setContext(SdfService.name, this);
    this.sdfStack = SdfStack.getStackFromCtx(this);
    this.sdfApp = SdfApp.getAppFromContext(this);
  }

  static getServiceFromCtx(scope: Construct): SdfService {
    return SdfApp.getFromContext(scope, SdfService);
  }

  get relDir(): string {
    return this.id;
  }

  get absDir(): string {
    return join(this.sdfStack.absDir, this.relDir);
  }

  private codeArchive?: DataArchiveFile;
  get code(): DataArchiveFile {
    if (!this.codeArchive) {
      this.codeArchive = new DataArchiveFile(this, "code", {
        outputPath: `\${path.module}/${this.id}.zip`,
        type: "zip",
        // TODO: make this relative
        sourceDir: join(this.sdfApp.tmpDir, this.sdfStack.relDir, this.relDir),
      });
    }
    return this.codeArchive;
  }

  _getBuildMetadata(): SdfServiceMetadata {
    return {
      name: this.node.id,
      path: this.relDir,
      packageJsonPath: relative(this.absDir, this.config.packageJsonPath),
      entryPoints: this.node
        .findAll()
        .filter((lambda): lambda is SdfLambda => lambda instanceof SdfLambda)
        .map((lambda) => lambda.config.entryPoint),
    };
  }

  _registerInterface(schema: OpenAPIV3.SchemaObject) {
    if (!schema.title) {
      throw new Error(`schema does not have title`);
    }
    this.schemas[schema.title] = schema;
  }

  get _interfacesAbsPath(): string {
    return join(this.absDir, "interfaces");
  }

  get _resourcesAbsPath(): string {
    return join(this.absDir, "resources");
  }

  _registerInterfaces(cb: SdfServiceRenderInterfacesCallback): string {
    this.schemaCallbacks.push(cb);
    return this._interfacesAbsPath;
  }

  private async _renderInterfaces() {
    const headers: Array<string> = [];
    const footers: Array<string> = [];

    await Promise.all(
      this.schemaCallbacks.map(async (cb) => {
        const { header, schemas, footer } = await cb();
        if (header) {
          headers.push(header);
        }

        // TODO: check for duplicate names
        this.schemas = {
          ...this.schemas,
          ...schemas,
        };

        if (footer) {
          footers.push(footer);
        }
      })
    );

    const rootSchema: OpenAPIV3.SchemaObject = {
      type: "object",
      properties: this.schemas,
      additionalProperties: false,
    };

    // add tsEnumNames to all enums. this is required by
    // json-schema-to-typescript library to generate enum values
    walkSchema(`/`, rootSchema, async ({ schema }: schemaHandlerOptions) => {
      if ("enum" in schema && schema.enum && !schema["x-no-ts-enum"]) {
        (schema as any).tsEnumNames = (schema.enum as Array<string>).map((e) =>
          e.replace(/-(.)/g, (m) => m[1].toUpperCase())
        );
      }
    });

    const interfaces = await compile(rootSchema, "_", {
      strictIndexSignatures: true,
      declareExternallyReferenced: true,
      $refOptions: {
        continueOnError: false,
      },
      enableConstEnums: false,
    });

    const interfacesFile = await open(`${this._interfacesAbsPath}.ts`, "w");

    for (const chunk of headers) {
      await interfacesFile.write(chunk);
      await interfacesFile.write("\n");
    }

    await interfacesFile.write(interfaces);
    await interfacesFile.write("\n");

    for (const chunk of footers) {
      await interfacesFile.write(chunk);
      await interfacesFile.write("\n");
    }

    await interfacesFile.close();
  }

  private resources: { [id in string]: SdfResource } = {};
  _registerResource(resource: SdfResource, id: string) {
    if (this.resources[id] && this.resources[id] !== resource) {
      throw new Error(
        `resource with id '${id}' already exists in service '${this.id}'`
      );
    }
    this.resources[id] = resource;
  }

  _getResource(id: string) {
    const resource = this.resources[id];
    if (!resource) {
      throw new Error(
        `resource with id '${id}' was not found in service '${this.id}'`
      );
    }
    return resource;
  }

  private async _renderResources() {
    const resourcesPath = `${this._resourcesAbsPath}.ts`;
    await rm(resourcesPath, { force: true });

    if (Object.keys(this.resources).length) {
      const resourceSchemasMap: { [name in string]: OpenAPIV3.SchemaObject } =
        {};
      Object.entries(this.resources).map(([id, resource]) => {
        const title = `${pascalCase(id)}Config`;

        resourceSchemasMap[title] = {
          ...resource.configSpec,
          title,
        };
      });

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
        }
      );

      await writeMustacheTemplate({
        path: resourcesPath,
        template: resoucesTemplate,
        overwrite: true,
        context: {
          interfaces: resourceInterfaces,
          resources: Object.keys(this.resources).map((id) => ({
            type: `${pascalCase(id)}Config`,
            envName: constantCase(`RESOURCE_${id}`),
            id,
          })),
        },
      });
    }
  }

  async _synth() {
    await this._renderInterfaces();
    await this._renderResources();
  }
}
